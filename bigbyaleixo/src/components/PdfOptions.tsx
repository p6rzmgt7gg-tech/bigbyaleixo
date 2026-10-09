import type { PdfSections } from '../pdf/pdfGenerator';
import { useSession } from '../state/session';
import { CameraMapPicker, LogoPicker } from './LogoPicker';

const OPTIONS: { key: keyof PdfSections; label: string }[] = [
  { key: 'logistics', label: 'Logística / Transportes' },
  { key: 'notes', label: 'Observações' },
  { key: 'cameraMap', label: 'Mapa de Câmaras' },
];

/** Opções antes de gerar o PDF: secções a incluir, mapa de câmaras e logótipo. */
export function PdfOptions() {
  const { state, dispatch } = useSession();
  return (
    <section className="block pdf-options" aria-label="Opções do PDF">
      <h2 className="block__title">OPÇÕES DO PDF</h2>
      <div className="pdf-options__checks">
        {OPTIONS.map((option) => (
          <label key={option.key} className="pdf-options__check">
            <input
              type="checkbox"
              checked={state.pdfSections[option.key]}
              onChange={(event) => dispatch({ type: 'pdf-section-toggled', key: option.key, include: event.target.checked })}
            />
            {option.label}
          </label>
        ))}
      </div>
      <div className="pdf-options__pickers">
        {state.pdfSections.cameraMap && <CameraMapPicker />}
        <LogoPicker />
      </div>
    </section>
  );
}
