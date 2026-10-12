/**
 * Vector math and unit aliases.
 *
 * Per DESIGN.md §14, ALL vector arithmetic in the core goes through this module. No `.x`/`.y`
 * arithmetic is written inline in collide.ts / forces.ts / integrate.ts, so that swapping Vec2 for
 * a Vec3 is a mechanical change in those files rather than a rewrite.
 *
 * Per DESIGN.md §4.1, nothing here may use a transcendental function. `len()` uses sqrt, which is
 * bit-exact under IEEE 754; sin/cos live in sim.ts at release time only.
 */

/** Metres, seconds, kilograms, radians — SI everywhere (DESIGN.md §3). */
export type Metres = number;
export type Seconds = number;

/**
 * Angular velocity. A scalar in 2D (CCW positive); becomes a Vec3 in a hypothetical 3D port, which
 * is why it is an alias rather than a bare `number` at call sites (DESIGN.md §14).
 */
export type AngVel = number;

export interface Vec2 {
  readonly x: Metres;
  readonly y: Metres;
}

export const ZERO: Vec2 = { x: 0, y: 0 };

export function v2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

/** a + b*s — fused because it is the most common operation in the integrator. */
export function addScaled(a: Vec2, b: Vec2, s: number): Vec2 {
  return { x: a.x + b.x * s, y: a.y + b.y * s };
}

export function neg(a: Vec2): Vec2 {
  return { x: -a.x, y: -a.y };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 2D cross product. Returns a scalar here; in 3D it returns a vector. Kept behind a function so no
 * call site ever inlines `ax*by - ay*bx` (DESIGN.md §14).
 */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** The 2D analogue of (omega * k) x r, i.e. rotate r by +90 degrees and scale. */
export function crossAngVel(w: AngVel, r: Vec2): Vec2 {
  return { x: -w * r.y, y: w * r.x };
}

export function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return len(sub(a, b));
}

/** Unit vector. Returns ZERO for a zero-length input rather than NaN. */
export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : ZERO;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Distance from point p to the segment ab.
 *
 * Used to measure how close a trajectory passed to something. Sampling the distance at step
 * endpoints alone would be step-size dependent — at 4 m/s the ball moves 1.7 cm per step and can
 * skip straight past the closest point — so clearances are measured against the swept segment
 * instead, which is exact for piecewise-linear motion.
 */
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = len2(ab);
  if (l2 < 1e-20) return dist(p, a);
  let t = dot(sub(p, a), ab) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist(p, addScaled(a, ab, t));
}

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
