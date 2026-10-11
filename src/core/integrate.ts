/**
 * Fixed-timestep integrator with swept collision handling (DESIGN.md §5.1, §5.4).
 *
 * Semi-implicit (symplectic) Euler: velocity is updated from the acceleration first, then position
 * from the new velocity. Chosen over RK4 because gravity dominates, the error that matters comes
 * from collisions rather than from the smooth arc, and Euler's energy behaviour is predictable.
 *
 * `dt` is always a constant handed down from constants.ts. The substep count depends only on the
 * ball's own speed — never on frame timing (DESIGN.md §4.1 rule 2).
 */

import type { BallState } from './ball.js';
import type { Hit } from './colliders.js';
import { earliestHit } from './colliders.js';
import {
  MAX_CONTACTS_PER_SUBSTEP,
  MAX_STEP_TRAVEL,
  MAX_SUBSTEPS,
  R_BALL,
} from './constants.js';
import type { ContactResult } from './collide.js';
import { resolveContact } from './collide.js';
import type { PhysicsFlags } from './forces.js';
import { acceleration } from './forces.js';
import type { Seconds } from './units.js';
import { addScaled, len } from './units.js';
import type { World } from './world.js';

/** Time below which we treat the remaining substep as spent. */
const TIME_EPS = 1e-12;

export type ContactHook = (hit: Hit, result: ContactResult) => void;

/** Substeps needed so the ball advances at most a quarter radius at a time. */
export function substepCount(speed: number, dt: Seconds): number {
  const travel = speed * dt;
  if (travel <= MAX_STEP_TRAVEL) return 1;
  return Math.min(MAX_SUBSTEPS, Math.ceil(travel / MAX_STEP_TRAVEL));
}

/**
 * Advance one substep: integrate forces, then consume the substep's time budget by sweeping to the
 * earliest contact, resolving it, and continuing with whatever time is left.
 */
function substep(
  ball: BallState,
  world: World,
  flags: PhysicsFlags,
  h: Seconds,
  onContact?: ContactHook,
): void {
  const a = acceleration(ball, world, flags);
  ball.v = addScaled(ball.v, a, h);

  let remaining = h;
  let contacts = 0;

  while (remaining > TIME_EPS && contacts < MAX_CONTACTS_PER_SUBSTEP) {
    const hit = earliestHit(world.colliders, ball.p, ball.v, remaining, R_BALL);
    if (hit === null) break;

    const mat = world.materials[hit.collider.material];
    const result = resolveContact(ball, hit, mat);
    remaining -= hit.t;
    contacts++;

    if (result === null) {
      // Overlapping but separating: nothing to resolve. Advance to the contact configuration and
      // let the next sweep (which will now see it receding) carry on.
      ball.p = hit.centre;
      continue;
    }
    onContact?.(hit, result);
  }

  // Whatever time is left after contacts — or all of it, if there were none.
  // If the contact cap was hit, this just moves the ball with its post-impulse velocity. A ball
  // wedged between rim and backboard is a legitimate outcome, not something to iterate harder at.
  if (remaining > TIME_EPS) {
    ball.p = addScaled(ball.p, ball.v, remaining);
  }

  ball.theta += ball.omega * h;
}

/** Advance the ball by exactly `dt`, subdividing internally as needed. */
export function stepBall(
  ball: BallState,
  world: World,
  flags: PhysicsFlags,
  dt: Seconds,
  onContact?: ContactHook,
): void {
  const n = substepCount(len(ball.v), dt);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    substep(ball, world, flags, h, onContact);
  }
}
