import { useMemo, useRef, useState } from 'react';
import { addClientLogo, listClientLogos, logoForClient, removeClientLogo } from '../pdf/clientLogos';
import { useSession } from '../state/session';

/** Logótipo do cliente no canto superior direito do PDF: escolhido pelo cliente lido, ou à mão. */
export function ClientLogoPicker() {
  const { state, dispatch } = useSession();
  const [version, setVersion] = useState(0);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const logos = useMemo(() => listClientLogos(), [version]);
  const client = state.document?.header.client?.value ?? '';
  const automatic = logoForClient(client);
  const chosen = state.clientLogo;

  const add = async (file: File): Promise<void> => {
    setProblem(null);
    if (!/\.(png|jpe?g)$/i.test(file.name)) {
      setProblem('O logótipo tem de ser PNG ou JPG.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setProblem('O logótipo tem de ter menos de 1 MB.');
      return;
    }
    const logo = await addClientLogo(name, file);
    if (!logo) {
      setProblem('Este browser não deixou guardar o logótipo.');
      return;
    }
    setName('');
    setVersion((value) => value + 1);
    dispatch({ type: 'client-logo-chosen', id: logo.id });
  };

  const option = (id: string | null, label: string, url?: string, removable?: boolean) => {
    const active = chosen === id;
    return (
      <div key={id ?? 'auto'} className={`client-logo${active ? ' client-logo--active' : ''}`}>
        <button type="button" className="client-logo__choice" aria-pressed={active} onClick={() => dispatch({ type: 'client-logo-chosen', id })}>
          {url ? <img src={url} alt="" /> : <span className="client-logo__text">{label}</span>}
          <span className="client-logo__name">{url ? label : ''}</span>
        </button>
        {removable && (
          <button
            type="button"
            className="client-logo__remove"
            aria-label={`Apagar ${label}`}
            onClick={() => {
              if (id) removeClientLogo(id);
              if (chosen === id) dispatch({ type: 'client-logo-chosen', id: null });
              setVersion((value) => value + 1);
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="logo-picker">
      <p className="logo-picker__label">Logótipo do cliente</p>
      <div className="client-logos">
        {option(null, automatic ? `Automático (${automatic.name})` : 'Automático')}
        {logos.map((logo) => option(logo.id, logo.name, logo.url, logo.custom))}
        {option('none', 'Nenhum')}
      </div>
      <div className="client-logos__add">
        <input type="text" placeholder="Nome do cliente" value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome do novo cliente" />
        <button type="button" className="button button--small" onClick={() => input.current?.click()}>
          Acrescentar logótipo
        </button>
        <input
          ref={input}
          type="file"
          accept=".png,.jpg,.jpeg"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void add(file);
            event.target.value = '';
          }}
        />
      </div>
      {problem && (
        <p className="pdf__hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
