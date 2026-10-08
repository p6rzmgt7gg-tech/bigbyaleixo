import type { ColumnDef } from '../templates';
import type { BBox, ColumnKey, SheetRow } from '../types/callSheet';
import { confidenceLevel, rowLevel } from '../utils/fields';
import { ConfidenceBadge } from './ConfidenceBadge';

interface EditableTableProps {
  /** Nome do bloco, para as etiquetas de acessibilidade. */
  title: string;
  columns: ColumnDef[];
  rows: SheetRow[];
  onEdit: (rowId: string, column: ColumnKey, value: string) => void;
  onRemove: (rowId: string) => void;
  /** Mostra na imagem original de onde veio o campo em foco. */
  onLocate: (bbox: BBox | undefined) => void;
}

/** Tabela em que todas as células são editáveis e as linhas podem ser removidas. */
export function EditableTable({ title, columns, rows, onEdit, onRemove, onLocate }: EditableTableProps) {
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const keys = columns.map((column) => column.key);
  return (
    <div className="table-wrap">
      <table className="table">
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: `${(column.weight / totalWeight) * 100}%` }} />
          ))}
          <col className="table__confidence" />
          <col className="table__remove" />
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align}>
                {column.label}
              </th>
            ))}
            <th scope="col">Confiança</th>
            <th scope="col">
              <span className="visually-hidden">Remover</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="table__empty">
              <td colSpan={columns.length + 2}>Sem linhas neste bloco.</td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.id}>
              {columns.map((column) => {
                const field = row[column.key];
                return (
                  <td key={column.key} data-align={column.align} data-level={confidenceLevel(field)}>
                    <input
                      type="text"
                      value={field?.value ?? ''}
                      aria-label={`${column.label}, ${title}, linha ${index + 1}`}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => onEdit(row.id, column.key, event.target.value)}
                      onFocus={() => onLocate(field?.bbox ?? row.name?.bbox)}
                    />
                  </td>
                );
              })}
              <td className="table__confidence">
                <ConfidenceBadge level={rowLevel(row, keys)} />
              </td>
              <td className="table__remove">
                <button type="button" aria-label={`Remover linha ${index + 1} de ${title}`} title="Remover linha" onClick={() => onRemove(row.id)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
