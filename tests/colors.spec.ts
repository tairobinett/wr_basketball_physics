/**
 * The table's colour coding, to the client's specification:
 *
 *   black            air ball
 *   gray             hit rim but didn't score
 *   blue             hit rim and scored after bouncing up
 *   orange           hit rim and scored, bounced down after rim
 *   red -> magenta   scored without hitting rim, interpolated by rim clearance
 */

import { describe, expect, it } from 'vitest';

import { R_BALL, R_RIM } from '../src/core/constants.js';
import { makeDescriptor, runShot, Simulation } from '../src/core/sim.js';
import { NO_AIR } from '../src/core/forces.js';
import { categorize, sweepGrid } from '../src/sweep/grid.js';
import type { SweepCell } from '../src/sweep/grid.js';
import {
  cellColor,
  clearanceRamp,
  clearanceScaleFor,
  legendFor,
  MAX_CLEARANCE,
} from '../src/ui/colors.js';
import { REG_WORLD } from './helpers.js';

function cell(over: Partial<SweepCell>): SweepCell {
  return {
    made: 0,
    outcome: 'airball',
    clearance: 0.5,
    frontClearance: 0.5,
    backClearance: 0.5,
    rimContacts: 0,
    rimBounce: null,
    entryAngleDeg: null,
    ...over,
  };
}

describe('category assignment', () => {
  it('calls a miss with no rim contact an airball', () => {
    expect(categorize(cell({ made: 0, rimContacts: 0 }))).toBe('airball');
  });

  it('calls a miss that touched the rim a rim miss', () => {
    expect(categorize(cell({ made: 0, rimContacts: 1, outcome: 'rim_out' }))).toBe('rim_miss');
  });

  it('separates a make that bounced up off the rim from one deflected down', () => {
    expect(
      categorize(cell({ made: 1, outcome: 'rattle', rimContacts: 1, rimBounce: 'up' })),
    ).toBe('rim_up');
    expect(
      categorize(cell({ made: 1, outcome: 'rattle', rimContacts: 2, rimBounce: 'down' })),
    ).toBe('rim_down');
  });

  it('calls a make with no rim contact a clean make', () => {
    expect(categorize(cell({ made: 1, outcome: 'swish', rimContacts: 0 }))).toBe('clean_make');
    // A bank off the backboard still never touched the rim, so it is a clean make.
    expect(categorize(cell({ made: 1, outcome: 'bank', rimContacts: 0 }))).toBe('clean_make');
  });

  it('covers every cell exactly once', () => {
    // Exhaustive over the inputs that matter: the categoriser must never fall through.
    for (const made of [0, 1] as const) {
      for (const rimContacts of [0, 1, 5]) {
        for (const rimBounce of ['up', 'down', null] as const) {
          const c = categorize(cell({ made, rimContacts, rimBounce }));
          expect(['airball', 'rim_miss', 'rim_up', 'rim_down', 'clean_make']).toContain(c);
        }
      }
    }
  });
});

describe('colours', () => {
  it('uses black, gray, blue and orange for the four discrete categories', () => {
    expect(cellColor(cell({ made: 0, rimContacts: 0 }))).toBe('#07090d');
    expect(cellColor(cell({ made: 0, rimContacts: 1 }))).toBe('#6b7280');
    expect(cellColor(cell({ made: 1, rimContacts: 1, rimBounce: 'up' }))).toBe('#2f6fd0');
    expect(cellColor(cell({ made: 1, rimContacts: 1, rimBounce: 'down' }))).toBe('#e07a1f');
  });

  it('ramps red to magenta across the clearance range for a clean make', () => {
    // Zero clearance is pure red, the scale maximum is pure magenta.
    expect(clearanceRamp(0)).toBe('rgb(255, 0, 0)');
    expect(clearanceRamp(MAX_CLEARANCE)).toBe('rgb(255, 0, 255)');
    // Halfway along is halfway between.
    expect(clearanceRamp(MAX_CLEARANCE / 2)).toBe('rgb(255, 0, 128)');
  });

  it('clamps the ramp outside the expected range rather than producing invalid colours', () => {
    expect(clearanceRamp(-1)).toBe('rgb(255, 0, 0)');
    expect(clearanceRamp(10)).toBe('rgb(255, 0, 255)');
  });

  it('spends the whole ramp on the range actually present', () => {
    // Against the geometric ceiling a realistic free-throw table would never leave the reds: real
    // clean makes from the line reach only ~2 cm because the ball enters diagonally. Scaled to the
    // table's own maximum, the best cell is magenta.
    const scale = 0.021;
    expect(clearanceRamp(scale, scale)).toBe('rgb(255, 0, 255)');
    expect(clearanceRamp(scale)).toBe('rgb(255, 0, 49)'); // the same cell against the ceiling
    expect(clearanceRamp(scale / 2, scale)).toBe('rgb(255, 0, 128)');
  });

  it('falls back to the geometric ceiling for a degenerate scale', () => {
    expect(clearanceRamp(MAX_CLEARANCE, 0)).toBe('rgb(255, 0, 255)');
  });

  it('increases monotonically toward magenta with clearance', () => {
    const blueOf = (clearance: number): number => {
      const m = /rgb\(255, 0, (\d+)\)/.exec(cellColor(cell({ made: 1, rimContacts: 0, clearance })));
      return Number(m?.[1]);
    };
    let last = -1;
    for (let c = 0; c <= MAX_CLEARANCE; c += MAX_CLEARANCE / 12) {
      const b = blueOf(c);
      expect(b).toBeGreaterThanOrEqual(last);
      last = b;
    }
    expect(last).toBe(255);
  });

  it('picks the ramp scale from the clean makes only', () => {
    const cells = [
      cell({ made: 1, rimContacts: 0, clearance: 0.018 }),
      cell({ made: 1, rimContacts: 0, clearance: 0.009 }),
      // A miss that sailed way past is not a clean make and must not set the scale.
      cell({ made: 0, rimContacts: 0, clearance: 0.9 }),
      cell({ made: 1, rimContacts: 2, rimBounce: 'up', clearance: 0 }),
    ];
    expect(clearanceScaleFor(cells)).toBeCloseTo(0.018, 9);
  });

  it('reports no scale when a table has no clean makes', () => {
    expect(clearanceScaleFor([cell({ made: 0, rimContacts: 1 })])).toBeNull();
  });

  it('derives the ramp ceiling from the hoop geometry', () => {
    expect(MAX_CLEARANCE).toBe(R_RIM - R_BALL);
    expect(MAX_CLEARANCE).toBeCloseTo(0.1089, 4);
  });

  it('has a legend entry for all five categories', () => {
    const legend = legendFor(null);
    expect(legend.length).toBe(5);
    expect(legend.map((l) => l.category)).toEqual([
      'airball',
      'rim_miss',
      'rim_up',
      'rim_down',
      'clean_make',
    ]);
    // Only the clean-make entry is a gradient.
    expect(legend.filter((l) => l.color === 'ramp').length).toBe(1);
  });

  it('states the ramp range in centimetres so the colours can be read as numbers', () => {
    const entry = legendFor(0.021).find((l) => l.category === 'clean_make');
    expect(entry?.label).toContain('0 → 2.1 cm');
  });
});

describe('bounce direction comes from the physics', () => {
  it('bounces the ball upward off the top of the rim', () => {
    // The physics half: dropped onto the top of the front tube, the ball must rebound upward.
    const sim = new Simulation(REG_WORLD);
    sim.release(
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.frontRim.x,
        releaseY: 4.0,
        angleDeg: 0,
        speed: 0,
      }),
    );
    let roseAfterContact = false;
    while (sim.phase === 'flight') {
      sim.step();
      if (sim.ball.v.y > 0.5) {
        roseAfterContact = true;
        break;
      }
    }
    expect(roseAfterContact).toBe(true);
  });

  it('reports the direction of the LAST rim contact at the hoop, not the first', () => {
    // The semantics half, and the distinction matters: the client's blue/orange split is about how
    // the ball went in, so the contact that counts is the one that sent it there.
    //
    // This shot is dropped onto the top of the front tube, where it bounces up repeatedly with
    // decreasing energy and finally slides off the side — so the first contact is upward and the
    // last is not. It is a miss, so the colouring would paint it gray regardless; the point here is
    // to pin the "last contact wins" rule down.
    const res = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.frontRim.x,
        releaseY: 4.0,
        angleDeg: 0,
        speed: 0,
      }),
    );
    expect(res.summary.rimContactsInbound).toBeGreaterThan(1);
    expect(res.summary.rimBounce).toBe('down');
    expect(categorize({ made: 0, rimContacts: res.summary.rimContactsInbound, rimBounce: 'down' })).toBe(
      'rim_miss',
    );
  });

  it('reports no bounce direction when the rim was never touched', () => {
    const res = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: 4.0,
        angleDeg: 0,
        speed: 0,
      }),
    );
    expect(res.outcome).toBe('swish');
    expect(res.summary.rimContactsInbound).toBe(0);
    expect(res.summary.rimBounce).toBeNull();
  });

  it('produces both bounce directions across a real sweep', () => {
    // Both blue and orange cells must actually occur, or the distinction is untestable in practice.
    const t = sweepGrid(REG_WORLD, {
      angleMin: 44,
      angleMax: 60,
      angleStep: 1,
      speedMin: 7.0,
      speedMax: 7.8,
      speedStep: 0.01,
      shooterX: 1.428,
      releaseY: 2.1,
      flags: NO_AIR,
      levelId: 'regulation',
    });
    const cats = t.cells.flat().map(categorize);
    expect(cats).toContain('rim_up');
    expect(cats).toContain('rim_down');
    expect(cats).toContain('clean_make');
    expect(cats).toContain('rim_miss');
  });

  it('never claims a bounce direction for a clean make', () => {
    const t = sweepGrid(REG_WORLD, {
      angleMin: 45,
      angleMax: 60,
      angleStep: 2.5,
      speedMin: 7.0,
      speedMax: 7.8,
      speedStep: 0.02,
      shooterX: 1.428,
      releaseY: 2.1,
      flags: NO_AIR,
      levelId: 'regulation',
    });
    for (const c of t.cells.flat()) {
      if (categorize(c) === 'clean_make') {
        expect(c.rimContacts).toBe(0);
        // And a clean make always has real clearance to colour with.
        expect(c.clearance).toBeGreaterThan(0);
        expect(c.clearance).toBeLessThanOrEqual(MAX_CLEARANCE + 1e-9);
      }
    }
  });
});
