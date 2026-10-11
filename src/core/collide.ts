/**
 * Collision response (DESIGN.md §5.5).
 *
 * Impulse-based, with Coulomb friction and a restitution floor. The ball is the only moving body
 * and every collider is static, so there is no mass ratio to worry about: impulses act on the ball
 * alone.
 *
 * Two properties this code relies on, both from `r` being antiparallel to `n` for a sphere:
 *
 *  - The NORMAL impulse produces no torque (r x n = 0), so effective normal mass is just m.
 *  - The TANGENTIAL lever arm is exactly R, so effective tangential mass is a constant:
 *      1/m_t = 1/m + R^2/I  =  1/m + 3/(2m)  =  2.5/m   (hollow sphere, I = (2/3)mR^2)
 *    i.e. m_t = 0.4m. That is precomputed below rather than recomputed per contact.
 */

import type { BallState } from './ball.js';
import { kineticEnergy } from './ball.js';
import type { Hit } from './colliders.js';
import { CONTACT_SKIN, I_BALL, M_BALL, R_BALL, RESTITUTION_FLOOR_SPEED } from './constants.js';
import type { Material } from './materials.js';
import type { AngVel, Vec2 } from './units.js';
import { add, addScaled, cross, crossAngVel, dot, len, scale, sub } from './units.js';

/** 1/m_t for the tangential direction. Constant for a sphere — see the note above. */
const INV_TANGENT_MASS = 1 / M_BALL + (R_BALL * R_BALL) / I_BALL;

/** Below this sliding speed there is no meaningful tangential direction to work with. */
const MIN_SLIDE_SPEED = 1e-9;

export interface ContactResult {
  readonly vIn: Vec2;
  readonly vOut: Vec2;
  readonly omegaIn: AngVel;
  readonly omegaOut: AngVel;
  /** Normal impulse magnitude (N*s). */
  readonly jn: number;
  /** Tangential impulse magnitude (N*s). */
  readonly jt: number;
  /** Change in kinetic + rotational energy (J). Must be <= 0. */
  readonly dE: number;
  /** True when the approach speed was low enough that restitution was forced to zero. */
  readonly restitutionFloored: boolean;
  /** True when friction saturated, i.e. the contact slid rather than gripped. */
  readonly sliding: boolean;
}

/**
 * Resolve one contact, mutating the ball's velocity, spin and position.
 *
 * The ball is assumed to be AT the contact configuration already (the integrator advances it to
 * `hit.centre` by construction of the swept query). Returns null if the contact is separating, in
 * which case nothing is mutated and no impulse is applied — this is what lets a resting ball stop
 * generating contacts instead of buzzing forever.
 */
export function resolveContact(ball: BallState, hit: Hit, mat: Material): ContactResult | null {
  const n = hit.normal;

  // Ball centre -> contact point. Antiparallel to the normal, by definition, for a sphere.
  const r = scale(n, -R_BALL);

  // Velocity of the material point of the ball that is actually touching the surface.
  const vc = add(ball.v, crossAngVel(ball.omega, r));
  const vn = dot(vc, n);

  // Separating (or exactly grazing): no impulse.
  if (vn >= 0) return null;

  const vIn = ball.v;
  const omegaIn = ball.omega;
  const eIn = kineticEnergy(ball);

  // --- Normal impulse -------------------------------------------------------------------------
  // A settling ball would otherwise micro-bounce indefinitely and flood the log (DESIGN.md §5.5).
  const restitutionFloored = Math.abs(vn) < RESTITUTION_FLOOR_SPEED;
  const e = restitutionFloored ? 0 : mat.e;
  const jn = -(1 + e) * vn * M_BALL;
  ball.v = addScaled(ball.v, n, jn / M_BALL);

  // --- Tangential impulse (Coulomb) -----------------------------------------------------------
  const vt = sub(vc, scale(n, vn));
  const slideSpeed = len(vt);
  let jt = 0;
  let sliding = false;
  if (slideSpeed > MIN_SLIDE_SPEED) {
    const tDir = scale(vt, 1 / slideSpeed);
    const jStop = slideSpeed / INV_TANGENT_MASS; // impulse that would exactly kill the sliding
    const jMax = mat.mu * jn; // friction cone
    sliding = jStop > jMax;
    jt = sliding ? jMax : jStop;
    const jVec = scale(tDir, -jt);
    ball.v = addScaled(ball.v, jVec, 1 / M_BALL);
    // This is where spin is born, and where backspin kills forward velocity on a rim hit.
    ball.omega += cross(r, jVec) / I_BALL;
  }

  // --- Depenetrate ----------------------------------------------------------------------------
  // The swept query puts the centre exactly R from the surface; nudge it out by a skin so the same
  // contact cannot retrigger on the next query.
  ball.p = addScaled(hit.centre, n, CONTACT_SKIN);

  return {
    vIn,
    vOut: ball.v,
    omegaIn,
    omegaOut: ball.omega,
    jn,
    jt,
    dE: kineticEnergy(ball) - eIn,
    restitutionFloored,
    sliding,
  };
}
