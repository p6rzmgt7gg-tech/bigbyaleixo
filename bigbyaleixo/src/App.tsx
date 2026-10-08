import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppHeader } from './components/AppHeader';
import { HomePage } from './pages/HomePage';
import { PreviewPage } from './pages/PreviewPage';
import { ProcessPage } from './pages/ProcessPage';

// O gerador de PDF só é descarregado quando é preciso.
const PdfPage = lazy(() => import('./pages/PdfPage').then((module) => ({ default: module.PdfPage })));

export function App() {
  return (
    <div className="shell">
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/process" element={<ProcessPage />} />
        <Route path="/preview" element={<PreviewPage />} />
        <Route
          path="/pdf"
          element={
            <Suspense fallback={<main className="page" aria-busy="true" />}>
              <PdfPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
