import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { HeaderEditor } from '../components/HeaderEditor';
import { HeaderFields } from '../components/HeaderFields';
import { OriginalViewer } from '../components/OriginalViewer';
import { SectionEditor } from '../components/SectionEditor';
import { saveSession, useSession } from '../state/session';
import { getTemplate } from '../templates';
import type { BBox, CallSheetDocument, ColumnKey, HeaderKey, SectionKey } from '../types/callSheet';
import { confidenceLevel, needsReview, rowLevel } from '../utils/fields';
import { formatTime } from '../utils/formatters';
import { NEEDS_REVIEW_MESSAGE } from '../utils/messages';

/** Quantos campos lidos pelo OCR ainda pedem atenção, e quantas pessoas há no documento. */
function summarize(document: CallSheetDocument, columnsBySection: Map<SectionKey, ColumnKey[]>): { people: number; toConfirm: number; unrecognized: number } {
  let toConfirm = 0;
  let unrecognized = 0;
  const count = (level: ReturnType<typeof confidenceLevel>): void => {
    if (level === 'check') toConfirm++;
    if (level === 'low') unrecognized++;
  };
  for (const [key, field] of Object.entries(document.header)) {
    if (key !== 'others' && !Array.isArray(field)) count(confidenceLevel(field));
  }
  for (const extra of document.header.others) count(confidenceLevel(extra.field));
  let people = 0;
  for (const [section, rows] of Object.entries(document.sections) as [SectionKey, CallSheetDocument['sections'][SectionKey]][]) {
    const columns = columnsBySection.get(section) ?? [];
    people += rows.length;
    for (const row of rows) {
      const levels = columns.map((column) => confidenceLevel(row[column]));
      levels.forEach(count);
      // Linha lida sem nome: conta como um campo não reconhecido.
      if (!levels.some(needsReview) && rowLevel(row, columns) === 'low') unrecognized++;
    }
  }
  return { people, toConfirm, unrecognized };
}

export function PreviewPage() {
  const { state, dispatch } = useSession();
  const navigate = useNavigate();
  const [highlight, setHighlight] = useState<BBox | null>(null);
  const [confirmingReprocess, setConfirmingReprocess] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const { document } = state;

  const template = useMemo(() => getTemplate(document?.template ?? ''), [document?.template]);
  const columnsBySection = useMemo(
    () => new Map(template.sections.map((section) => [section.key, section.columns.map((column) => column.key)])),
    [template],
  );

  // Acabado de processar: guarda logo, para um recarregamento acidental não obrigar a repetir o OCR.
  useEffect(() => {
    if (document && state.savedAt === null && !state.dirty) {
      const now = Date.now();
      if (saveSession(state, now)) dispatch({ type: 'saved', at: now });
    }
  }, [document, state, dispatch]);

  // Avisa antes de sair com alterações por guardar.
  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);

  const locate = useCallback((bbox: BBox | undefined) => setHighlight(bbox ?? null), []);
  const editCell = useCallback(
    (section: SectionKey, rowId: string, column: ColumnKey, value: string) => dispatch({ type: 'cell-edited', section, rowId, column, value }),
    [dispatch],
  );
  const editHeader = useCallback((key: HeaderKey, value: string) => dispatch({ type: 'header-edited', key, value }), [dispatch]);
  const addRow = useCallback((section: SectionKey) => dispatch({ type: 'row-added', section }), [dispatch]);
  const removeRow = useCallback((section: SectionKey, rowId: string) => dispatch({ type: 'row-removed', section, rowId }), [dispatch]);

  if (!document) return <Navigate to={state.source ? '/process' : '/'} replace />;

  const { people, toConfirm, unrecognized } = summarize(document, columnsBySection);
  const blocks = template.sections.filter((section) => document.sections[section.key]?.length > 0).length;

  const save = (): void => {
    const now = Date.now();
    if (saveSession(state, now)) {
      dispatch({ type: 'saved', at: now });
      setSaveFailed(false);
    } else {
      setSaveFailed(true);
    }
  };

  return (
    <main className="page page--wide">
      <div className="review">
        <OriginalViewer source={state.source} fileName={state.fileName} highlight={highlight} />

        <div className="review__data">
          <div className="review__head">
            <h1>Documento processado</h1>
            <p className="review__summary">
              {people === 1 ? '1 pessoa' : `${people} pessoas`} em {blocks === 1 ? '1 bloco' : `${blocks} blocos`}
            </p>
          </div>

          {toConfirm + unrecognized > 0 && (
            <p className={`notice ${unrecognized > 0 ? 'notice--stop' : 'notice--hold'}`} role="status">
              <strong>{NEEDS_REVIEW_MESSAGE}</strong>
              <span>
                {[toConfirm > 0 ? `${toConfirm} para confirmar` : '', unrecognized > 0 ? `${unrecognized} não reconhecido${unrecognized === 1 ? '' : 's'}` : '']
                  .filter(Boolean)
                  .join(', ')}
                . Clique num campo para o ver assinalado na imagem.
              </span>
            </p>
          )}

          {state.unassigned.length > 0 && (
            <details className="unassigned">
              <summary>
                {state.unassigned.length === 1 ? '1 texto lido não foi atribuído a nenhum campo' : `${state.unassigned.length} textos lidos não foram atribuídos a nenhum campo`}
              </summary>
              <ul>
                {state.unassigned.map((text, index) => (
                  <li key={`${text}-${index}`}>{text}</li>
                ))}
              </ul>
            </details>
          )}

          <HeaderEditor
            fields={template.headerFields.filter((field) => field.group === 'title' || field.group === 'info')}
            header={document.header}
            onEdit={editHeader}
            onEditExtra={(id, part, value) => dispatch({ type: 'extra-edited', id, part, value })}
            onAddExtra={() => dispatch({ type: 'extra-added' })}
            onRemoveExtra={(id) => dispatch({ type: 'extra-removed', id })}
            onLocate={locate}
          />

          {template.sections.map((section) => {
            const group = template.groups.find((candidate) => candidate.key === section.group);
            const firstOfGroup = group && template.sections.find((candidate) => candidate.group === group.key) === section;
            return (
              <div key={section.key}>
                {firstOfGroup && <p className="group-title">{group.title}</p>}
                <SectionEditor
                  section={section}
                  rows={document.sections[section.key] ?? []}
                  onEdit={editCell}
                  onAdd={addRow}
                  onRemove={removeRow}
                  onLocate={locate}
                >
                  {section.key === 'drivers' && (
                    <HeaderFields fields={template.headerFields.filter((field) => field.group === 'logistics')} header={document.header} onEdit={editHeader} onLocate={locate} />
                  )}
                </SectionEditor>
              </div>
            );
          })}

          <section className="block" aria-label="Observações">
            <h2 className="block__title">OBSERVAÇÕES</h2>
            <HeaderFields fields={template.headerFields.filter((field) => field.group === 'notes')} header={document.header} onEdit={editHeader} onLocate={locate} />
          </section>

          <div className="actionbar">
            <div className="actionbar__group">
              <button type="button" className="button" onClick={() => navigate('/')}>
                Voltar
              </button>
              {confirmingReprocess ? (
                <>
                  <span className="actionbar__status">As correções feitas perdem-se. Processar de novo?</span>
                  <button type="button" className="button button--small" onClick={() => navigate('/process')}>
                    Sim, processar
                  </button>
                  <button type="button" className="button button--small" onClick={() => setConfirmingReprocess(false)}>
                    Não
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={!state.source}
                  title={state.source ? undefined : 'A imagem original já não está em memória; carregue-a de novo.'}
                  onClick={() => (state.dirty ? setConfirmingReprocess(true) : navigate('/process'))}
                >
                  Processar novamente
                </button>
              )}
            </div>
            <div className="actionbar__group">
              <span className="actionbar__status" role="status">
                {saveFailed
                  ? 'Este browser não permitiu guardar os dados.'
                  : state.dirty
                    ? 'Alterações por guardar'
                    : state.savedAt
                      ? `Guardado às ${formatTime(state.savedAt)}`
                      : ''}
              </span>
              <button type="button" className="button" onClick={save} disabled={!state.dirty && state.savedAt !== null}>
                Guardar dados
              </button>
              <button type="button" className="button button--primary" onClick={() => navigate('/pdf')}>
                Gerar PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
