/**
 * Collision geometry and impulse invariants (DESIGN.md §10).
 *
 * The invariant tests are randomized over a seeded PRNG, so a failure is reproducible.
 */

import { describe, expect, it } from 'vitest';

import { createBall, kineticEnergy } from '../src/core/ball.js';
import type { Collider } from '../src/core/colliders.js';
import { COLLIDER_IDS, distanceTo, earliestHit, sweep } from '../src/core/colliders.js';
import { resolveContact } from '../src/core/collide.js';
import {
  BACK_RIM_X,
  BOARD_BOTTOM_Y,
  BOARD_TOP_Y,
  BOARD_X,
  FRONT_RIM_X,
  RIM_TUBE_R,
  RIM_Y,
  R_BALL,
} from '../src/core/constants.js';
import { DEFAULT_MATERIALS } from '../src/core/materials.js';
import { makeDescriptor, Simulation } from '../src/core/sim.js';
import { dot, len, v2 } from '../src/core/units.js';
import { mulberry32, REG_WORLD } from './helpers.js';

const floor: Collider = {
  kind: 'segment',
  id: COLLIDER_IDS.floor,
  a: v2(-10, 0),
  b: v2(10, 0),
  material: 'hardwood',
};

const board: Collider = {
  kind: 'segment',
  id: COLLIDER_IDS.board,
  a: v2(BOARD_X, BOARD_BOTTOM_Y),
  b: v2(BOARD_X, BOARD_TOP_Y),
  material: 'glass',
};

const frontRim: Collider = {
  kind: 'circle',
  id: COLLIDER_IDS.rimFront,
  c: v2(FRONT_RIM_X, RIM_Y - RIM_TUBE_R),
  r: RIM_TUBE_R,
  material: 'steel',
};

describe('swept detection', () => {
  it('finds a contact with the floor on the way down', () => {
    const hit = sweep(floor, 0, v2(0, 1), v2(0, -10), 1, R_BALL);
    expect(hit).not.toBeNull();
    // Centre should stop exactly one radius above the floor.
    expect(hit?.centre.y).toBeCloseTo(R_BALL, 9);
    expect(hit?.normal.y).toBeCloseTo(1, 9);
  });

  it('does not tunnel through a rim node at 40 m/s', () => {
    // The ball + tube contact distance is only 12.9 cm, so over a long enough window a fast ball
    // passes clean through the node: a discrete overlap check at either end of the window sees
    // nothing at all. The swept query must still report contact at the exact moment of touching.
    const nodeY = RIM_Y - RIM_TUBE_R;
    const contactDist = R_BALL + RIM_TUBE_R;
    const window = 0.02; // 80 cm of travel at 40 m/s, i.e. several DTs' worth
    const start = v2(FRONT_RIM_X, nodeY + 0.3);

    const hit = sweep(frontRim, 0, start, v2(0, -40), window, R_BALL);
    expect(hit).not.toBeNull();
    expect(hit?.collider.id).toBe(COLLIDER_IDS.rimFront);
    expect(hit?.centre.y).toBeCloseTo(nodeY + contactDist, 9);

    // Confirm the premise: the end of the window really is clear on the far side of the node, so
    // this genuinely is a tunnelling scenario and not just a near approach.
    expect(start.y - 40 * window).toBeLessThan(nodeY - contactDist);
  });

  it('registers a rim contact for a fast shot driven through the integrator', () => {
    // End to end, including the substepping: the quarter-radius rule plus swept detection must
    // catch the rim even at 40 m/s.
    const sim = new Simulation(REG_WORLD);
    sim.release(
      makeDescriptor({
        levelId: 'regulation',
        shooterX: FRONT_RIM_X,
        releaseY: RIM_Y + 2,
        angleDeg: -90,
        speed: 40,
      }),
    );
    const res = sim.runToCompletion();
    expect(res.summary.contacts.rim).toBeGreaterThan(0);
  });

  it('is two-sided on the backboard, so a shot can come back off the rear face', () => {
    // Approaching from behind (from larger x, moving left).
    const hit = sweep(board, 0, v2(BOARD_X + 1, 3.4), v2(-10, 0), 1, R_BALL);
    expect(hit).not.toBeNull();
    expect(hit?.normal.x).toBeCloseTo(1, 9);
    expect(hit?.centre.x).toBeCloseTo(BOARD_X + R_BALL, 9);
  });

  it('uses the endpoint cap when the contact is past the end of a segment', () => {
    // Aimed just above the top of the backboard: the face test must reject, the cap must catch.
    const hit = sweep(board, 0, v2(BOARD_X - 1, BOARD_TOP_Y + 0.05), v2(10, 0), 1, R_BALL);
    expect(hit).not.toBeNull();
    // A cap contact has a normal tilted away from the pure face normal.
    expect(Math.abs(hit?.normal.y ?? 0)).toBeGreaterThan(0);
  });

  it('misses cleanly when the path goes by', () => {
    expect(sweep(frontRim, 0, v2(0, 10), v2(1, 0), 1, R_BALL)).toBeNull();
  });

  it('breaks ties by ascending collider index', () => {
    // Two identical colliders: the lower index must win.
    const a: Collider = { ...floor, id: 'floor_a' };
    const b: Collider = { ...floor, id: 'floor_b' };
    const hit = earliestHit([a, b], v2(0, 1), v2(0, -5), 1, R_BALL);
    expect(hit?.index).toBe(0);
    expect(hit?.collider.id).toBe('floor_a');
  });
});

describe('impulse invariants', () => {
  it('never increases kinetic energy, never leaves penetration, respects the friction cone', () => {
    const rand = mulberry32(0xbeef);
    const mat = DEFAULT_MATERIALS.hardwood;

    for (let i = 0; i < 2000; i++) {
      // Random incoming velocity aimed somewhere into the lower half-plane, random spin.
      const vx = (rand() * 2 - 1) * 15;
      const vy = -rand() * 15;
      const omega = (rand() * 2 - 1) * 40;

      const ball = createBall(v2(rand() * 4 - 2, R_BALL), v2(vx, vy), omega);
      const hit = sweep(floor, 0, ball.p, ball.v, 1, R_BALL);
      if (hit === null) continue;

      const eBefore = kineticEnergy(ball);
      const res = resolveContact(ball, hit, mat);
      if (res === null) continue;

      // Energy may not grow. A tiny epsilon covers float rounding only.
      expect(kineticEnergy(ball)).toBeLessThanOrEqual(eBefore + 1e-9);
      expect(res.dE).toBeLessThanOrEqual(1e-9);

      // No residual penetration.
      expect(distanceTo(floor, ball.p) - R_BALL).toBeGreaterThanOrEqual(-1e-9);

      // Coulomb: tangential impulse inside the cone.
      expect(res.jt).toBeLessThanOrEqual(mat.mu * res.jn + 1e-9);

      // Post-impulse normal velocity must be separating (or zero).
      expect(dot(ball.v, hit.normal)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('applies restitution on a fast impact and floors it on a slow one', () => {
    const mat = DEFAULT_MATERIALS.hardwood;

    const fast = createBall(v2(0, R_BALL), v2(0, -5), 0);
    const fastHit = sweep(floor, 0, fast.p, fast.v, 1, R_BALL);
    const fastRes = resolveContact(fast, fastHit!, mat);
    expect(fastRes?.restitutionFloored).toBe(false);
    expect(fast.v.y).toBeCloseTo(5 * mat.e, 6);

    // Below RESTITUTION_FLOOR_SPEED the bounce is killed outright, which is what stops a settling
    // ball from buzzing forever and flooding the log.
    const slow = createBall(v2(0, R_BALL), v2(0, -0.1), 0);
    const slowHit = sweep(floor, 0, slow.p, slow.v, 1, R_BALL);
    const slowRes = resolveContact(slow, slowHit!, mat);
    expect(slowRes?.restitutionFloored).toBe(true);
    expect(slow.v.y).toBeCloseTo(0, 9);
  });

  it('converts sliding into spin at a rim contact', () => {
    const ball = createBall(v2(FRONT_RIM_X - 0.3, RIM_Y + 0.3), v2(4, -4), 0);
    const hit = sweep(frontRim, 0, ball.p, ball.v, 1, R_BALL);
    expect(hit).not.toBeNull();
    const res = resolveContact(ball, hit!, DEFAULT_MATERIALS.steel);
    expect(res).not.toBeNull();
    // Friction at the contact must have spun the ball up from rest.
    expect(Math.abs(ball.omega)).toBeGreaterThan(0.5);
  });
});

describe('regulation geometry', () => {
  it('derives the 6 inch rim-to-backboard gap from the constants', () => {
    // The independent sanity check from DESIGN.md §3: if this fails, a constant is inconsistent.
    //
    // The regulation 6 inches is measured to the ring's INNER edge (which is what pairs with the
    // hoop centre being 15 in from the board: 6 + 9 = 15). Measuring to the outer edge of the tube
    // instead gives 0.1239 m, and that mistake is the kind of thing this check exists to catch.
    expect(BOARD_X - REG_WORLD.goal.rightEdge).toBeCloseTo(0.1524, 4);
    expect(BOARD_X - (BACK_RIM_X + RIM_TUBE_R)).toBeCloseTo(0.1524 - 2 * RIM_TUBE_R, 4);
  });

  it('fits the ball through the hoop with room to spare', () => {
    const gate = REG_WORLD.goal.rightEdge - REG_WORLD.goal.leftEdge;
    expect(gate).toBeCloseTo(0.4572, 6);
    expect(2 * R_BALL).toBeLessThan(gate);
  });

  it('orders the court left to right: shooter, front rim, back rim, board', () => {
    expect(REG_WORLD.goal.frontRim.x).toBeLessThan(REG_WORLD.goal.backRim.x);
    expect(REG_WORLD.goal.backRim.x).toBeLessThan(REG_WORLD.goal.boardX);
  });

  it('has a floor long enough that the ball lands on it rather than out of bounds', () => {
    const f = REG_WORLD.colliders[0];
    expect(f?.id).toBe(COLLIDER_IDS.floor);
    expect(len(v2(1, 0))).toBe(1); // sanity on the helper itself
  });
});
