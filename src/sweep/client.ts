/**
 * Main-thread client for the sweep worker.
 *
 * Falls back to running the sweep synchronously when Workers are unavailable (jsdom under test, or
 * a file:// page). The fallback produces identical tables — it is the same pure function — it just
 * blocks while it runs.
 */

import type { MaterialOverrides } from '../core/materials.js';
import type { World } from '../core/world.js';
import type { SweepSpec, SweepTable } from './grid.js';
import { sweepGrid } from './grid.js';
import type { SweepRequest, SweepResponse } from './sweep.worker.js';

export interface SweepHandle {
  readonly promise: Promise<SweepTable>;
  cancel(): void;
}

/** Thrown into the promise by `cancel()`, so callers can tell a cancellation from a failure. */
export const CANCELLED = 'sweep cancelled';

export function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.message === CANCELLED;
}

export interface SweepOptions {
  readonly onProgress?: (done: number, total: number) => void;
  readonly materialOverrides?: MaterialOverrides;
  /** Used only by the synchronous fallback. */
  readonly world: World;
}

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

export function runSweep(spec: SweepSpec, opts: SweepOptions): SweepHandle {
  if (!workersAvailable()) {
    const table = sweepGrid(opts.world, spec, (p) => opts.onProgress?.(p.done, p.total));
    return { promise: Promise.resolve(table), cancel: () => {} };
  }

  const worker = new Worker(new URL('./sweep.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectOuter: (err: Error) => void = () => {};

  const promise = new Promise<SweepTable>((resolve, reject) => {
    rejectOuter = reject;
    worker.onmessage = (ev: MessageEvent<SweepResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'progress') {
        opts.onProgress?.(msg.done, msg.total);
        return;
      }
      settled = true;
      if (msg.kind === 'done') resolve(msg.table);
      else reject(new Error(msg.message));
      worker.terminate();
    };
    worker.onerror = (ev) => {
      settled = true;
      reject(new Error(ev.message || 'sweep worker failed'));
      worker.terminate();
    };

    const req: SweepRequest = opts.materialOverrides
      ? { kind: 'sweep', spec, materialOverrides: opts.materialOverrides }
      : { kind: 'sweep', spec };
    worker.postMessage(req);
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker.terminate();
      // Reject rather than leaving the promise pending forever; callers filter with
      // isCancellation().
      rejectOuter(new Error(CANCELLED));
    },
  };
}
