/** Ball state (DESIGN.md §5.1). */

import { G, I_BALL, M_BALL } from './constants.js';
import type { AngVel, Vec2 } from './units.js';
import { len2, v2 } from './units.js';

export interface BallState {
  /** Centre position (m). */
  p: Vec2;
  /** Velocity (m/s). */
  v: Vec2;
  /** Rotation (rad) — visual, plus spin bookkeeping. */
  theta: number;
  /** Angular velocity (rad/s), CCW positive. Backspin on a right-facing shot is POSITIVE. */
  omega: AngVel;
}

export function createBall(p: Vec2 = v2(0, 0), v: Vec2 = v2(0, 0), omega: AngVel = 0): BallState {
  return { p, v, theta: 0, omega };
}

export function cloneBall(b: BallState): BallState {
  return { p: b.p, v: b.v, theta: b.theta, omega: b.omega };
}

/** Translational + rotational kinetic energy (J). */
export function kineticEnergy(b: BallState): number {
  return 0.5 * M_BALL * len2(b.v) + 0.5 * I_BALL * b.omega * b.omega;
}

/** Total mechanical energy including gravitational potential (J). */
export function totalEnergy(b: BallState): number {
  return kineticEnergy(b) + M_BALL * G * b.p.y;
}
