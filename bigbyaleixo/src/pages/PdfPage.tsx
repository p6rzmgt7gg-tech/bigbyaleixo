import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { PdfPreview } from '../components/PdfPreview';
import { CameraMapPicker, LogoPicker } from '../components/LogoPicker';
import { loadDefaultLogo } from '../pdf/defaultLogo';
import { loadPdfFonts } from '../pdf/fonts';
import { generateCallSheetPdf } from '../pdf/pdfGenerator';
import { useSession } from '../state/session';
import { getTemplate } from '../templates';
import { formatBytes } from '../utils/formatters';

interface ReadyPdf {
  url: string;
  fileName: string;
  pageCount: number;
  size: number;
}

export function PdfPage() {
  const { state, dispatch } = useSession();
  const navigate = useNavigate();
  const [pdf, setPdf] = useState<ReadyPdf | null>(null);
  const [failed, setFailed] = useState(false);
  const { document, logo, cameraMap } = state;

  useEffect(() => {
    if (!document) return;
    let url: string | null = null;
    let cancelled = false;
    setFailed(false);
    loadPdfFonts()
      .then(async (fonts) => generateCallSheetPdf(document, getTemplate(document.template), { fonts, logo: logo ?? (await loadDefaultLogo()), cameraMap }))
      .then((generated) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([generated.bytes as BlobPart], { type: 'application/pdf' }));
        setPdf({ url, fileName: generated.fileName, pageCount: generated.pageCount, size: generated.bytes.length });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document, logo, cameraMap]);

  if (!document) return <Navigate to="/" replace />;

  return (
    <main className="page page--wide">
      <div className="pdf">
        {pdf ? <PdfPreview url={pdf.url} fileName={pdf.fileName} /> : <div className="pdf__preview" aria-busy={!failed} />}
        <div className="pdf__side">
          <h1>{failed ? 'Não foi possível gerar o PDF.' : pdf ? 'PDF gerado' : 'A gerar o PDF…'}</h1>
          {failed && <p className="pdf__hint">Volte à validação, confirme os dados e tente outra vez.</p>}
          {pdf && (
            <dl className="facts">
              <div>
                <dt>Ficheiro</dt>
                <dd>{pdf.fileName}</dd>
              </div>
              <div>
                <dt>Páginas</dt>
                <dd>{pdf.pageCount}</dd>
              </div>
              <div>
                <dt>Tamanho</dt>
                <dd>{formatBytes(pdf.size)}</dd>
              </div>
            </dl>
          )}
          <div className="pdf__buttons">
            {pdf && (
              <a className="button button--primary" href={pdf.url} download={pdf.fileName}>
                Descarregar PDF
              </a>
            )}
            <Link className="button" to="/preview">
              Voltar à validação
            </Link>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                dispatch({ type: 'reset' });
                navigate('/');
              }}
            >
              Começar outro call sheet
            </button>
          </div>
          <CameraMapPicker />
          <LogoPicker />
          {pdf && (
            <p className="pdf__hint">
              O texto do PDF é texto real: pode ser pesquisado, selecionado e impresso. Se a pré-visualização não aparecer neste browser,{' '}
              <a href={pdf.url} target="_blank" rel="noreferrer">
                abra o PDF num novo separador
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
