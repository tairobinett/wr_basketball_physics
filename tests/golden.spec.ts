/**
 * Golden trajectory regression (DESIGN.md §10).
 *
 * A fixed set of descriptors, snapshotted to their outcomes and resolved state. This catches
 * unintended physics drift — a change to the integrator, a constant, or the collision response that
 * nobody meant to make.
 *
 * PHYSICS_VERSION is part of the snapshot, so bumping it fails these tests loudly and forces an
 * explicit `vitest -u` rebaseline rather than letting a change slip through unnoticed.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANGLE_DEG,
  DEFAULT_RELEASE_Y,
  DEFAULT_SPEED,
  FT_LINE_X,
  PHYSICS_VERSION,
} from '../src/core/constants.js';
import { makeDescriptor, runShot } from '../src/core/sim.js';
import { REG_WORLD } from './helpers.js';

interface Case {
  readonly name: string;
  readonly angleDeg: number;
  readonly speed: number;
  readonly shooterX?: number;
  readonly releaseY?: number;
}

const CASES: readonly Case[] = [
  { name: 'default free throw', angleDeg: DEFAULT_ANGLE_DEG, speed: DEFAULT_SPEED },
  { name: 'a touch too hard', angleDeg: 52, speed: 7.3 },
  { name: 'well short', angleDeg: 52, speed: 7.0 },
  { name: 'long off the back iron', angleDeg: 52, speed: 7.35 },
  { name: 'flat 45 in the window', angleDeg: 45, speed: 7.367 },
  { name: 'high arc 60 in the window', angleDeg: 60, speed: 7.43 },
  { name: 'line drive', angleDeg: 30, speed: 9 },
  { name: 'moon ball', angleDeg: 80, speed: 4 },
  { name: 'over the backboard', angleDeg: 70, speed: 12 },
  { name: 'from close in', angleDeg: 60, speed: 6.0, shooterX: 3.0 },
  { name: 'from deep', angleDeg: 48, speed: 8.6, shooterX: 0.6 },
  { name: 'low release', angleDeg: 55, speed: 7.6, releaseY: 1.5 },
];

function run(c: Case) {
  const d = makeDescriptor({
    levelId: 'regulation',
    shooterX: c.shooterX ?? FT_LINE_X,
    releaseY: c.releaseY ?? DEFAULT_RELEASE_Y,
    angleDeg: c.angleDeg,
    speed: c.speed,
  });
  const res = runShot(REG_WORLD, d);
  const s = res.summary;
  return {
    outcome: res.outcome,
    reason: res.reason,
    scored: s.scored,
    apexY: +s.apexY.toFixed(6),
    flightTime: +s.flightTime.toFixed(6),
    entryAngleDeg: s.entryAngleDeg === null ? null : +s.entryAngleDeg.toFixed(4),
    closestApproach: +s.closestApproach.toFixed(6),
    rimClearance: +s.rimClearance.toFixed(6),
    frontRimClearance: +s.frontRimClearance.toFixed(6),
    backRimClearance: +s.backRimClearance.toFixed(6),
    contacts: s.contacts,
    finalP: { x: +s.finalP.x.toFixed(6), y: +s.finalP.y.toFixed(6) },
  };
}

describe('golden trajectories', () => {
  it('matches the recorded physics', () => {
    const table = Object.fromEntries(CASES.map((c) => [c.name, run(c)]));
    expect({ physicsVersion: PHYSICS_VERSION, shots: table }).toMatchSnapshot();
  });

  // A handful of outcomes are asserted explicitly as well, so the snapshot is not the only thing
  // standing between us and a silently broken sim.
  it('sinks the default free throw', () => {
    const res = run(CASES[0]!);
    expect(res.outcome).toBe('swish');
    expect(res.scored).toBe(true);
    // Closed form for this release: vx = 4.451, t to the hoop = 4.191/4.451 = 0.942 s, so
    // vy = 5.697 - g*t = -3.54 and the entry angle is atan(3.54/4.451) = 38.5 deg. The sim says
    // 39.7, the difference being that the crossing happens slightly before the hoop's centre line.
    // The often-quoted "45 deg optimal entry" belongs to higher release angles than 52.
    expect(res.entryAngleDeg).toBeGreaterThan(35);
    expect(res.entryAngleDeg).toBeLessThan(45);
  });

  it('misses short when under-powered and long when over-powered', () => {
    expect(run(CASES[2]!).outcome).toBe('miss_short');
    expect(run(CASES[3]!).outcome).toBe('miss_long');
  });

  it('makes the shot from both ends of the angle range', () => {
    expect(run(CASES[4]!).scored).toBe(true);
    expect(run(CASES[5]!).scored).toBe(true);
  });

  it('gives a steeper entry angle for a higher arc', () => {
    const flat = run(CASES[4]!).entryAngleDeg ?? 0;
    const high = run(CASES[5]!).entryAngleDeg ?? 0;
    expect(high).toBeGreaterThan(flat);
  });
});
