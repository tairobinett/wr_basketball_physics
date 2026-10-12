/**
 * The determinism contract (DESIGN.md §4.1) and the scoring state machine (§6).
 *
 * These are the tests that make the outcome map trustworthy: if an early-aborted sweep run could
 * disagree with a full interactive run, the map would be lying about the physics.
 */

import { describe, expect, it } from 'vitest';

import { PHYSICS_VERSION, RIM_Y, R_BALL } from '../src/core/constants.js';
import { makeDescriptor, runShot, Simulation } from '../src/core/sim.js';
import type { ShotDescriptor } from '../src/core/sim.js';
import { RingLogger } from '../src/log/logger.js';
import { formatEvent } from '../src/log/format.js';
import { v2 } from '../src/core/units.js';
import { mulberry32, REG_WORLD } from './helpers.js';

function shot(angleDeg: number, speed: number, shooterX = 1.428, releaseY = 2.1): ShotDescriptor {
  return makeDescriptor({ levelId: 'regulation', shooterX, releaseY, angleDeg, speed });
}

describe('replay equality', () => {
  it('produces byte-identical event streams for the same descriptor', () => {
    const d = shot(52, 7.3);

    const run = () => {
      const log = new RingLogger({ stepSampleEvery: 1 });
      const sim = new Simulation(REG_WORLD, log);
      sim.release(d);
      sim.runToCompletion();
      return {
        text: log.toArray().map(formatEvent).join('\n'),
        final: sim.ball,
        ticks: sim.tick,
      };
    };

    const a = run();
    const b = run();

    expect(a.text).toBe(b.text);
    expect(a.ticks).toBe(b.ticks);
    // Bitwise, not approximately.
    expect(a.final.p.x).toBe(b.final.p.x);
    expect(a.final.p.y).toBe(b.final.p.y);
    expect(a.final.v.x).toBe(b.final.v.x);
    expect(a.final.omega).toBe(b.final.omega);
  });

  it('stamps the physics version into every descriptor', () => {
    expect(shot(52, 7.3).physicsVersion).toBe(PHYSICS_VERSION);
  });

  it('is unaffected by how many steps are taken per call', () => {
    // Stand-in for frame-rate independence: stepping one at a time vs. running straight through
    // must give the same answer, because dt never comes from the caller.
    const d = shot(48, 7.8);

    const a = new Simulation(REG_WORLD);
    a.release(d);
    while (a.phase === 'flight') a.step();

    const b = runShot(REG_WORLD, d);

    expect(a.result?.outcome).toBe(b.outcome);
    expect(a.ball.p.x).toBe(b.summary.finalP.x);
    expect(a.ball.p.y).toBe(b.summary.finalP.y);
  });
});

describe('early abort agrees with full simulation', () => {
  it('gives the same outcome class across a spread of shots', () => {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 150; i++) {
      const d = shot(20 + rand() * 65, 4 + rand() * 7);
      const full = runShot(REG_WORLD, d, { earlyAbort: false });
      const quick = runShot(REG_WORLD, d, { earlyAbort: true });
      expect(quick.outcome, `angle=${d.angleDeg} speed=${d.speed}`).toBe(full.outcome);
    }
  });

  it('reports identical statistics, not just identical outcomes', () => {
    // The outcome table is generated with earlyAbort and read as if it described the same shot the
    // court shows. That only holds if every reported statistic is frozen at the same moment in both
    // modes — clearance especially, since it is the client-facing number.
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 60; i++) {
      const d = shot(30 + rand() * 50, 6 + rand() * 3);
      const full = runShot(REG_WORLD, d, { earlyAbort: false }).summary;
      const quick = runShot(REG_WORLD, d, { earlyAbort: true }).summary;
      const label = `angle=${d.angleDeg} speed=${d.speed}`;

      expect(quick.outcome, label).toBe(full.outcome);
      expect(quick.scored, label).toBe(full.scored);
      // Bitwise equality, not approximate.
      expect(quick.rimClearance, label).toBe(full.rimClearance);
      expect(quick.frontRimClearance, label).toBe(full.frontRimClearance);
      expect(quick.backRimClearance, label).toBe(full.backRimClearance);
      expect(quick.closestApproach, label).toBe(full.closestApproach);
      expect(quick.apexY, label).toBe(full.apexY);
      expect(quick.entryAngleDeg, label).toBe(full.entryAngleDeg);
    }
  });

  it('actually saves work', () => {
    const d = shot(70, 5);
    const full = new Simulation(REG_WORLD);
    full.release(d);
    full.runToCompletion({ earlyAbort: false });

    const quick = new Simulation(REG_WORLD);
    quick.release(d);
    quick.runToCompletion({ earlyAbort: true });

    expect(quick.tick).toBeLessThan(full.tick);
  });
});

describe('scoring state machine', () => {
  it('scores a shot sent through the hoop from above', () => {
    const sim = new Simulation(REG_WORLD);
    // Drop straight down through the middle of the hoop.
    sim.release(
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: RIM_Y + 1,
        angleDeg: 0,
        speed: 0,
      }),
    );
    const res = sim.runToCompletion();
    expect(res.summary.scored).toBe(true);
    expect(res.outcome).toBe('swish');
    expect(res.summary.entryAngleDeg).toBeCloseTo(90, 0);
  });

  it('does not score a ball passing upward through the hoop', () => {
    const sim = new Simulation(REG_WORLD);
    // Fired straight up from a metre under the rim, fast enough to clear it (sqrt(2*g*1) = 4.4 m/s
    // is the minimum, so 6 m/s has margin). The upward crossing must not latch a score.
    //
    // It does score on the way back DOWN, which is correct under the rule as specified: the test
    // is about the upward crossing not latching, not about the later descent.
    sim.release(
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: RIM_Y - 1,
        angleDeg: 90,
        speed: 6,
      }),
    );
    // Step only while the ball is still rising: no score may be registered in that window.
    while (sim.phase === 'flight' && sim.ball.v.y > 0) {
      sim.step();
      expect(sim.result?.summary.scored ?? false).toBe(false);
    }
    expect(sim.ball.p.y).toBeGreaterThan(RIM_Y);
  });

  it('classifies a shot that never approaches the hoop as an airball', () => {
    const res = runShot(REG_WORLD, shot(80, 4));
    expect(res.summary.scored).toBe(false);
    expect(res.outcome).toBe('airball');
  });

  it('reports an entry angle only when the ball actually went in', () => {
    const miss = runShot(REG_WORLD, shot(80, 4));
    expect(miss.summary.entryAngleDeg).toBeNull();
  });

  it('keeps the ball inside the world and on the floor at rest', () => {
    const res = runShot(REG_WORLD, shot(45, 6));
    if (res.reason === 'at_rest') {
      expect(res.summary.finalP.y).toBeCloseTo(R_BALL, 2);
      expect(res.summary.finalP.x).toBeGreaterThan(REG_WORLD.bounds.min.x);
    }
  });

  it('only reports a zero rim clearance when the ball actually hit the rim', () => {
    const rand = mulberry32(0x1234);
    for (let i = 0; i < 100; i++) {
      const res = runShot(REG_WORLD, shot(25 + rand() * 60, 5 + rand() * 5));
      // Swept resolution means the ball never interpenetrates, so clearance bottoms out at 0
      // (within the contact skin) and only does so on a genuine rim strike.
      expect(res.summary.rimClearance).toBeGreaterThan(-1e-3);
      if (res.summary.rimClearance < 1e-6) {
        expect(res.summary.contacts.rim).toBeGreaterThan(0);
      }
    }
  });
});

describe('world sanity', () => {
  it('puts the free-throw line 4.572 m from the backboard face', () => {
    expect(REG_WORLD.goal.boardX - 1.428).toBeCloseTo(4.572, 3);
  });

  it('puts the hoop centre 4.191 m from the free-throw line', () => {
    expect(REG_WORLD.goal.hoopX - 1.428).toBeCloseTo(4.191, 3);
  });

  it('has a gravity vector pointing down', () => {
    expect(REG_WORLD.gravity.y).toBeLessThan(0);
    expect(REG_WORLD.gravity.x).toBe(0);
    expect(REG_WORLD.wind).toEqual(v2(0, 0));
  });
});
