import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ProcessingProgress } from '../components/ProcessingProgress';
import { PipelineError, type AnalysisResult, type PipelineErrorCode, type PipelineProgress } from '../ocr/pipeline';
import { processCallSheet } from '../ocr/processCallSheet';
import { useSession } from '../state/session';
import { DEFAULT_TEMPLATE } from '../templates';
import { ERROR_MESSAGES } from '../utils/messages';

interface Failure {
  code: PipelineErrorCode;
  partial?: AnalysisResult;
}

export function ProcessPage() {
  const { state, dispatch } = useSession();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<PipelineProgress>({ stage: 'prepare', percent: 0 });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const file = state.source?.file;

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    setFailure(null);
    setProgress({ stage: 'prepare', percent: 0 });

    processCallSheet(file, DEFAULT_TEMPLATE, { onProgress: setProgress, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        dispatch({ type: 'analysis-finished', result });
        navigate('/preview', { replace: true });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof PipelineError) {
          setFailure({ code: error.code, partial: error.partial });
        } else {
          // O detalhe técnico fica na consola; ao utilizador mostra-se uma mensagem clara.
          console.error(error);
          setFailure({ code: 'unreadable' });
        }
      });
    return () => controller.abort();
  }, [file, attempt, dispatch, navigate]);

  if (!file) return <Navigate to="/" replace />;

  if (failure) {
    const message = ERROR_MESSAGES[failure.code];
    return (
      <main className="page">
        <div className="process">
          <div className="problem" role="alert">
            <h1>{message.title}</h1>
            <p>{message.hint}</p>
          </div>
          <div className="process__actions">
            <button type="button" className="button button--primary" onClick={() => navigate('/')}>
              Escolher outro ficheiro
            </button>
            {failure.code === 'not_a_call_sheet' ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  dispatch({ type: 'manual-started', partial: failure.partial });
                  navigate('/preview', { replace: true });
                }}
              >
                Continuar e preencher à mão
              </button>
            ) : (
              <button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>
                Tentar novamente
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="process">
        <p className="process__file">{file.name}</p>
        <h1 className="visually-hidden">A processar o call sheet</h1>
        <ProcessingProgress stage={progress.stage} percent={progress.percent} />
        <div className="process__actions">
          <button type="button" className="button" onClick={() => navigate('/')}>
            Cancelar
          </button>
        </div>
      </div>
    </main>
  );
}
