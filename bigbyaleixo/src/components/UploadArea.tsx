import { useId, useRef, useState, type DragEvent } from 'react';
import { ACCEPTED_EXTENSIONS } from '../utils/validators';
import { Frame } from './Frame';

interface UploadAreaProps {
  onFile: (file: File) => void;
}

/** Zona para arrastar o call sheet ou escolhê-lo no computador. */
export function UploadArea({ onFile }: UploadAreaProps) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <Frame
      className="dropzone"
      data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <p className="dropzone__title" id={titleId}>
        Arraste o Call Sheet para aqui
      </p>
      <p className="dropzone__or">ou</p>
      <button type="button" className="button" onClick={() => input.current?.click()}>
        Escolher ficheiro
      </button>
      <p className="dropzone__formats">JPG, JPEG, PNG ou HEIC, até 20 MB</p>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        aria-labelledby={titleId}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
    </Frame>
  );
}
