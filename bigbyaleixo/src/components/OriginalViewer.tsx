import { useEffect, useRef, useState } from 'react';
import type { SourceImage } from '../state/session';
import type { BBox } from '../types/callSheet';

interface OriginalViewerProps {
  source: SourceImage | null;
  fileName: string | null;
  /** Zona a destacar (em píxeis da imagem original). */
  highlight: BBox | null;
}

const ZOOM_LEVELS = [1, 1.5, 2.25, 3.5];

/** A imagem original, sempre à vista durante a validação, com o campo em foco assinalado. */
export function OriginalViewer({ source, fileName, highlight }: OriginalViewerProps) {
  const [zoom, setZoom] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // Começa na ampliação mais baixa em que o texto se lê (perto do tamanho real da imagem).
  useEffect(() => {
    const container = stage.current;
    if (!container || !source) return;
    const fitScale = (container.clientWidth - 32) / source.width;
    const readable = ZOOM_LEVELS.findIndex((level) => fitScale * level >= 0.85);
    setZoom(readable === -1 ? ZOOM_LEVELS.length - 1 : readable);
  }, [source]);

  // Traz o campo em foco para o centro da área visível.
  useEffect(() => {
    const container = stage.current;
    if (!container || !source || !highlight) return;
    const canvas = container.firstElementChild as HTMLElement | null;
    if (!canvas) return;
    const scale = canvas.clientWidth / source.width;
    const centerX = canvas.offsetLeft + ((highlight.x0 + highlight.x1) / 2) * scale;
    const centerY = canvas.offsetTop + ((highlight.y0 + highlight.y1) / 2) * scale;
    container.scrollTo({ left: centerX - container.clientWidth / 2, top: centerY - container.clientHeight / 2 });
  }, [highlight, source, zoom]);

  const percent = (value: number, total: number): string => `${(value / total) * 100}%`;

  return (
    <aside className="review__original" aria-label="Imagem original" data-collapsed={collapsed}>
      <div className="viewer__bar">
        <span className="viewer__name">{fileName ?? 'Original'}</span>
        <div className="viewer__zoom">
          <button type="button" className="viewer__toggle" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
            {collapsed ? 'Mostrar' : 'Esconder'}
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0, value - 1))} disabled={!source || zoom === 0} aria-label="Reduzir">
            −
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1))} disabled={!source || zoom === ZOOM_LEVELS.length - 1} aria-label="Ampliar">
            +
          </button>
        </div>
      </div>
      <div className="viewer__stage" ref={stage}>
        {source ? (
          <div className="viewer__canvas" style={{ width: `${ZOOM_LEVELS[zoom] * 100}%` }}>
            <img src={source.url} alt="Call sheet original" />
            {highlight && (
              <div
                className="viewer__highlight"
                style={{
                  left: percent(highlight.x0 - 3, source.width),
                  top: percent(highlight.y0 - 3, source.height),
                  width: percent(highlight.x1 - highlight.x0 + 6, source.width),
                  height: percent(highlight.y1 - highlight.y0 + 6, source.height),
                }}
              />
            )}
          </div>
        ) : (
          <p className="viewer__empty">
            A imagem original só fica em memória enquanto a página está aberta, por isso deixou de estar disponível depois de recarregar. Os dados guardados continuam aqui.
          </p>
        )}
      </div>
    </aside>
  );
}
