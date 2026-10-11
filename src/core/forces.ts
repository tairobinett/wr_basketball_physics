/**
 * Force model (DESIGN.md §5.2).
 *
 * Gravity always applies. Drag, wind and Magnus are stretch goals and are flag-gated OFF by
 * default — the formulas are here because they are cheap and the doc specifies them, but v1 ships
 * with them disabled so the sim is a clean parabola plus collisions.
 *
 * `acceleration()` is the hot path and allocates one vector. `forceBreakdown()` is the logging path
 * and is only ever called when the logger is enabled (DESIGN.md §8, null-logger rule).
 */

import type { BallState } from './ball.js';
import { AIR_DENSITY, BALL_AREA, DRAG_COEFF, MAGNUS_COEFF, M_BALL, R_BALL } from './constants.js';
import type { Vec2 } from './units.js';
import { add, crossAngVel, len, scale, sub, v2, ZERO } from './units.js';
import type { World } from './world.js';

export interface PhysicsFlags {
  /** Quadratic air drag, and with it any effect from wind. */
  readonly drag: boolean;
  /** Magnus lift from spin. Requires some spin to do anything. */
  readonly magnus: boolean;
}

export const NO_AIR: PhysicsFlags = { drag: false, magnus: false };

/** F_drag = -0.5 * rho * Cd * A * |v_rel| * v_rel */
function dragForce(vRel: Vec2): Vec2 {
  const speed = len(vRel);
  if (speed === 0) return ZERO;
  const k = -0.5 * AIR_DENSITY * DRAG_COEFF * BALL_AREA * speed;
  return scale(vRel, k);
}

/**
 * F_magnus = Cm * rho * A * R * (omega x v_rel)
 *
 * In 2D the cross product of a scalar angular velocity with a vector is just that vector rotated
 * 90 degrees and scaled, which is why backspin (positive omega on a right-facing shot) produces
 * lift.
 */
function magnusForce(vRel: Vec2, omega: number): Vec2 {
  if (omega === 0) return ZERO;
  const k = MAGNUS_COEFF * AIR_DENSITY * BALL_AREA * R_BALL;
  return scale(crossAngVel(omega, vRel), k);
}

/** Acceleration on the ball this instant. */
export function acceleration(ball: BallState, world: World, flags: PhysicsFlags): Vec2 {
  if (!flags.drag && !flags.magnus) return world.gravity;

  const vRel = sub(ball.v, world.wind);
  let f = ZERO;
  if (flags.drag) f = add(f, dragForce(vRel));
  if (flags.magnus) f = add(f, magnusForce(vRel, ball.omega));
  return add(world.gravity, scale(f, 1 / M_BALL));
}

/**
 * Per-force breakdown in newtons, for the `step` log event. Logging-path only — never called from
 * the integrator, so an interactive run and a sweep run compute identical trajectories.
 */
export function forceBreakdown(
  ball: BallState,
  world: World,
  flags: PhysicsFlags,
): Record<string, Vec2> {
  const out: Record<string, Vec2> = {
    gravity: v2(world.gravity.x * M_BALL, world.gravity.y * M_BALL),
  };
  if (flags.drag || flags.magnus) {
    const vRel = sub(ball.v, world.wind);
    if (flags.drag) out.drag = dragForce(vRel);
    if (flags.magnus) out.magnus = magnusForce(vRel, ball.omega);
  }
  return out;
}
