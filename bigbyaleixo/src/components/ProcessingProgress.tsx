import type { CSSProperties } from 'react';
import { STAGE_START, type PipelineStage } from '../ocr/pipeline';
import { STAGE_LABELS } from '../utils/messages';
import { CheckIcon } from './Icons';

interface ProcessingProgressProps {
  stage: PipelineStage;
  percent: number;
}

const STAGES = Object.keys(STAGE_START) as PipelineStage[];

/** Progresso do processamento: fase atual, percentagem e a lista das fases. */
export function ProcessingProgress({ stage, percent }: ProcessingProgressProps) {
  const current = STAGES.indexOf(stage);
  return (
    <div>
      <div className="process__readout">
        <p className="process__stage" role="status" aria-live="polite">
          {STAGE_LABELS[stage]}
        </p>
        <p className="process__percent" aria-hidden="true">
          {percent}
          <small>%</small>
        </p>
      </div>
      <div
        className="bars"
        role="progressbar"
        aria-label="Progresso do processamento"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ '--progress': `${percent}%` } as CSSProperties}
      >
        <div className="bars__fill" />
      </div>
      <ol className="process__steps">
        {STAGES.filter((candidate) => candidate !== 'done').map((candidate, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'pending';
          return (
            <li key={candidate} data-state={state}>
              <span className="process__mark" aria-hidden="true">
                {state === 'done' ? <CheckIcon /> : index + 1}
              </span>
              {STAGE_LABELS[candidate].replace('…', '')}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
