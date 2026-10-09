import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '../src/templates';
import { withComputedTimes, withFixedRows } from '../src/templates/fixedRows';
import { emptyDocument } from '../src/state/session';

describe('linhas fixas do plano de trabalho', () => {
  it('acrescenta as linhas sem inventar horas, mesmo com KO', () => {
    const base = emptyDocument();
    const withKo = { ...base, header: { ...base.header, kickoff: { value: '15:30', confidence: 0.95 } } };
    const document = withComputedTimes(withFixedRows(withKo, DEFAULT_TEMPLATE), DEFAULT_TEMPLATE);
    expect(document.sections.workPlan.map((row) => [row.description?.value, row.time?.value])).toEqual([
      ['Início da Montagem', ''],
      ['Testes', ''],
      ['Almoço', ''],
      ['Hora prevista de desmontagem', ''],
      ['Hora prevista de chegada ao armazém', ''],
    ]);
  });
});
