import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ImagePreview } from '../components/ImagePreview';
import { UploadArea } from '../components/UploadArea';
import { Wordmark } from '../components/Wordmark';
import { isImageTooSmall } from '../ocr/imagePreprocessor';
import type { PipelineErrorCode } from '../ocr/pipeline';
import { useSession } from '../state/session';
import { ERROR_MESSAGES } from '../utils/messages';
import { checkImageFile, isHeic } from '../utils/validators';

/** Lê as dimensões da imagem; falha se o ficheiro não for uma imagem válida. */
async function measure(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function HomePage() {
  const { state, dispatch } = useSession();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<PipelineErrorCode | null>(null);

  const selectFile = async (file: File): Promise<void> => {
    setProblem(null);
    const invalid = checkImageFile(file);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    let size: { width: number; height: number };
    try {
      size = await measure(file);
    } catch {
      setProblem(isHeic(file) ? 'heic_unsupported' : 'unreadable');
      return;
    }
    if (isImageTooSmall(size.width, size.height)) {
      setProblem('image_too_small');
      return;
    }
    dispatch({ type: 'source-selected', source: { file, url: URL.createObjectURL(file), ...size } });
  };

  return (
    <main className="page">
      <div className="home__title">
        <div>
          <h1>
            <Wordmark variant="hero" />
          </h1>
        </div>
      </div>

      {state.source ? (
        <ImagePreview source={state.source} onRemove={() => dispatch({ type: 'source-removed' })} />
      ) : (
        <UploadArea onFile={(file) => void selectFile(file)} />
      )}

      {problem && (
        <p className="notice notice--stop" role="alert">
          <strong>{ERROR_MESSAGES[problem].title}</strong>
          {ERROR_MESSAGES[problem].hint}
        </p>
      )}

      {!state.source && state.document && (
        <p className="notice">
          <span>
            Tem dados guardados nesta sessão{state.fileName ? ` (${state.fileName})` : ''}.
          </span>
          <Link className="button button--small" to="/preview">
            Continuar a validar
          </Link>
        </p>
      )}

      <div className="home__actions">
        <button type="button" className="button button--primary" disabled={!state.source} onClick={() => navigate('/process')}>
          Processar Call Sheet
        </button>
      </div>
    </main>
  );
}
