import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { PdfPreview } from '../components/PdfPreview';
import { loadDefaultLogo } from '../pdf/defaultLogo';
import { loadPdfFonts } from '../pdf/fonts';
import { generateCallSheetPdf } from '../pdf/pdfGenerator';
import { useSession } from '../state/session';
import { getTemplate } from '../templates';

interface ReadyPdf {
  bytes: Uint8Array;
  url: string;
  fileName: string;
}

export function PdfPage() {
  const { state } = useSession();
  const [pdf, setPdf] = useState<ReadyPdf | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [round, setRound] = useState(0);
  const { document, logo, cameraMap, pdfSections } = state;

  useEffect(() => {
    if (!document) return;
    let url: string | null = null;
    let cancelled = false;
    setFailed(false);
    setShown(false);
    setPdf(null);
    loadPdfFonts()
      .then(async (fonts) =>
        generateCallSheetPdf(document, getTemplate(document.template), { fonts, logo: logo ?? (await loadDefaultLogo()), cameraMap, include: pdfSections }),
      )
      .then((generated) => {
        if (cancelled) return;
        // O ficheiro descarregado é exatamente o que está na pré-visualização.
        url = URL.createObjectURL(new Blob([generated.bytes as BlobPart], { type: 'application/pdf' }));
        setPdf({ bytes: generated.bytes, url, fileName: generated.fileName });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document, logo, cameraMap, pdfSections, round]);

  const rendered = useCallback((ok: boolean) => {
    setShown(ok);
    if (!ok) setFailed(true);
  }, []);

  if (!document) return <Navigate to="/" replace />;

  return (
    <main className="page page--wide">
      <div className="pdf">
        {pdf ? <PdfPreview bytes={pdf.bytes} fileName={pdf.fileName} onRendered={rendered} /> : <div className="pdf__preview" aria-busy={!failed} />}
        <div className="pdf__side">
          <h1>{failed ? 'Não foi possível gerar o PDF.' : shown ? 'Pré-visualização' : 'A gerar o PDF…'}</h1>
          {failed && <p className="pdf__hint">Volte à edição, confirme os dados e tente outra vez.</p>}
          {pdf && shown && <p className="pdf__hint">{pdf.fileName}</p>}
          <div className="pdf__buttons">
            {pdf && shown && (
              <a className="button button--primary" href={pdf.url} download={pdf.fileName}>
                Download PDF
              </a>
            )}
            <button type="button" className="button" onClick={() => setRound((value) => value + 1)}>
              Gerar novamente
            </button>
            <Link className="button" to="/preview">
              Voltar à edição
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
