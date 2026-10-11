/**
 * Level format and World construction (DESIGN.md §9).
 *
 * v1 ships a single regulation level, but it is already expressed in this format so the stretch
 * level editor is additive rather than a refactor. Note the dependency direction: `levels/` imports
 * from `core/`, never the other way round, which keeps the core loadable into a Worker unchanged.
 */

import type { Collider } from '../core/colliders.js';
import type { MaterialOverrides } from '../core/materials.js';
import { resolveMaterials } from '../core/materials.js';
import { R_RIM, RIM_TUBE_R } from '../core/constants.js';
import type { Metres, Vec2 } from '../core/units.js';
import { v2 } from '../core/units.js';
import type { Bounds, World } from '../core/world.js';
import { GRAVITY } from '../core/world.js';

export interface Level {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly bounds: Bounds;
  /** The goal can move; scoring reads geometry from the built World, not from constants. */
  readonly goal: { readonly boardX: Metres; readonly rimY: Metres };
  /** Order is part of the level: it is the deterministic collision tie-break (§4.1 rule 3). */
  readonly colliders: readonly Collider[];
  readonly shooter: { readonly x: Metres; readonly releaseY: Metres };
  /** Stretch: uniform wind, or zones once the editor exists. Only matters with drag enabled. */
  readonly wind?: Vec2;
}

export interface LevelProblem {
  readonly path: string;
  readonly msg: string;
}

/**
 * Validate a level enough to fail loudly on a hand-edited or editor-produced file. Deliberately
 * lightweight — this guards against nonsense, not against malice.
 */
export function validateLevel(level: Level): LevelProblem[] {
  const problems: LevelProblem[] = [];

  if (level.version !== 1) problems.push({ path: 'version', msg: `unsupported: ${level.version}` });
  if (level.colliders.length === 0) problems.push({ path: 'colliders', msg: 'level has none' });

  const { min, max } = level.bounds;
  if (max.x <= min.x || max.y <= min.y) {
    problems.push({ path: 'bounds', msg: 'max must exceed min on both axes' });
  }

  const ids = new Set<string>();
  level.colliders.forEach((c, i) => {
    if (ids.has(c.id)) problems.push({ path: `colliders[${i}].id`, msg: `duplicate: ${c.id}` });
    ids.add(c.id);
    if (c.kind === 'circle' && !(c.r > 0)) {
      problems.push({ path: `colliders[${i}].r`, msg: 'radius must be positive' });
    }
  });

  if (!(level.goal.rimY > 0)) problems.push({ path: 'goal.rimY', msg: 'must be positive' });

  return problems;
}

/** Build the immutable World a Simulation runs against. */
export function buildWorld(level: Level, materialOverrides?: MaterialOverrides): World {
  const hoopX = level.goal.boardX - 0.381;
  return {
    id: level.id,
    name: level.name,
    colliders: level.colliders,
    materials: resolveMaterials(materialOverrides),
    bounds: level.bounds,
    goal: {
      boardX: level.goal.boardX,
      rimY: level.goal.rimY,
      hoopX,
      leftEdge: hoopX - R_RIM,
      rightEdge: hoopX + R_RIM,
      frontRim: v2(hoopX - (R_RIM + RIM_TUBE_R), level.goal.rimY - RIM_TUBE_R),
      backRim: v2(hoopX + (R_RIM + RIM_TUBE_R), level.goal.rimY - RIM_TUBE_R),
    },
    gravity: GRAVITY,
    wind: level.wind ?? v2(0, 0),
  };
}
