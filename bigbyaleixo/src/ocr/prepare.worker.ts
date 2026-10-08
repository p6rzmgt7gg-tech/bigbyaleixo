/// <reference lib="webworker" />
import { prepareImage, type PreparedImage } from './prepare';
import type { RgbaImage } from './raster';

export type PrepareResponse = { ok: true; prepared: PreparedImage } | { ok: false };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<RgbaImage>) => {
  try {
    const prepared = prepareImage(event.data);
    scope.postMessage({ ok: true, prepared } satisfies PrepareResponse, [prepared.clean.data.buffer]);
  } catch {
    scope.postMessage({ ok: false } satisfies PrepareResponse);
  }
};
