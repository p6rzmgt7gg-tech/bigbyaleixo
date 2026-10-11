/**
 * Logística a partir da equipa: na folha, a coluna Trans/Pk diz em que viatura vai cada
 * pessoa (P-R1, L-R2, P-Aux, …) e um "C" na coluna # indica quem conduz. Agrupando por
 * viatura sabe-se o condutor e os passageiros de cada uma.
 */
import type { CallSheetDocument, Field, SectionKey, SheetRow } from '../types/callSheet';
import { createRowId } from './fields';

/** Código da viatura normalizado: "P-VIt" → "P-Vlt", "P-AUX" → "P-Aux", "p r1" → "P-R1". */
export function vehicleCode(text: string): string {
  const tokens = text.trim().split(/\s+/);
  // O código é o token "P-…"/"L-…"; o resto da célula (ex.: "Brasei") é outra anotação.
  const first = tokens.find((token) => /^[PLpl]-/.test(token)) ?? tokens[0] ?? '';
  const plain = first.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '');
  const match = /^([PLpl])-?(.+)$/.exec(plain);
  if (!match) return plain.toUpperCase();
  let rest = match[2];
  if (/^v[il1|]t$/i.test(rest)) rest = 'Vlt';
  else if (/^aux$/i.test(rest)) rest = 'Aux';
  else rest = rest.toUpperCase();
  return `${match[1].toUpperCase()}-${rest}`;
}

/**
 * Célula Trans/Pk: fica só o código da viatura (P-R3, L-Aux, …). As anotações que vêm
 * junto (ex.: "erm", da coluna seguinte) não se transcrevem.
 */
export function cleanTransPk(text: string): string {
  const code = text.trim().split(/\s+/).find((token) => /^[PLpl]-\S+/.test(token));
  return code ?? text.trim();
}

/** Mantém em cada linha da equipa só o código da viatura na coluna Trans/Pk. */
export function withCleanTransPk(document: CallSheetDocument): CallSheetDocument {
  const sections = Object.fromEntries(
    Object.entries(document.sections).map(([key, rows]) => [
      key,
      (rows as SheetRow[]).map((row) => {
        if (!row.transPk) return row;
        const cleaned = cleanTransPk(row.transPk.value);
        return cleaned === row.transPk.value ? row : { ...row, transPk: { ...row.transPk, value: cleaned } };
      }),
    ]),
  ) as CallSheetDocument['sections'];
  return { ...document, sections };
}

/** Nome por extenso das carrinhas de material. */
export function vehicleLabel(code: string): string {
  if (code === 'P-Aux') return 'P-Aux (carrinha material Porto)';
  if (code === 'L-Aux') return 'L-Aux (carrinha material Lisboa)';
  return code;
}

const isDriver = (status: string): boolean => /^c+$/i.test(status.trim());

/** Linhas de logística (viatura, condutor, passageiros) deduzidas da equipa. Vazio se ninguém tiver viatura. */
export function logisticsFromTeam(document: CallSheetDocument): SheetRow[] {
  const groups = new Map<string, { drivers: Field[]; passengers: Field[]; confidence: number }>();
  for (const [key, rows] of Object.entries(document.sections) as [SectionKey, SheetRow[]][]) {
    if (key === 'drivers' || key === 'workPlan' || key === 'departures') continue;
    for (const row of rows) {
      const trans = row.transPk?.value.trim() ?? '';
      const name = row.name?.value.trim() ?? '';
      if (!trans || !name) continue;
      const code = vehicleCode(trans);
      if (!/^[PL]-/.test(code)) continue;
      const group = groups.get(code) ?? { drivers: [], passengers: [], confidence: 1 };
      const field = row.name!;
      if (isDriver(row.status?.value ?? '')) {
        if (!group.drivers.some((other) => other.value === field.value)) group.drivers.push(field);
      } else if (!group.passengers.some((other) => other.value === field.value)) group.passengers.push(field);
      group.confidence = Math.min(group.confidence, row.transPk?.confidence ?? 1, field.confidence ?? 1);
      groups.set(code, group);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt'))
    .map(([code, group]) => {
      // Sem condutor marcado, a viatura aparece com os passageiros e o condutor por preencher.
      const confidence = Math.min(group.confidence, 0.89);
      return {
        id: createRowId(),
        vehicle: { value: vehicleLabel(code), confidence },
        name: { value: group.drivers.map((field) => field.value).join(', '), confidence: group.drivers.length ? confidence : null },
        passengers: { value: group.passengers.map((field) => field.value).join(', '), confidence: group.passengers.length ? confidence : null },
      };
    });
}

/** A saída única do cabeçalho (Saída / De) passa a ser a primeira das horas de saída. */
export function withDepartures(document: CallSheetDocument): CallSheetDocument {
  const time = document.header.departure?.value.trim() ?? '';
  const place = document.header.origin?.value.trim() ?? '';
  if (time === '' && place === '') return document;
  const current = document.sections.departures ?? [];
  const row: SheetRow = {
    id: createRowId(),
    time: time ? document.header.departure : { value: '', confidence: null },
    location: place ? document.header.origin : { value: '', confidence: null },
  };
  const header = { ...document.header, departure: { value: '', confidence: null }, origin: { value: '', confidence: null } };
  return { ...document, header, sections: { ...document.sections, departures: [row, ...current] } };
}

/** Põe a logística deduzida no documento, se ainda não houver viaturas. */
export function withTeamLogistics(document: CallSheetDocument): CallSheetDocument {
  const current = document.sections.drivers ?? [];
  if (current.some((row) => row.vehicle?.value.trim())) return document;
  const derived = logisticsFromTeam(document);
  if (!derived.length) return document;
  // Condutores listados sem viatura (bloco CONDUTORES) que não aparecem nas viaturas ficam no fim.
  const known = new Set(derived.flatMap((row) => [row.name?.value ?? '', row.passengers?.value ?? ''].join(', ').split(/,\s*/)));
  const extra = current.filter((row) => row.name?.value.trim() && !known.has(row.name.value.trim()));
  return { ...document, sections: { ...document.sections, drivers: [...derived, ...extra] } };
}
