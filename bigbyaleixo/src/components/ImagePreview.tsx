import type { SourceImage } from '../state/session';
import { formatBytes, formatDimensions } from '../utils/formatters';
import { Frame } from './Frame';

interface ImagePreviewProps {
  source: SourceImage;
  onRemove: () => void;
}

/** O ficheiro escolhido: pré-visualização, nome, tamanho e dimensões. */
export function ImagePreview({ source, onRemove }: ImagePreviewProps) {
  return (
    <Frame className="selected">
      <div className="selected__image">
        <img src={source.url} alt={`Pré-visualização de ${source.file.name}`} />
      </div>
      <div className="selected__facts">
        <dl className="facts">
          <div>
            <dt>Ficheiro</dt>
            <dd>{source.file.name}</dd>
          </div>
          <div>
            <dt>Tamanho</dt>
            <dd>{formatBytes(source.file.size)}</dd>
          </div>
          <div>
            <dt>Dimensões</dt>
            <dd>{formatDimensions(source.width, source.height)}</dd>
          </div>
        </dl>
        <div>
          <button type="button" className="button button--small" onClick={onRemove}>
            Remover
          </button>
        </div>
      </div>
    </Frame>
  );
}
