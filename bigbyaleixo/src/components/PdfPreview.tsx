import { useEffect, useRef, useState } from 'react';
import { PDFWorker, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
// O worker do pdf.js é empacotado pelo Vite como ficheiro .js da própria aplicação.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * Pré-visualização do PDF dentro da aplicação: desenha as páginas a partir dos mesmos
 * bytes que são descarregados, com zoom.
 */
export function PdfPreview({ bytes, fileName, onRendered }: { bytes: Uint8Array; fileName: string; onRendered: (ok: boolean) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(2);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);

  // Abre o documento (um worker por documento; fecha-se ao sair ou ao gerar outro).
  useEffect(() => {
    // (Os tipos do pdf.js não declaram `port` como Worker, embora seja o que aceita.)
    const worker = new PDFWorker({ port: new PdfWorker() } as unknown as ConstructorParameters<typeof PDFWorker>[0]);
    // O pdf.js fica com o buffer que recebe: trabalha sobre uma cópia.
    const task = getDocument({ data: bytes.slice(), worker, isEvalSupported: false });
    let cancelled = false;
    task.promise.then(
      (document) => {
        if (!cancelled) setPdf(document);
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error(error);
        onRendered(false);
      },
    );
    return () => {
      cancelled = true;
      setPdf(null);
      void task.destroy().finally(() => worker.destroy());
    };
  }, [bytes, onRendered]);

  // Desenha as páginas ao tamanho escolhido.
  useEffect(() => {
    const target = holder.current;
    if (!pdf || !target) return;
    let cancelled = false;
    (async () => {
      const width = target.clientWidth - 32;
      const canvases: HTMLCanvasElement[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const scale = (Math.max(320, width) / base.width) * (ZOOMS[zoom] ?? 1);
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages}`);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        if (cancelled) return;
        canvases.push(canvas);
      }
      target.replaceChildren(...canvases);
      onRendered(true);
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error(error);
      onRendered(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, zoom, onRendered]);

  const pages = pdf?.numPages ?? 0;
  return (
    <div className="pdf__preview pdf__preview--pages">
      <div className="pdf__zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="button button--small" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Diminuir">
          −
        </button>
        <span>{Math.round((ZOOMS[zoom] ?? 1) * 100)}%</span>
        <button type="button" className="button button--small" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Aumentar">
          +
        </button>
        <span className="pdf__pages">{pages > 0 ? `${pages} ${pages === 1 ? 'página' : 'páginas'}` : ''}</span>
      </div>
      <div className="pdf__canvas" ref={holder} aria-label={`Pré-visualização de ${fileName}`} />
    </div>
  );
}
