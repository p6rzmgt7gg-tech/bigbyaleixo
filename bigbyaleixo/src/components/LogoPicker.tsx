import { DEFAULT_LOGO_URL } from '../pdf/defaultLogo';
import { useRef, useState } from 'react';
import { useSession, type ExtraFile } from '../state/session';
import { createRowId } from '../utils/fields';
import { isPdf } from '../utils/pdfToImage';
import { ImagePicker } from './ImagePicker';

/** Logótipo do canto superior esquerdo do PDF: Medialuso por omissão, ou outro (PNG ou JPG). */
export function LogoPicker() {
  const { state, dispatch } = useSession();
  return (
    <ImagePicker
      label="Logótipo no PDF"
      current={state.logo}
      empty={
        <div className="logo-picker__current">
          <img src={DEFAULT_LOGO_URL} alt="Logótipo Medialuso (por omissão)" />
          <p className="pdf__hint">Por omissão, o logótipo Medialuso.</p>
        </div>
      }
      chooseText="Escolher logótipo"
      replaceText="Trocar logótipo"
      removeText="Repor Medialuso"
      alt="Logótipo escolhido"
      onChange={(image) => dispatch(image ? { type: 'logo-set', logo: image } : { type: 'logo-removed' })}
    />
  );
}

/** Mapa de câmaras do jogo: aparece no PDF entre a logística e as observações. */
export function CameraMapPicker() {
  const { state, dispatch } = useSession();
  return (
    <ImagePicker
      label="Mapa de câmaras"
      current={state.cameraMap}
      empty={<p className="pdf__hint">Sem mapa. Escolha o mapa de câmaras deste jogo (PDF, PNG ou JPG); vai para a página seguinte do PDF.</p>}
      acceptPdf
      chooseText="Escolher mapa"
      replaceText="Trocar mapa"
      removeText="Remover"
      alt="Mapa de câmaras"
      onChange={(image) => dispatch(image ? { type: 'camera-map-set', image } : { type: 'camera-map-removed' })}
    />
  );
}

const MAX_EXTRA_BYTES = 15 * 1024 * 1024;

/** Ficheiros acrescentados no fim do PDF, a seguir ao mapa de câmaras (PDF, PNG ou JPG). */
export function ExtraFilesPicker() {
  const { state, dispatch } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async (files: File[]): Promise<void> => {
    setProblem(null);
    for (const file of files) {
      const name = file.name.toLowerCase();
      const kind: ExtraFile['kind'] | null = isPdf(file)
        ? 'pdf'
        : file.type === 'image/png' || name.endsWith('.png')
          ? 'png'
          : file.type === 'image/jpeg' || /\.jpe?g$/.test(name)
            ? 'jpg'
            : null;
      if (!kind) {
        setProblem('Os ficheiros têm de ser PDF, PNG ou JPG.');
        continue;
      }
      if (file.size > MAX_EXTRA_BYTES) {
        setProblem('Cada ficheiro tem de ter menos de 15 MB.');
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      dispatch({ type: 'extra-file-added', file: { id: createRowId(), name: file.name, kind, bytes } });
    }
  };

  return (
    <div className="logo-picker">
      <p className="logo-picker__label">Ficheiros a seguir ao mapa</p>
      {state.extraFiles.length === 0 ? (
        <p className="pdf__hint">Nenhum. Pode acrescentar PDFs (todas as páginas) ou imagens; entram no fim do PDF, pela ordem da lista.</p>
      ) : (
        <ol className="extra-files">
          {state.extraFiles.map((file) => (
            <li key={file.id} className="extra-files__item">
              <span className="extra-files__name">{file.name}</span>
              <button type="button" className="button button--small" onClick={() => dispatch({ type: 'extra-file-removed', id: file.id })}>
                Remover
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="button button--small" onClick={() => input.current?.click()}>
        Acrescentar ficheiro
      </button>
      <input
        ref={input}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length) void add(files);
          event.target.value = '';
        }}
      />
      {problem && (
        <p className="pdf__hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
