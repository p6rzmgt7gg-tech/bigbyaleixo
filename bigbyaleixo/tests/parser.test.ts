import { describe, expect, it } from 'vitest';
import type { TextCell } from '../src/ocr/ocrEngine';
import type { Rule } from '../src/ocr/tableDetector';
import { isCallSheet, parseCallSheet } from '../src/ocr/textParser';
import { DEFAULT_TEMPLATE } from '../src/templates';
import { pdfFileName } from '../src/utils/formatters';
import { confidenceLevel } from '../src/utils/fields';
import { checkImageFile } from '../src/utils/validators';
import { readFileSync } from 'node:fs';
import { generateCallSheetPdf } from '../src/pdf/pdfGenerator';

const font = (weight: number) => readFileSync(new URL(`../src/pdf/fonts/BarlowCondensed-${weight}.ttf`, import.meta.url));
const fonts = { regular: font(400), medium: font(500), semibold: font(600), bold: font(700) };

/** Célula sintética: texto numa posição, como o OCR a devolveria. */
function cell(text: string, x: number, y: number, confidence = 0.96): TextCell {
  const width = text.length * 7;
  let cursor = x;
  const words = text.split(' ').map((word) => {
    const box = { x0: cursor, y0: y, x1: cursor + word.length * 7, y1: y + 12 };
    cursor = box.x1 + 7;
    return { text: word, confidence, bbox: box };
  });
  return { text, confidence, bbox: { x0: x, y0: y, x1: x + width, y1: y + 12 }, words };
}

/** Folha sem grelha: rótulos à esquerda, cabeçalho com "Rótulo valor". */
function sheet(): TextCell[] {
  const cells: TextCell[] = [cell('Local: Porto, Pavilhão Rosa Mota', 20, 10), cell('Data: quarta 7 out', 20, 30), cell('PF 26.1042', 20, 50), cell('Faltam 2', 160, 50)];
  let y = 100;
  cells.push(cell('Câmaras', 20, y));
  y += 22;
  [['1', 'Ana Exemplo', 'ok', 'Pt'], ['2', 'Bruno Teste', 'ok', 'Lx'], ['3', 'Carla Modelo', '', 'Pt']].forEach(([n, name, status, local]) => {
    cells.push(cell(n, 20, y), cell(name, 50, y));
    if (status) cells.push(cell(status, 260, y));
    cells.push(cell(local, 320, y));
    y += 22;
  });
  y += 30;
  cells.push(cell('EVS', 20, y));
  y += 22;
  cells.push(cell('Duarte Fictício', 50, y), cell('ok', 260, y), cell('Lx', 320, y));
  return cells;
}

describe('parser do template 001', () => {
  const rules: Rule[] = [];
  const result = parseCallSheet({ cells: sheet(), rules, width: 800, height: 400, textHeight: 10 }, DEFAULT_TEMPLATE);
  const { header, sections } = result.document;

  it('reconhece o cabeçalho pelos rótulos', () => {
    expect(header.location.value).toBe('Porto, Pavilhão Rosa Mota');
    expect(header.date.value).toBe('quarta 7 out');
    expect(header.pf.value).toBe('26.1042');
    expect(header.missing.value).toBe('2');
  });

  it('separa cada linha em colunas, sem juntar tudo num campo', () => {
    expect(sections.cameras.map((row) => [row.number?.value, row.name?.value, row.status?.value, row.location?.value])).toEqual([
      ['1', 'Ana Exemplo', 'ok', 'Pt'],
      ['2', 'Bruno Teste', 'ok', 'Lx'],
      ['3', 'Carla Modelo', '', 'Pt'],
    ]);
    expect(sections.evs).toHaveLength(1);
    expect(sections.evs[0].name?.value).toBe('Duarte Fictício');
  });

  it('não inventa valores: campos ausentes ficam vazios', () => {
    expect(header.id.value).toBe('');
    expect(header.crew.value).toBe('');
    expect(sections.cameras[2].status?.value).toBe('');
    expect(sections.ccu).toEqual([]);
  });

  it('identifica o documento como call sheet', () => {
    expect(isCallSheet(result)).toBe(true);
  });

  it('não confunde texto corrido com um call sheet', () => {
    const prose = parseCallSheet(
      { cells: [cell('Ata da reunião de condomínio', 20, 10), cell('As contas foram aprovadas por maioria.', 20, 40)], rules, width: 800, height: 200, textHeight: 10 },
      DEFAULT_TEMPLATE,
    );
    expect(isCallSheet(prose)).toBe(false);
  });
});

describe('confiança', () => {
  it('classifica pelos limiares pedidos', () => {
    expect(confidenceLevel({ value: 'x', confidence: 0.95 })).toBe('high');
    expect(confidenceLevel({ value: 'x', confidence: 0.9 })).toBe('high');
    expect(confidenceLevel({ value: 'x', confidence: 0.75 })).toBe('check');
    expect(confidenceLevel({ value: 'x', confidence: 0.5 })).toBe('low');
    expect(confidenceLevel({ value: '', confidence: null })).toBe('empty');
    expect(confidenceLevel({ value: 'x', confidence: 0.4, edited: true })).toBe('edited');
  });
});

describe('ficheiros', () => {
  it('aceita só JPG/JPEG/PNG até 20 MB', () => {
    expect(checkImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(checkImageFile({ name: 'a.PNG', type: 'image/png', size: 1000 })).toBeNull();
    expect(checkImageFile({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBe('unsupported_format');
    expect(checkImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 21 * 1024 * 1024 })).toBe('file_too_large');
  });
});

describe('PDF', () => {
  const document = parseCallSheet({ cells: sheet(), rules: [], width: 800, height: 400, textHeight: 10 }, DEFAULT_TEMPLATE).document;

  it('dá o nome BIG_[evento]_[data].pdf, ou sem evento', () => {
    expect(pdfFileName(document)).toBe('BIG_quarta-7-out.pdf');
    const withEvent = { ...document, header: { ...document.header, event: { value: 'Final da Taça', confidence: 1 } } };
    expect(pdfFileName(withEvent)).toBe('BIG_Final-da-Taca_quarta-7-out.pdf');
  });

  it('gera um PDF com texto real e pagina quando é preciso', async () => {
    const small = await generateCallSheetPdf(document, DEFAULT_TEMPLATE, { fonts });
    expect(Buffer.from(small.bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(small.pageCount).toBe(1);
    const many = Array.from({ length: 90 }, (_, index) => ({ ...document.sections.cameras[0], id: `r${index}` }));
    const big = await generateCallSheetPdf({ ...document, sections: { ...document.sections, cameras: many } }, DEFAULT_TEMPLATE, { fonts });
    expect(big.pageCount).toBeGreaterThan(1);
  });
});

describe('rótulos sem separação de palavras', () => {
  it('lê "Rótulo: valor" numa única palavra do OCR', () => {
    const glued: TextCell = { ...cell('x', 20, 10), text: 'Local: Braga, Fórum', words: [{ text: 'Local: Braga, Fórum', confidence: 0.95, bbox: { x0: 20, y0: 10, x1: 150, y1: 22 } }] };
    const cells = [glued, ...sheet().slice(4)];
    const { document } = parseCallSheet({ cells, rules: [], width: 800, height: 400, textHeight: 10 }, DEFAULT_TEMPLATE);
    expect(document.header.location.value).toBe('Braga, Fórum');
  });
});

describe('formato com cargos, plano de trabalho e logística', () => {
  // Disposição do call sheet de referência, com nomes fictícios.
  const cells: TextCell[] = [
    cell('CANAL TESTE', 300, 10),
    { ...cell('TAÇA EXEMPLO', 260, 30), bbox: { x0: 260, y0: 30, x1: 400, y1: 60 } },
    cell('CASA vs FORA', 280, 66),
    cell('Data: sábado, 3 de outubro', 150, 100),
    cell('Local: ESTÁDIO MODELO', 420, 100),
    { ...cell('EQUIPA', 20, 140), bbox: { x0: 20, y0: 136, x1: 90, y1: 156 } },
    cell('Produtor', 20, 170),
    cell('ANA EXEMPLO', 150, 170),
    cell('Realizador', 20, 192),
    cell('RUI MODELO', 150, 192),
    { ...cell('EVS', 20, 240), bbox: { x0: 20, y0: 236, x1: 60, y1: 256 } },
    cell('1', 20, 270),
    cell('LUÍS TESTE', 50, 270),
    cell('ok', 200, 270),
    cell('Pt', 240, 270),
    { ...cell('PLANO DE TRABALHO', 20, 320), bbox: { x0: 20, y0: 316, x1: 220, y1: 336 } },
    cell('PRÉ-JOGO', 20, 350),
    cell('Hora', 20, 375),
    cell('Descrição', 80, 375),
    cell('Meios / Obs.', 300, 375),
    cell('15:00', 20, 400),
    cell('Antevisão com convidados', 80, 400),
    cell('CAM 05', 300, 400),
    cell('e entrevistas', 80, 416),
  ];
  const { document } = parseCallSheet({ cells, rules: [], width: 800, height: 600, textHeight: 10 }, DEFAULT_TEMPLATE);

  it('lê canal, competição, jogo e as linhas "Rótulo: valor"', () => {
    expect(document.header.client.value).toBe('CANAL TESTE');
    expect(document.header.competition.value).toBe('TAÇA EXEMPLO');
    expect(document.header.event.value).toBe('CASA vs FORA');
    expect(document.header.date.value).toBe('sábado, 3 de outubro');
    expect(document.header.location.value).toBe('ESTÁDIO MODELO');
  });

  it('lê cargo + nome', () => {
    expect(document.sections.production[0].name?.value).toBe('ANA EXEMPLO');
    expect(document.sections.realization[0].name?.value).toBe('RUI MODELO');
  });

  it('não confunde a numeração da lista com dados', () => {
    expect(document.sections.evs).toHaveLength(1);
    expect(document.sections.evs[0].name?.value).toBe('LUÍS TESTE');
    expect(document.sections.evs[0].location?.value).toBe('Pt');
  });

  it('lê o plano de trabalho com fase e junta a linha partida', () => {
    // Primeiro as linhas fixas do template (por preencher), depois a linha lida.
    expect(document.sections.workPlan.map((r) => r.description?.value)).toEqual(['Início da Montagem', 'Testes', 'Almoço', 'Antevisão com convidados e entrevistas', 'Hora prevista de desmontagem', 'Hora prevista de chegada ao armazém']);
    expect(document.sections.workPlan[0].time?.value).toBe('');
    const row = document.sections.workPlan[3];
    expect(row.phase?.value).toBe('PRÉ-JOGO');
    expect(row.time?.value).toBe('15:00');
    expect(row.description?.value).toBe('Antevisão com convidados e entrevistas');
    expect(row.means?.value).toBe('CAM 05');
    // "CAM 05" no plano não é uma câmara.
    expect(document.sections.cameras).toEqual([]);
  });
});

describe('leitura por zonas (secção primeiro)', () => {
  // Folha em duas colunas: LOGÍSTICA e PLANO DE TRABALHO à esquerda, EQUIPA à direita.
  const cells: TextCell[] = [
    cell('LIGA EXEMPLO', 200, 10),
    cell('KO: 15:30', 200, 40),
    cell('LOGÍSTICA', 20, 100),
    cell('Saída: 08:30', 20, 130),
    cell('CONDUTOR', 20, 160), cell('VIATURA', 130, 160), cell('PASSAGEIROS', 240, 160),
    cell('ANA EXEMPLO', 20, 180), cell('CARRO UM', 130, 180), cell('BRUNO TESTE,', 240, 180),
    cell('CARLA MODELO', 240, 200),
    cell('DIOGO', 20, 220), cell('CARRO -', 130, 220), cell('EVA SILVA', 240, 220),
    cell('TESTE', 20, 240), cell('DOIS', 130, 240),
    cell('PLANO DE TRABALHO', 20, 300),
    cell('Pré-jogo:', 20, 330),
    cell('- 13H30 - CHEGADA DA EQUIPA', 20, 350),
    cell('- 15H20 - LINE UP - CAM 05', 20, 370),
    cell('EQUIPA', 420, 100),
    cell('Realizador: RUI EXEMPLO', 420, 130),
    cell('Câmaras', 420, 160),
    cell('1:', 420, 180), cell('PEDRO UM', 500, 180),
    cell('TT', 420, 200), cell('PEDRO DOIS', 500, 200),
    cell('3:', 420, 220), cell('PEDRO TRES', 500, 220),
  ];
  const { document } = parseCallSheet({ cells, rules: [], width: 700, height: 500, textHeight: 12 }, DEFAULT_TEMPLATE);

  it('mantém viatura, condutor e passageiros de cada registo juntos', () => {
    expect(document.sections.drivers.map((r) => [r.name?.value, r.vehicle?.value, r.passengers?.value])).toEqual([
      ['ANA EXEMPLO', 'CARRO UM', 'BRUNO TESTE, CARLA MODELO'],
      ['DIOGO TESTE', 'CARRO - DOIS', 'EVA SILVA'],
    ]);
    expect(document.header.departure.value).toBe('08:30');
  });

  it('não desloca os nomes das câmaras quando um número não se lê', () => {
    expect(document.sections.cameras.map((r) => [r.number?.value, r.name?.value])).toEqual([
      ['1', 'PEDRO UM'],
      ['2', 'PEDRO DOIS'],
      ['3', 'PEDRO TRES'],
    ]);
    expect(document.sections.realization[0].name?.value).toBe('RUI EXEMPLO');
  });

  it('separa hora, descrição e meios no plano, sem confundir com o KO', () => {
    const read = document.sections.workPlan.filter((r) => r.phase?.value === 'PRÉ-JOGO');
    expect(read.map((r) => [r.time?.value, r.description?.value, r.means?.value])).toEqual([
      ['13:30', 'CHEGADA DA EQUIPA', ''],
      ['15:20', 'LINE UP', 'CAM 05'],
    ]);
    expect(document.header.kickoff.value).toBe('15:30');
  });
});
