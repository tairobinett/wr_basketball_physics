/**
 * Analytic and real-world checks on the integrator and the floor bounce (DESIGN.md §10).
 *
 * The point of these is to validate against something OUTSIDE the codebase — closed-form projectile
 * motion, and the regulation ball-inflation drop test — rather than against our own output.
 */

import { describe, expect, it } from 'vitest';

import { totalEnergy } from '../src/core/ball.js';
import { DEFAULT_MATERIALS } from '../src/core/materials.js';
import { DT, G, R_BALL } from '../src/core/constants.js';
import { makeDescriptor, Simulation } from '../src/core/sim.js';
import { emptyWorld, floorOnlyWorld } from './helpers.js';

/**
 * Semi-implicit Euler has a known O(g*t*h) position bias against the exact parabola: after time t
 * it has accumulated 0.5*g*t*h of extra drop, which at t=1 s and h=1/240 s is about 2 cm. The
 * tolerances below are sized from that, not picked to make the test pass.
 */
const EULER_BIAS = (t: number) => 0.5 * G * t * DT;

describe('integrator vs. closed-form projectile motion', () => {
  it('reaches the analytic apex for a vertical launch', () => {
    const world = emptyWorld();
    const sim = new Simulation(world);
    sim.release(
      makeDescriptor({ levelId: 'test-empty', shooterX: 0, releaseY: 10, angleDeg: 90, speed: 10 }),
    );

    let apex = -Infinity;
    for (let i = 0; i < 2000 && sim.ball.v.y > 0; i++) {
      sim.step();
      apex = Math.max(apex, sim.ball.p.y);
    }

    // h_max = y0 + v^2 / 2g
    const analytic = 10 + (10 * 10) / (2 * G);
    expect(apex).toBeCloseTo(analytic, 1);
    expect(Math.abs(apex - analytic)).toBeLessThan(EULER_BIAS(1.02) + 0.005);
  });

  it('matches the analytic range for a 45 degree launch', () => {
    const world = emptyWorld();
    const sim = new Simulation(world);
    const speed = 12;
    const y0 = 50;
    sim.release(
      makeDescriptor({
        levelId: 'test-empty',
        shooterX: 0,
        releaseY: y0,
        angleDeg: 45,
        speed,
      }),
    );

    // Step until it falls back to the launch height.
    let guard = 0;
    while (sim.ball.p.y >= y0 && guard++ < 5000) sim.step();

    // R = v^2 * sin(2*theta) / g, with sin(90 deg) = 1
    const analytic = (speed * speed) / G;
    expect(sim.ball.p.x).toBeCloseTo(analytic, 1);
  });

  it('conserves energy in free flight to within integrator bias', () => {
    const world = emptyWorld();
    const sim = new Simulation(world);
    sim.release(
      makeDescriptor({ levelId: 'test-empty', shooterX: 0, releaseY: 100, angleDeg: 40, speed: 9 }),
    );
    const e0 = totalEnergy(sim.ball);
    for (let i = 0; i < 480; i++) sim.step();
    // Symplectic Euler does not conserve energy exactly, but it must not drift far over 2 s.
    expect(Math.abs(totalEnergy(sim.ball) - e0) / e0).toBeLessThan(0.01);
  });
});

describe('regulation drop test (FIBA ball-inflation spec)', () => {
  /**
   * The spec, with its measurement conventions, which are easy to get wrong and which change the
   * implied restitution a lot:
   *
   *   Dropped from 1.80 m measured to the BOTTOM of the ball, it must rebound to between 1.20 m
   *   and 1.40 m measured to the TOP of the ball.
   *
   * So the centre falls from (1.80 + R) to R — a fall of 1.80 m — and must rise to a centre height
   * between (1.20 - R) and (1.40 - R), i.e. a rise of 0.961 m to 1.161 m. That implies
   * e = sqrt(rise / fall) between 0.731 and 0.803, which is where hardwood.e = 0.77 comes from.
   */
  const DROP_BOTTOM = 1.8;
  const REBOUND_TOP_MIN = 1.2;
  const REBOUND_TOP_MAX = 1.4;

  it('implies the restitution we ship', () => {
    const riseMin = REBOUND_TOP_MIN - 2 * R_BALL;
    const riseMax = REBOUND_TOP_MAX - 2 * R_BALL;
    const eMin = Math.sqrt(riseMin / DROP_BOTTOM);
    const eMax = Math.sqrt(riseMax / DROP_BOTTOM);
    expect(DEFAULT_MATERIALS.hardwood.e).toBeGreaterThan(eMin);
    expect(DEFAULT_MATERIALS.hardwood.e).toBeLessThan(eMax);
  });

  it('rebounds inside the regulation window', () => {
    const sim = new Simulation(floorOnlyWorld());
    sim.release(
      makeDescriptor({
        levelId: 'test-floor',
        shooterX: 0,
        releaseY: DROP_BOTTOM + R_BALL,
        angleDeg: 0,
        speed: 0,
      }),
    );

    // Fall, bounce, then record the peak of the rebound.
    let guard = 0;
    while (sim.ball.v.y <= 0 && guard++ < 5000) sim.step();
    let peakCentre = sim.ball.p.y;
    while (sim.ball.v.y > 0 && guard++ < 5000) {
      sim.step();
      peakCentre = Math.max(peakCentre, sim.ball.p.y);
    }

    const reboundTop = peakCentre + R_BALL;
    expect(reboundTop).toBeGreaterThan(REBOUND_TOP_MIN);
    expect(reboundTop).toBeLessThan(REBOUND_TOP_MAX);
  });

  it('comes to rest on the floor rather than micro-bouncing forever', () => {
    const sim = new Simulation(floorOnlyWorld());
    sim.release(
      makeDescriptor({
        levelId: 'test-floor',
        shooterX: 0,
        releaseY: 2.0,
        angleDeg: 0,
        speed: 0,
      }),
    );
    const result = sim.runToCompletion();
    expect(result.reason).toBe('at_rest');
    expect(sim.ball.p.y).toBeCloseTo(R_BALL, 2);
  });
});
