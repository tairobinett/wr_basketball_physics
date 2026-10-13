/**
 * The outcome table (DESIGN.md §12) and the rim-clearance measurement it reports.
 *
 * The clearance number is the part worth testing hard: it is a few centimetres in magnitude, it is
 * the client-facing figure, and a naive implementation gets it wrong in two separate ways (endpoint
 * sampling, and freezing the measurement at the scoring instant).
 */

import { describe, expect, it } from 'vitest';

import { R_BALL, RIM_TUBE_R, R_RIM } from '../src/core/constants.js';
import { makeDescriptor, runShot } from '../src/core/sim.js';
import { NO_AIR } from '../src/core/forces.js';
import {
  buildAxis,
  cellCount,
  sweepGrid,
  tableToLongCSV,
  tableToMatrixCSV,
} from '../src/sweep/grid.js';
import type { SweepSpec } from '../src/sweep/grid.js';
import { REG_WORLD } from './helpers.js';

/**
 * A ball falling exactly through the hoop's centre clears each tube by
 * (R_RIM + r_tube) - R_BALL - r_tube = R_RIM - R_BALL. That is the geometric ceiling on clearance
 * for any made shot, and it is what makes the number interpretable.
 */
const MAX_POSSIBLE_CLEARANCE = R_RIM - R_BALL;

function spec(over: Partial<SweepSpec> = {}): SweepSpec {
  return {
    angleMin: 45,
    angleMax: 55,
    angleStep: 5,
    speedMin: 7.1,
    speedMax: 7.3,
    speedStep: 0.1,
    shooterX: 1.428,
    releaseY: 2.1,
    flags: NO_AIR,
    levelId: 'regulation',
    ...over,
  };
}

describe('axis construction', () => {
  it('is inclusive of both ends', () => {
    expect(buildAxis(40, 60, 5)).toEqual([40, 45, 50, 55, 60]);
  });

  it('does not leave floating-point crumbs in the labels', () => {
    // A naive accumulator gives 7.199999999999999 here.
    expect(buildAxis(7, 7.5, 0.1)).toEqual([7, 7.1, 7.2, 7.3, 7.4, 7.5]);
  });

  it('handles a single-value axis', () => {
    expect(buildAxis(52, 52, 1)).toEqual([52]);
  });

  it('rejects a non-positive step', () => {
    expect(() => buildAxis(0, 10, 0)).toThrow(/step/);
  });

  it('counts cells as the product of the axes', () => {
    expect(cellCount(spec())).toBe(3 * 3);
  });
});

describe('rim clearance', () => {
  it('is bounded by the geometry and maximised by a dead-centre drop', () => {
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
    // Straight down the middle: clearance should be the geometric maximum, to the millimetre.
    expect(res.summary.rimClearance).toBeCloseTo(MAX_POSSIBLE_CLEARANCE, 3);
    expect(res.summary.frontRimClearance).toBeCloseTo(res.summary.backRimClearance, 3);
  });

  it('agrees exactly with the contact count about whether the rim was touched', () => {
    // These two signals must never contradict each other: the client reads "0 clearance" and
    // "hit the rim" as the same statement. Sampling along the step chord alone does not guarantee
    // it, because a collision bends the path mid-step.
    const t = sweepGrid(REG_WORLD, spec({ angleStep: 1, speedStep: 0.01 }));
    let hits = 0;
    for (const row of t.cells) {
      for (const c of row) {
        if (c.rimContacts > 0) {
          hits++;
          expect(c.clearance).toBe(0);
        } else {
          expect(c.clearance).toBeGreaterThan(0);
        }
      }
    }
    // Sanity: the window must actually contain rim strikes, or the test proves nothing.
    expect(hits).toBeGreaterThan(0);
  });

  it('reads ~0 when the ball actually strikes the rim', () => {
    // Dropped straight onto the front rim tube.
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
    expect(res.summary.contacts.rim).toBeGreaterThan(0);
    expect(Math.abs(res.summary.rimClearance)).toBeLessThan(1e-3);
  });

  it('never exceeds the geometric maximum for any made shot', () => {
    const table = sweepGrid(REG_WORLD, spec({ angleStep: 2.5, speedStep: 0.02 }));
    for (const row of table.cells) {
      for (const c of row) {
        if (c.made === 1) {
          expect(c.clearance).toBeLessThanOrEqual(MAX_POSSIBLE_CLEARANCE + 1e-9);
          expect(c.clearance).toBeGreaterThanOrEqual(-1e-3);
        }
      }
    }
  });

  it('is measured against the swept path, not the step endpoints', () => {
    // A fast shot moves ~3 cm per step near the rim. If clearance were sampled only at endpoints,
    // a shot threading the hoop would report a clearance inflated by up to half a step of travel.
    // Measuring against the segment makes the number independent of how fast the ball was moving,
    // so two shots through the same point must agree closely.
    const slow = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: 3.4,
        angleDeg: 0,
        speed: 0,
      }),
    );
    const fast = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: 3.4,
        angleDeg: -90,
        speed: 12,
      }),
    );
    expect(slow.summary.scored).toBe(true);
    expect(fast.summary.scored).toBe(true);
    // Same path through the hoop at wildly different speeds: clearance must agree to ~a millimetre.
    expect(Math.abs(slow.summary.rimClearance - fast.summary.rimClearance)).toBeLessThan(2e-3);
  });

  it('is not truncated by the scoring instant', () => {
    // The minimum clearance occurs about a centimetre BELOW rim level, since the tube centres sit
    // at rimY - r_tube. Freezing the statistics at the plane crossing would cut the measurement
    // off early and overstate the clearance. For a dead-centre drop the true minimum equals the
    // geometric maximum exactly, which only holds if the measurement ran past the crossing.
    const res = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.hoopX,
        releaseY: 3.6,
        angleDeg: 0,
        speed: 0,
      }),
    );
    expect(res.summary.rimClearance).toBeLessThanOrEqual(MAX_POSSIBLE_CLEARANCE + 1e-9);
    expect(res.summary.rimClearance).toBeGreaterThan(MAX_POSSIBLE_CLEARANCE - 2e-3);
  });

  it('distinguishes the two tubes for an off-centre pass', () => {
    // Enter nearer the front rim: front clearance must be the smaller of the two.
    const res = runShot(
      REG_WORLD,
      makeDescriptor({
        levelId: 'regulation',
        shooterX: REG_WORLD.goal.leftEdge + R_BALL + 0.01,
        releaseY: 4.0,
        angleDeg: 0,
        speed: 0,
      }),
    );
    expect(res.summary.frontRimClearance).toBeLessThan(res.summary.backRimClearance);
    expect(res.summary.rimClearance).toBeCloseTo(res.summary.frontRimClearance, 9);
  });

  it('keeps a sensible distance when the ball never gets near the rim', () => {
    const res = runShot(
      REG_WORLD,
      makeDescriptor({ levelId: 'regulation', shooterX: 1.428, releaseY: 2.1, angleDeg: 80, speed: 4 }),
    );
    expect(res.outcome).toBe('airball');
    expect(res.summary.rimClearance).toBeGreaterThan(0.3);
  });
});

describe('sweep table', () => {
  it('has the shape the axes describe', () => {
    const s = spec();
    const t = sweepGrid(REG_WORLD, s);
    expect(t.angles).toEqual([45, 50, 55]);
    expect(t.speeds).toEqual([7.1, 7.2, 7.3]);
    expect(t.cells.length).toBe(3);
    for (const row of t.cells) expect(row.length).toBe(3);
    expect(t.physicsVersion).toBe(1);
  });

  it('agrees cell by cell with running the same shot directly', () => {
    // The table must not be a separate, parallel implementation of anything.
    const s = spec({ angleStep: 2.5, speedStep: 0.05 });
    const t = sweepGrid(REG_WORLD, s);
    t.speeds.forEach((speed, si) => {
      t.angles.forEach((angleDeg, ai) => {
        const cell = t.cells[si]?.[ai];
        expect(cell).toBeDefined();
        const direct = runShot(
          REG_WORLD,
          makeDescriptor({
            levelId: 'regulation',
            shooterX: s.shooterX,
            releaseY: s.releaseY,
            angleDeg,
            speed,
          }),
        );
        expect(cell?.outcome).toBe(direct.outcome);
        expect(cell?.clearance).toBe(direct.summary.rimClearance);
      });
    });
  });

  it('is deterministic', () => {
    const s = spec({ angleStep: 2.5, speedStep: 0.05 });
    expect(JSON.stringify(sweepGrid(REG_WORLD, s))).toBe(JSON.stringify(sweepGrid(REG_WORLD, s)));
  });

  it('reports progress once per row', () => {
    const seen: number[] = [];
    const s = spec();
    sweepGrid(REG_WORLD, s, (p) => seen.push(p.done));
    expect(seen).toEqual([3, 6, 9]);
  });

  it('counts makes consistently with the cells', () => {
    const t = sweepGrid(REG_WORLD, spec({ angleStep: 2.5, speedStep: 0.05 }));
    const counted = t.cells.flat().filter((c) => c.made === 1).length;
    expect(t.madeCount).toBe(counted);
  });

  it('finds the make band in a window that straddles it', () => {
    // 52 deg makes between 7.160 and 7.300 m/s, so a window spanning that must contain both
    // makes and misses — a table that is all 0s or all 1s would mean something is broken.
    const t = sweepGrid(
      REG_WORLD,
      spec({ angleMin: 52, angleMax: 52, angleStep: 1, speedMin: 7.0, speedMax: 7.5, speedStep: 0.02 }),
    );
    expect(t.madeCount).toBeGreaterThan(0);
    expect(t.madeCount).toBeLessThan(t.speeds.length);
  });
});

describe('exports', () => {
  it('writes a long CSV with one row per cell', () => {
    const t = sweepGrid(REG_WORLD, spec());
    const lines = tableToLongCSV(t).trim().split('\n');
    expect(lines.length).toBe(1 + 9);
    expect(lines[0]).toContain('made');
    expect(lines[0]).toContain('clearance_cm');
    // Every data row carries a binary make and a clearance.
    for (const line of lines.slice(1)) {
      const parts = line.split(',');
      // speed, power, angle, made, outcome, category, clearance_m, clearance_cm, ...
      expect(['0', '1']).toContain(parts[3]);
      expect(['airball', 'rim_miss', 'rim_up', 'rim_down', 'clean_make']).toContain(parts[5]);
      expect(Number.isFinite(Number(parts[6]))).toBe(true);
    }
  });

  it('writes matrix CSVs with the axes as headers', () => {
    const t = sweepGrid(REG_WORLD, spec());
    const made = tableToMatrixCSV(t, 'made').trim().split('\n');
    expect(made[0]).toBe('speed_mps\\angle_deg,45.000,50.000,55.000');
    expect(made.length).toBe(4);
    for (const row of made.slice(1)) {
      for (const v of row.split(',').slice(1)) expect(['0', '1']).toContain(v);
    }

    const clear = tableToMatrixCSV(t, 'clearance').trim().split('\n');
    expect(clear.length).toBe(4);
    // Clearance is reported in centimetres in the exports, bounded by the geometry.
    for (const row of clear.slice(1)) {
      for (const v of row.split(',').slice(1)) {
        expect(Number(v)).toBeLessThanOrEqual((MAX_POSSIBLE_CLEARANCE + 1e-6) * 100 + 60);
      }
    }
  });
});

describe('rim tube geometry assumptions', () => {
  it('matches the constants the clearance ceiling is derived from', () => {
    expect(R_RIM - R_BALL).toBeCloseTo(0.1089, 4);
    expect(RIM_TUBE_R).toBeGreaterThan(0);
  });
});
