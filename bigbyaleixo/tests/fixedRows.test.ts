import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '../src/templates';
import { withComputedTimes, withFixedRows } from '../src/templates/fixedRows';
import { emptyDocument } from '../src/state/session';

describe('linhas fixas do plano de trabalho', () => {
  it('calcula as horas a partir do KO (antes e depois do jogo) e recalcula quando o KO muda, sem tocar em horas editadas', () => {
    const base = emptyDocument();
    const withKo = { ...base, header: { ...base.header, kickoff: { value: '15:30', confidence: 0.95 } } };
    const document = withFixedRows(withKo, DEFAULT_TEMPLATE);
    const times = (doc: typeof document) => doc.sections.workPlan.map((row) => [row.description?.value, row.time?.value]);
    expect(times(document)).toEqual([
      ['Início da Montagem', '10:30'],
      ['Testes', '12:30'],
      ['Almoço', '13:00'],
      ['Hora prevista de desmontagem', '18:00'],
      ['Hora prevista de chegada ao armazém', '19:30'],
    ]);
    expect(document.sections.workPlan[0].time?.confidence).toBeLessThan(0.9);

    // O utilizador fixa a hora dos testes; depois muda o KO.
    const tests = document.sections.workPlan[1];
    const edited = {
      ...document,
      header: { ...document.header, kickoff: { value: '20:15', confidence: null, edited: true } },
      sections: { ...document.sections, workPlan: document.sections.workPlan.map((row) => (row === tests ? { ...row, time: { value: '16:00', confidence: null, edited: true } } : row)) },
    };
    expect(times(withComputedTimes(edited, DEFAULT_TEMPLATE))).toEqual([
      ['Início da Montagem', '15:15'],
      ['Testes', '16:00'],
      ['Almoço', '17:45'],
      ['Hora prevista de desmontagem', '22:45'],
      ['Hora prevista de chegada ao armazém', '00:15'],
    ]);
  });
});
