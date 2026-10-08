import type { ConfidenceLevel } from '../types/callSheet';
import { LEVEL_LABELS } from '../utils/fields';

/**
 * Indicador de confiança: verde (alta confiança), amarelo (confirmar), vermelho
 * (não reconhecido). Um campo corrigido à mão aparece como "Editado".
 */
export function ConfidenceBadge({ level, compact = false }: { level: ConfidenceLevel; compact?: boolean }) {
  if (level === 'empty') return null;
  return (
    <span className={`lamp${compact ? ' lamp--dot' : ''}`} data-level={level} title={compact ? LEVEL_LABELS[level] : undefined}>
      <span>{LEVEL_LABELS[level]}</span>
    </span>
  );
}
