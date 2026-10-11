/**
 * Static collider primitives and swept queries (DESIGN.md §5.3, §5.4).
 *
 * Only two shapes exist: a segment and a circle. The regulation level needs nothing else, and
 * obstacles from the stretch-goal level editor are expressed in the same two.
 *
 * Segments behave as capsules of zero thickness: the closest-point query clamps to the segment, so
 * endpoints give correct rounded response for free. That is what makes the ball roll off the lip of
 * the backboard instead of catching on an infinitely sharp corner.
 *
 * Detection is SWEPT, not discrete. The rim nodes are ~1 cm in radius and the ball can be moving
 * 10 m/s, so a discrete overlap test would miss them outright (DESIGN.md §5.4).
 */

import type { MaterialId } from './materials.js';
import type { Metres, Seconds, Vec2 } from './units.js';
import { add, addScaled, dot, len, len2, norm, scale, sub, v2 } from './units.js';

export interface SegmentCollider {
  readonly kind: 'segment';
  readonly id: string;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly material: MaterialId;
}

export interface CircleCollider {
  readonly kind: 'circle';
  readonly id: string;
  readonly c: Vec2;
  readonly r: Metres;
  readonly material: MaterialId;
}

export type Collider = SegmentCollider | CircleCollider;

/**
 * Reserved collider ids. Every level must use these for the goal and floor, because scoring
 * classifies contacts by id (rim contact => 'rattle', board contact => 'bank', DESIGN.md §6).
 * Anything else is treated as an obstacle.
 */
export const COLLIDER_IDS = {
  floor: 'floor',
  board: 'backboard',
  rimFront: 'rim_front',
  rimBack: 'rim_back',
} as const;

export type ContactRole = 'floor' | 'board' | 'rim' | 'obstacle';

export function contactRole(id: string): ContactRole {
  if (id === COLLIDER_IDS.floor) return 'floor';
  if (id === COLLIDER_IDS.board) return 'board';
  if (id === COLLIDER_IDS.rimFront || id === COLLIDER_IDS.rimBack) return 'rim';
  return 'obstacle';
}

export interface Hit {
  /** Time of impact within the queried window. */
  readonly t: Seconds;
  /** Unit normal pointing from the surface toward the ball centre. */
  readonly normal: Vec2;
  /** Ball centre position at impact. */
  readonly centre: Vec2;
  readonly collider: Collider;
  /** Index in the world's collider array — the deterministic tie-break (DESIGN.md §4.1 rule 3). */
  readonly index: number;
}

const EPS = 1e-12;

// ---------------------------------------------------------------------------------------------
// Static queries
// ---------------------------------------------------------------------------------------------

/** Closest point on the collider's surface skeleton to p (segment line / circle centre+r). */
export function closestPointOn(col: Collider, p: Vec2): Vec2 {
  if (col.kind === 'circle') {
    const d = sub(p, col.c);
    const l = len(d);
    if (l < EPS) return add(col.c, v2(col.r, 0));
    return addScaled(col.c, scale(d, 1 / l), col.r);
  }
  const ab = sub(col.b, col.a);
  const l2 = len2(ab);
  if (l2 < EPS) return col.a;
  let s = dot(sub(p, col.a), ab) / l2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return addScaled(col.a, ab, s);
}

/**
 * Distance from the ball centre to the collider surface, minus nothing — i.e. the gap is
 * `distanceTo(...) - R_BALL`. Negative gap means penetration.
 */
export function distanceTo(col: Collider, p: Vec2): number {
  return len(sub(p, closestPointOn(col, p)));
}

/** Unit normal from the collider surface toward p. */
export function normalAt(col: Collider, p: Vec2): Vec2 {
  const q = closestPointOn(col, p);
  const d = sub(p, q);
  if (len2(d) < EPS) {
    // Degenerate: ball centre exactly on the surface skeleton. Fall back to the segment normal, or
    // straight up for a circle, so response stays defined rather than producing NaN.
    if (col.kind === 'segment') {
      const ab = sub(col.b, col.a);
      return norm(v2(-ab.y, ab.x));
    }
    return v2(0, 1);
  }
  return norm(d);
}

// ---------------------------------------------------------------------------------------------
// Swept queries
// ---------------------------------------------------------------------------------------------

/**
 * Earliest t in [0, tMax] at which a point travelling p0 -> p0 + v*t is exactly `radius` from
 * `centre`. Returns null if it never is within the window, or if already inside and separating.
 *
 * This is the one quadratic the whole collision system rests on: it serves circle colliders
 * directly, and segment endpoints as the radius-0 case.
 */
function sweepAgainstPoint(
  p0: Vec2,
  v: Vec2,
  tMax: Seconds,
  centre: Vec2,
  radius: Metres,
): Seconds | null {
  const w = sub(p0, centre);
  const vv = len2(v);
  const wv = dot(w, v);
  const ww = len2(w);
  const rr = radius * radius;

  if (ww <= rr) {
    // Already overlapping. Report an immediate contact only if approaching, otherwise let it
    // separate — this is what stops a resting ball from re-colliding every substep forever.
    return wv < 0 ? 0 : null;
  }
  if (vv < EPS) return null;

  const disc = wv * wv - vv * (ww - rr);
  if (disc < 0) return null;

  const t = (-wv - Math.sqrt(disc)) / vv;
  if (t < 0 || t > tMax) return null;
  return t;
}

/**
 * Swept circle (the ball, radius R) against one collider.
 *
 * For a segment this is three candidate contacts — the flat face plus the two endpoint caps — and
 * we take the earliest. The face test is linear, the caps are the quadratic above.
 */
export function sweep(
  col: Collider,
  index: number,
  p0: Vec2,
  v: Vec2,
  tMax: Seconds,
  R: Metres,
): Hit | null {
  if (col.kind === 'circle') {
    const t = sweepAgainstPoint(p0, v, tMax, col.c, R + col.r);
    if (t === null) return null;
    const centre = addScaled(p0, v, t);
    return { t, normal: normalAt(col, centre), centre, collider: col, index };
  }

  const ab = sub(col.b, col.a);
  const abLen2 = len2(ab);
  if (abLen2 < EPS) {
    const t = sweepAgainstPoint(p0, v, tMax, col.a, R);
    if (t === null) return null;
    const centre = addScaled(p0, v, t);
    return { t, normal: norm(sub(centre, col.a)), centre, collider: col, index };
  }

  let best: Hit | null = null;

  // --- Face ---------------------------------------------------------------------------------
  // Segments are two-sided (DESIGN.md §5.3): a shot that sails over the backboard must be able to
  // come back off its rear face. So the normal is oriented toward whichever side the ball is on.
  let n = norm(v2(-ab.y, ab.x));
  let d0 = dot(sub(p0, col.a), n);
  if (d0 < 0) {
    n = scale(n, -1);
    d0 = -d0;
  }
  const vn = dot(v, n);

  let tFace: Seconds | null = null;
  if (d0 <= R) {
    // Starting inside the slab: immediate contact if approaching.
    if (vn < 0) tFace = 0;
  } else if (vn < -EPS) {
    tFace = (d0 - R) / -vn;
  }

  if (tFace !== null && tFace <= tMax) {
    // The face contact only counts if the contact point actually lies on the segment; otherwise an
    // endpoint cap is the real contact and the quadratics below will find it.
    const centre = addScaled(p0, v, tFace);
    const s = dot(sub(centre, col.a), ab) / abLen2;
    if (s >= 0 && s <= 1) {
      best = { t: tFace, normal: n, centre, collider: col, index };
    }
  }

  // --- Endpoint caps ------------------------------------------------------------------------
  for (const end of [col.a, col.b]) {
    const t = sweepAgainstPoint(p0, v, tMax, end, R);
    if (t === null) continue;
    if (best !== null && t >= best.t) continue;
    const centre = addScaled(p0, v, t);
    best = { t, normal: norm(sub(centre, end)), centre, collider: col, index };
  }

  return best;
}

/**
 * Earliest hit across every collider in the world.
 *
 * Ties break by ascending collider index, so a ball striking the rim and the backboard on the same
 * substep always resolves in the same order (DESIGN.md §4.1 rule 3). The colliders array is ordered
 * and that order is part of the level.
 */
export function earliestHit(
  colliders: readonly Collider[],
  p0: Vec2,
  v: Vec2,
  tMax: Seconds,
  R: Metres,
): Hit | null {
  let best: Hit | null = null;
  for (let i = 0; i < colliders.length; i++) {
    const col = colliders[i];
    if (col === undefined) continue;
    const hit = sweep(col, i, p0, v, tMax, R);
    if (hit === null) continue;
    // Strictly-less keeps the lowest index on an exact tie.
    if (best === null || hit.t < best.t) best = hit;
  }
  return best;
}
