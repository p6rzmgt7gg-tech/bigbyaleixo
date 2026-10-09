/** O nome da aplicação: BIG - Broadcast Information Generator. */
export function Wordmark({ variant }: { variant: 'hero' | 'bar' }) {
  return (
    <span className={`wordmark wordmark--${variant}`}>
      <span className="wordmark__big">BIG</span>
      <span className="wordmark__by">- Broadcast Information Generator</span>
    </span>
  );
}
