/**
 * The immutable world a shot is simulated against (DESIGN.md §4).
 *
 * `core/` deliberately does not import from `levels/` — the dependency runs the other way, so the
 * core stays self-contained and loads into a Web Worker unchanged (DESIGN.md §12 performance item 3).
 * `levels/schema.ts` is what turns a Level into one of these.
 *
 * Note that scoring reads goal geometry from HERE rather than from constants.ts, so a level that
 * moves the goal (stretch-goal editor) scores correctly with no change to scoring.ts.
 */

import type { Collider } from './colliders.js';
import { G } from './constants.js';
import type { MaterialTable } from './materials.js';
import type { Metres, Vec2 } from './units.js';
import { v2 } from './units.js';

export interface GoalGeometry {
  /** Backboard face x. */
  readonly boardX: Metres;
  /** Top of the rim. This is also the scoring plane (DESIGN.md §6). */
  readonly rimY: Metres;
  /** Hoop centre x. */
  readonly hoopX: Metres;
  /** Scoring gate: the rim's inner edges. */
  readonly leftEdge: Metres;
  readonly rightEdge: Metres;
  /** Rim node centres, used for the front-rim clearance stat. */
  readonly frontRim: Vec2;
  readonly backRim: Vec2;
}

export interface Bounds {
  readonly min: Vec2;
  readonly max: Vec2;
}

export interface World {
  readonly id: string;
  readonly name: string;
  /** Order matters: it is the deterministic collision tie-break (DESIGN.md §4.1 rule 3). */
  readonly colliders: readonly Collider[];
  readonly materials: MaterialTable;
  readonly bounds: Bounds;
  readonly goal: GoalGeometry;
  /** Gravity acceleration vector. */
  readonly gravity: Vec2;
  /** Uniform wind velocity (m/s). Only has any effect when the drag flag is on (DESIGN.md §5.2). */
  readonly wind: Vec2;
}

export const GRAVITY: Vec2 = v2(0, -G);

export function isOutOfBounds(p: Vec2, b: Bounds): boolean {
  return p.x < b.min.x || p.x > b.max.x || p.y < b.min.y || p.y > b.max.y;
}
