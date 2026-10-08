import type { HeaderFieldDef } from '../templates';
import type { BBox, CallSheetDocument, HeaderKey } from '../types/callSheet';
import { confidenceLevel } from '../utils/fields';
import { HeaderFields } from './HeaderFields';

interface HeaderEditorProps {
  fields: HeaderFieldDef[];
  header: CallSheetDocument['header'];
  onEdit: (key: HeaderKey, value: string) => void;
  onEditExtra: (id: string, part: 'label' | 'value', value: string) => void;
  onAddExtra: () => void;
  onRemoveExtra: (id: string) => void;
  onLocate: (bbox: BBox | undefined) => void;
}

/** Informação do evento: os campos do cabeçalho e os outros campos encontrados no documento. */
export function HeaderEditor({ fields, header, onEdit, onEditExtra, onAddExtra, onRemoveExtra, onLocate }: HeaderEditorProps) {
  return (
    <section className="block" aria-label="Informação do evento">
      <h2 className="block__title">INFORMAÇÃO DO EVENTO</h2>
      <HeaderFields fields={fields} header={header} onEdit={onEdit} onLocate={onLocate} />
      {header.others.length > 0 && (
        <div className="extras" role="group" aria-label="Outros campos do cabeçalho">
          {header.others.map((extra, index) => (
            <div className="extras__row" key={extra.id} data-level={confidenceLevel(extra.field)}>
              <input
                type="text"
                value={extra.label}
                placeholder="Campo"
                aria-label={`Nome do outro campo ${index + 1}`}
                autoComplete="off"
                onChange={(event) => onEditExtra(extra.id, 'label', event.target.value)}
              />
              <input
                type="text"
                value={extra.field.value}
                placeholder="Valor"
                aria-label={`Valor do outro campo ${index + 1}`}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onEditExtra(extra.id, 'value', event.target.value)}
                onFocus={() => onLocate(extra.field.bbox)}
              />
              <div className="table__remove">
                <button type="button" aria-label={`Remover outro campo ${index + 1}`} title="Remover campo" onClick={() => onRemoveExtra(extra.id)}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="block__foot">
        <button type="button" className="button button--small" onClick={onAddExtra}>
          Adicionar outro campo
        </button>
      </div>
    </section>
  );
}
