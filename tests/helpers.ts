/** Shared test fixtures. */

import type { Collider } from '../src/core/colliders.js';
import { COLLIDER_IDS } from '../src/core/colliders.js';
import { BOARD_X, RIM_Y } from '../src/core/constants.js';
import { v2 } from '../src/core/units.js';
import type { World } from '../src/core/world.js';
import { REGULATION_LEVEL } from '../src/levels/default.js';
import type { Level } from '../src/levels/schema.js';
import { buildWorld } from '../src/levels/schema.js';

export const REG_WORLD: World = buildWorld(REGULATION_LEVEL);

/** A world with no colliders at all, for checking the integrator against closed-form motion. */
export function emptyWorld(): World {
  const level: Level = {
    version: 1,
    id: 'test-empty',
    name: 'Empty',
    bounds: { min: v2(-1e4, -1e4), max: v2(1e4, 1e4) },
    goal: { boardX: BOARD_X, rimY: RIM_Y },
    colliders: [],
    shooter: { x: 0, releaseY: 0 },
  };
  return buildWorld(level);
}

/** A world containing only a hardwood floor, for the regulation drop test. */
export function floorOnlyWorld(): World {
  const floor: Collider = {
    kind: 'segment',
    id: COLLIDER_IDS.floor,
    a: v2(-50, 0),
    b: v2(50, 0),
    material: 'hardwood',
  };
  const level: Level = {
    version: 1,
    id: 'test-floor',
    name: 'Floor only',
    bounds: { min: v2(-50, 0), max: v2(50, 100) },
    goal: { boardX: BOARD_X, rimY: RIM_Y },
    colliders: [floor],
    shooter: { x: 0, releaseY: 2 },
  };
  return buildWorld(level);
}

/**
 * Seeded PRNG. Tests may use randomness so long as it is reproducible — the §4.1 ban on randomness
 * applies to the sim core, not to the harness that probes it.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
