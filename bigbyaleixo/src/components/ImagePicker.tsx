import { useRef, useState, type ReactNode } from 'react';
import type { SessionLogo } from '../state/session';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ImagePickerProps {
  label: string;
  current: SessionLogo | null;
  /** O que mostrar quando não há imagem escolhida. */
  empty: ReactNode;
  chooseText: string;
  replaceText: string;
  removeText: string;
  alt: string;
  onChange: (image: SessionLogo | null) => void;
}

/** Escolha de uma imagem (PNG ou JPG) para o PDF. Fica só no browser. */
export function ImagePicker({ label, current, empty, chooseText, replaceText, removeText, alt, onChange }: ImagePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File): Promise<void> => {
    setProblem(null);
    const name = file.name.toLowerCase();
    const type = file.type === 'image/png' || name.endsWith('.png') ? 'png' : file.type === 'image/jpeg' || /\.jpe?g$/.test(name) ? 'jpg' : null;
    if (!type) {
      setProblem('A imagem tem de ser PNG ou JPG.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setProblem('A imagem tem de ter menos de 5 MB.');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    onChange({ bytes, type, url: URL.createObjectURL(file) });
  };

  return (
    <div className="logo-picker">
      <p className="logo-picker__label">{label}</p>
      {current ? (
        <div className="logo-picker__current">
          <img src={current.url} alt={alt} />
          <button type="button" className="button button--small" onClick={() => onChange(null)}>
            {removeText}
          </button>
        </div>
      ) : (
        empty
      )}
      <button type="button" className="button button--small" onClick={() => input.current?.click()}>
        {current ? replaceText : chooseText}
      </button>
      <input
        ref={input}
        type="file"
        accept=".png,.jpg,.jpeg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
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
