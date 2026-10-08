/** O nome da aplicação. "BIG" em largura expandida, "by Aleixo" ao lado, mais discreto. */
export function Wordmark({ variant }: { variant: 'hero' | 'bar' }) {
  return (
    <span className={`wordmark wordmark--${variant}`}>
      <span className="wordmark__big">BIG</span>
      <span className="wordmark__by">by Aleixo</span>
    </span>
  );
}
