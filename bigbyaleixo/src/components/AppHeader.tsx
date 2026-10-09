import { Link, useLocation } from 'react-router';
import { Wordmark } from './Wordmark';

const STEPS = [
  { path: '/', label: 'Carregar' },
  { path: '/process', label: 'Processar' },
  { path: '/preview', label: 'Validar' },
  { path: '/pdf', label: 'PDF' },
];

export function AppHeader() {
  const { pathname } = useLocation();
  const current = Math.max(
    0,
    STEPS.findIndex((step) => step.path === pathname),
  );
  return (
    <header className="topbar">
      <Link to="/" aria-label="BIG - Broadcast Information Generator, início">
        <Wordmark variant="bar" />
      </Link>
      <nav aria-label="Passos">
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.path} aria-current={index === current ? 'step' : undefined} data-done={index < current}>
              <span className="steps__number">{index + 1}</span>
              <span className="steps__label">{step.label}</span>
            </li>
          ))}
        </ol>
      </nav>
    </header>
  );
}
