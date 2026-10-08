import { memo, type ReactNode } from 'react';
import type { SectionDef } from '../templates';
import type { BBox, ColumnKey, SectionKey, SheetRow } from '../types/callSheet';
import { EditableTable } from './EditableTable';

interface SectionEditorProps {
  section: SectionDef;
  rows: SheetRow[];
  onEdit: (section: SectionKey, rowId: string, column: ColumnKey, value: string) => void;
  onAdd: (section: SectionKey) => void;
  onRemove: (section: SectionKey, rowId: string) => void;
  onLocate: (bbox: BBox | undefined) => void;
  /** Campos extra a mostrar entre o título e a tabela (ex.: saída e origem da logística). */
  children?: ReactNode;
}

/** Um bloco do call sheet (Câmaras, EVS, …): título, tabela editável e botão para acrescentar linhas. */
export const SectionEditor = memo(function SectionEditor({ section, rows, onEdit, onAdd, onRemove, onLocate, children }: SectionEditorProps) {
  return (
    <section className="block" aria-label={section.title}>
      <h2 className="block__title">
        {section.title}
        <span className="block__count">{rows.length === 1 ? '1 linha' : `${rows.length} linhas`}</span>
      </h2>
      {children}
      <EditableTable
        title={section.title}
        columns={section.columns}
        rows={rows}
        onEdit={(rowId, column, value) => onEdit(section.key, rowId, column, value)}
        onRemove={(rowId) => onRemove(section.key, rowId)}
        onLocate={onLocate}
      />
      <div className="block__foot">
        <button type="button" className="button button--small" onClick={() => onAdd(section.key)}>
          Adicionar linha
        </button>
      </div>
    </section>
  );
});
