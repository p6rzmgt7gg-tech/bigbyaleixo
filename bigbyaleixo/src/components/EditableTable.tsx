import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  /** Mover uma linha para a posição `to` (arrastando). Sem isto, as linhas não se movem. */
  onMove?: (rowId: string, to: number) => void;
  /** Mostra na imagem original de onde veio o campo em foco. */
  onLocate: (bbox: BBox | undefined) => void;
}

/** Tabela em que todas as células são editáveis e as linhas podem ser removidas. */
export function EditableTable({ title, columns, rows, onEdit, onRemove, onMove, onLocate }: EditableTableProps) {
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const keys = columns.map((column) => column.key);
  const body = useRef<HTMLTableSectionElement>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; over: number } | null>(null);

  /** Arrastar pela pega: segue o ponteiro (rato ou dedo) e larga a linha na posição por baixo dele. */
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, from: number): void => {
    if (!onMove || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let over = from;
    setDrag({ id, from, over });
    const move = (moveEvent: PointerEvent): void => {
      const items = [...(body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? [])];
      let target = items.length - 1;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (moveEvent.clientY < rect.top + rect.height / 2) {
          target = i > from ? i - 1 : i;
          break;
        }
      }
      if (target !== over) {
        over = Math.max(0, target);
        setDrag({ id, from, over });
      }
    };
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setDrag(null);
      if (over !== from) onMove(id, over);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  return (
    <div className="table-wrap">
      <table className="table">
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: `${(column.weight / totalWeight) * 100}%` }} />
          ))}
          <col className="table__confidence" />
          {onMove && <col className="table__move" />}
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
            {onMove && (
              <th scope="col">
                <span className="visually-hidden">Mover</span>
              </th>
            )}
            <th scope="col">
              <span className="visually-hidden">Remover</span>
            </th>
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.length === 0 && (
            <tr className="table__empty">
              <td colSpan={columns.length + (onMove ? 3 : 2)}>Sem linhas neste bloco.</td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr
              key={row.id}
              data-row
              className={
                drag === null
                  ? undefined
                  : drag.id === row.id
                    ? 'is-dragging'
                    : drag.over === index && drag.over !== drag.from
                      ? drag.over < drag.from
                        ? 'is-drop-before'
                        : 'is-drop-after'
                      : undefined
              }
            >
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
              {onMove && (
                <td className="table__move">
                  <button
                    type="button"
                    className="table__handle"
                    aria-label={`Arrastar linha ${index + 1} de ${title} (ou usar as setas do teclado)`}
                    title="Arrastar para mudar de posição"
                    onPointerDown={(event) => startDrag(event, row.id, index)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && index > 0) {
                        event.preventDefault();
                        onMove(row.id, index - 1);
                      } else if (event.key === 'ArrowDown' && index < rows.length - 1) {
                        event.preventDefault();
                        onMove(row.id, index + 1);
                      }
                    }}
                  >
                    ⠿
                  </button>
                </td>
              )}
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
