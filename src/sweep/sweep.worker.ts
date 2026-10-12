/**
 * Sweep worker (DESIGN.md §12).
 *
 * Exists so a few thousand simulations do not freeze the UI. It can load the core unchanged because
 * the core imports nothing — no DOM, no logger, no canvas — which is the payoff of the §4
 * architecture rule.
 */

import type { MaterialOverrides } from '../core/materials.js';
import { buildWorld } from '../levels/schema.js';
import { REGULATION_LEVEL } from '../levels/default.js';
import type { SweepSpec, SweepTable } from './grid.js';
import { sweepGrid } from './grid.js';

export interface SweepRequest {
  readonly kind: 'sweep';
  readonly spec: SweepSpec;
  readonly materialOverrides?: MaterialOverrides;
}

export type SweepResponse =
  | { readonly kind: 'progress'; readonly done: number; readonly total: number }
  | { readonly kind: 'done'; readonly table: SweepTable }
  | { readonly kind: 'error'; readonly message: string };

self.onmessage = (ev: MessageEvent<SweepRequest>) => {
  const req = ev.data;
  if (req.kind !== 'sweep') return;

  try {
    // Only the regulation level exists in v1; a level editor would send the Level itself instead.
    const world = buildWorld(REGULATION_LEVEL, req.materialOverrides);
    const table = sweepGrid(world, req.spec, (p) => {
      const msg: SweepResponse = { kind: 'progress', done: p.done, total: p.total };
      self.postMessage(msg);
    });
    const msg: SweepResponse = { kind: 'done', table };
    self.postMessage(msg);
  } catch (err) {
    const msg: SweepResponse = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
