import { useId } from 'react';
import type { HeaderFieldDef } from '../templates';
import type { BBox, CallSheetDocument, HeaderKey } from '../types/callSheet';
import { confidenceLevel } from '../utils/fields';
import { ConfidenceBadge } from './ConfidenceBadge';

interface HeaderFieldsProps {
  fields: HeaderFieldDef[];
  header: CallSheetDocument['header'];
  onEdit: (key: HeaderKey, value: string) => void;
  onLocate: (bbox: BBox | undefined) => void;
}

const WIDTH: Record<HeaderFieldDef['kind'], string> = {
  text: 'field--wide',
  place: 'field--wide',
  note: 'field--full',
  date: 'field--medium',
  code: 'field--medium',
  time: '',
  count: '',
};

/** Grelha de campos editáveis do cabeçalho; os campos de texto livre usam várias linhas. */
export function HeaderFields({ fields, header, onEdit, onLocate }: HeaderFieldsProps) {
  const prefix = useId();
  return (
    <div className="fields">
      {fields.map((definition) => {
        const field = header[definition.key];
        const level = confidenceLevel(field);
        const id = `${prefix}-${definition.key}`;
        const common = {
          id,
          value: field.value,
          autoComplete: 'off',
          spellCheck: false,
          onFocus: () => onLocate(field.bbox),
        };
        return (
          <div key={definition.key} className={`field ${WIDTH[definition.kind]}`} data-level={level}>
            <label htmlFor={id}>
              {definition.label}
              <ConfidenceBadge level={level} compact={level === 'high'} />
            </label>
            {definition.kind === 'note' ? (
              <textarea {...common} rows={3} onChange={(event) => onEdit(definition.key, event.target.value)} />
            ) : (
              <input {...common} type="text" onChange={(event) => onEdit(definition.key, event.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
