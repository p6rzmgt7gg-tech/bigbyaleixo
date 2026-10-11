import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '../src/templates';
import { withArrivalSteps, withComputedTimes, withFixedRows } from '../src/templates/fixedRows';
import { emptyDocument } from '../src/state/session';

describe('plano de trabalho', () => {
  it('não acrescenta linhas fixas nem horas inventadas', () => {
    const base = emptyDocument();
    const withKo = { ...base, header: { ...base.header, kickoff: { value: '15:30', confidence: 0.95 } } };
    const document = withComputedTimes(withFixedRows(withKo, DEFAULT_TEMPLATE), DEFAULT_TEMPLATE);
    expect(document.sections.workPlan).toEqual([]);
  });

  it('acrescenta Reunião (+10) e Início de Montagem (+15) a seguir à Hora no local', () => {
    const base = emptyDocument();
    const row = (id: string, time: string, description: string) => ({ id, time: { value: time, confidence: 0.95 }, description: { value: description, confidence: 0.95 }, means: { value: '', confidence: null } });
    const document = withArrivalSteps({
      ...base,
      sections: { ...base.sections, workPlan: [row('a', '08:00', 'Saída ML Lx'), row('b', '12:50', 'Hora no local'), row('c', '15:00', '1º Direto')] },
    });
    expect(document.sections.workPlan.map((r) => [r.time?.value, r.description?.value])).toEqual([
      ['08:00', 'Saída ML Lx'],
      ['12:50', 'Hora no local'],
      ['13:00', 'Reunião'],
      ['13:05', 'Início de Montagem'],
      ['15:00', '1º Direto'],
    ]);
    // Mudar a hora no local acerta as horas calculadas.
    const moved = withArrivalSteps({
      ...document,
      sections: { ...document.sections, workPlan: document.sections.workPlan.map((r) => (r.id === 'b' ? { ...r, time: { value: '13:00', confidence: null, edited: true } } : r)) },
    });
    expect(moved.sections.workPlan.slice(2, 4).map((r) => r.time?.value)).toEqual(['13:10', '13:15']);
  });
});
