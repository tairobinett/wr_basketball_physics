/**
 * The simulation driver (DESIGN.md §4, §4.1).
 *
 * Determinism contract, enforced here:
 *  - No Date.now / performance.now / Math.random anywhere in this file or anything it imports.
 *  - `dt` is the constant DT; the substep count depends only on ball speed.
 *  - sin/cos appear exactly once, in `release()`, outside the step loop. The resolved v0 vector is
 *    logged so a replay can be driven from the vector and skip trig entirely.
 *  - Every run carries PHYSICS_VERSION, so an old descriptor or golden snapshot is flagged rather
 *    than silently reinterpreted.
 */

import type { BallState } from './ball.js';
import { createBall } from './ball.js';
import { distanceTo } from './colliders.js';
import {
  DT,
  MAX_SHOT_TIME,
  PHYSICS_VERSION,
  REST_DURATION,
  REST_SPEED,
  R_BALL,
} from './constants.js';
import type { PhysicsFlags } from './forces.js';
import { forceBreakdown, NO_AIR } from './forces.js';
import { stepBall } from './integrate.js';
import type { MaterialOverrides } from './materials.js';
import type { Outcome, ShotSummary } from './scoring.js';
import { ShotTracker } from './scoring.js';
import type { Metres, Seconds, Vec2 } from './units.js';
import { DEG_TO_RAD, len, sub, v2 } from './units.js';
import { isOutOfBounds } from './world.js';
import type { World } from './world.js';
import type { Logger } from '../log/logger.js';
import { NULL_LOGGER } from '../log/logger.js';
import { totalEnergy } from './ball.js';

/**
 * Everything needed to reproduce a run exactly (DESIGN.md §8). Encode it in the URL hash and a
 * specific shot becomes a shareable link.
 */
export interface ShotDescriptor {
  readonly shooterX: Metres;
  readonly releaseY: Metres;
  readonly angleDeg: number;
  /** Release speed (m/s). The UI's power percentage maps linearly onto this. */
  readonly speed: number;
  /** Release spin. Not user-controllable in v1 — always 0 — but plumbed through (DESIGN.md §1). */
  readonly omega: number;
  readonly flags: PhysicsFlags;
  readonly levelId: string;
  readonly materialOverrides?: MaterialOverrides;
  readonly physicsVersion: number;
}

export type ResolveReason = 'scored' | 'at_rest' | 'out_of_bounds' | 'timeout' | 'decided';

export interface ShotResult {
  readonly summary: ShotSummary;
  readonly outcome: Outcome;
  readonly descriptor: ShotDescriptor;
  readonly reason: ResolveReason;
}

export type SimPhase = 'idle' | 'flight' | 'resolved';

export interface ShotParams {
  shooterX?: Metres;
  releaseY?: Metres;
  angleDeg?: number;
  speed?: number;
  omega?: number;
  flags?: PhysicsFlags;
  levelId?: string;
  materialOverrides?: MaterialOverrides;
}

export function makeDescriptor(p: ShotParams & { levelId: string }): ShotDescriptor {
  const base = {
    shooterX: p.shooterX ?? 0,
    releaseY: p.releaseY ?? 0,
    angleDeg: p.angleDeg ?? 0,
    speed: p.speed ?? 0,
    omega: p.omega ?? 0,
    flags: p.flags ?? NO_AIR,
    levelId: p.levelId,
    physicsVersion: PHYSICS_VERSION,
  };
  // exactOptionalPropertyTypes: only attach the key when there is something to attach.
  return p.materialOverrides ? { ...base, materialOverrides: p.materialOverrides } : base;
}

/** Contact gap below which the ball counts as touching something, for rest detection. */
const TOUCH_GAP = 1e-3;

export class Simulation {
  readonly world: World;
  ball: BallState;
  phase: SimPhase = 'idle';
  /** Sim seconds since release. */
  t: Seconds = 0;
  tick = 0;
  result: ShotResult | null = null;

  private logger: Logger;
  private tracker: ShotTracker;
  private descriptor: ShotDescriptor | null = null;
  private restTimer = 0;
  /** Position at the start of the current step, used for plane-crossing interpolation. */
  private prevP: Vec2 = v2(0, 0);

  constructor(world: World, logger: Logger = NULL_LOGGER) {
    this.world = world;
    this.logger = logger;
    this.tracker = new ShotTracker(world.goal);
    this.ball = createBall();
  }

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  getDescriptor(): ShotDescriptor | null {
    return this.descriptor;
  }

  /** Park the ball at the release point without launching it. */
  idle(shooterX: Metres, releaseY: Metres): void {
    this.phase = 'idle';
    this.t = 0;
    this.tick = 0;
    this.result = null;
    this.restTimer = 0;
    this.ball = createBall(v2(shooterX, releaseY));
    this.prevP = this.ball.p;
    this.tracker = new ShotTracker(this.world.goal);
  }

  release(d: ShotDescriptor): void {
    // The ONLY transcendental calls in the sim, and they happen once per shot, outside the step
    // loop (DESIGN.md §4.1 rule 4).
    const rad = d.angleDeg * DEG_TO_RAD;
    const v0 = v2(d.speed * Math.cos(rad), d.speed * Math.sin(rad));

    this.descriptor = d;
    this.phase = 'flight';
    this.t = 0;
    this.tick = 0;
    this.result = null;
    this.restTimer = 0;
    this.ball = createBall(v2(d.shooterX, d.releaseY), v0, d.omega);
    this.prevP = this.ball.p;
    this.tracker = new ShotTracker(this.world.goal);
    this.tracker.begin(this.ball);

    if (this.logger.enabled('info')) {
      this.logger.emit({ t: 0, tick: 0, level: 'info', cat: 'release', shot: d, v0 });
    }
  }

  /** Advance exactly one DT. No-op unless a shot is in flight. */
  step(): void {
    if (this.phase !== 'flight') return;

    this.prevP = this.ball.p;

    stepBall(this.ball, this.world, this.descriptor?.flags ?? NO_AIR, DT, (hit, res) => {
      this.tracker.noteContact(hit.collider, this.t, res.restitutionFloored, res.vOut.y);
      // Sustained contact (a ball rolling or sitting on the floor) re-triggers every step. Those
      // are deliberately not logged: one shot in the golden set produced 453 of them, which is
      // exactly the log flood the restitution floor exists to prevent. The summary reports the
      // count instead.
      if (!res.restitutionFloored && this.logger.enabled('debug')) {
        this.logger.emit({
          t: this.t,
          tick: this.tick,
          level: 'debug',
          cat: 'collision',
          collider: hit.collider.id,
          material: hit.collider.material,
          n: hit.normal,
          q: sub(hit.centre, v2(hit.normal.x * R_BALL, hit.normal.y * R_BALL)),
          vIn: res.vIn,
          vOut: res.vOut,
          omegaIn: res.omegaIn,
          omegaOut: res.omegaOut,
          jN: res.jn,
          jT: res.jt,
          dE: res.dE,
          restitutionFloored: res.restitutionFloored,
          sliding: res.sliding,
        });
      }
    });

    this.t += DT;
    this.tick++;

    const scored = this.tracker.update(this.prevP, this.ball, this.t);

    if (this.logger.shouldSampleStep(this.tick)) {
      this.logger.emit({
        t: this.t,
        tick: this.tick,
        level: 'trace',
        cat: 'step',
        p: this.ball.p,
        v: this.ball.v,
        omega: this.ball.omega,
        forces: forceBreakdown(this.ball, this.world, this.descriptor?.flags ?? NO_AIR),
        energy: totalEnergy(this.ball),
      });
    }

    if (scored) {
      if (this.logger.enabled('info')) {
        this.logger.emit({
          t: this.t,
          tick: this.tick,
          level: 'info',
          cat: 'scoring',
          kind: 'plane_cross',
          x: this.ball.p.x,
          vy: this.ball.v.y,
        });
      }
      // Keep simulating after the score so the ball visibly drops through the net; the outcome is
      // already locked in by the tracker.
    }

    // --- Termination (DESIGN.md §5.7) ---------------------------------------------------------
    if (isOutOfBounds(this.ball.p, this.world.bounds)) {
      this.resolve('out_of_bounds');
      return;
    }

    if (len(this.ball.v) < REST_SPEED && this.touching()) {
      this.restTimer += DT;
      if (this.restTimer >= REST_DURATION) {
        this.resolve('at_rest');
        return;
      }
    } else {
      this.restTimer = 0;
    }

    if (this.t >= MAX_SHOT_TIME) this.resolve('timeout');
  }

  private touching(): boolean {
    for (const col of this.world.colliders) {
      if (distanceTo(col, this.ball.p) - R_BALL < TOUCH_GAP) return true;
    }
    return false;
  }

  private resolve(reason: ResolveReason): void {
    const summary = this.tracker.finish(this.ball, this.t, reason === 'at_rest');
    this.phase = 'resolved';
    this.result = {
      summary,
      outcome: summary.outcome,
      descriptor:
        this.descriptor ?? makeDescriptor({ levelId: this.world.id }),
      reason,
    };
    if (this.logger.enabled('info')) {
      this.logger.emit({
        t: this.t,
        tick: this.tick,
        level: 'info',
        cat: 'result',
        outcome: summary.outcome,
        summary,
        reason,
      });
    }
  }

  /**
   * Run to completion headlessly.
   *
   * `earlyAbort` stops as soon as the outcome class is provably frozen — see
   * ShotTracker.outcomeDecided, which is conservative enough that an aborted run and a full run
   * always agree. Used by the outcome-map sweep (DESIGN.md §12); off for interactive play, where
   * watching the ball bounce away is the point.
   */
  runToCompletion(opts: { earlyAbort?: boolean } = {}): ShotResult {
    const earlyAbort = opts.earlyAbort ?? false;
    while (this.phase === 'flight') {
      this.step();
      if (earlyAbort && this.phase === 'flight' && this.tracker.outcomeDecided()) {
        this.resolve('decided');
      }
    }
    // `resolve` always runs before the loop exits, so this is non-null in practice.
    return (
      this.result ?? {
        summary: this.tracker.finish(this.ball, this.t, false),
        outcome: 'airball',
        descriptor: this.descriptor ?? makeDescriptor({ levelId: this.world.id }),
        reason: 'timeout',
      }
    );
  }
}

/** One-shot headless run. The sweep and the tests both go through this. */
export function runShot(
  world: World,
  d: ShotDescriptor,
  opts: { earlyAbort?: boolean; logger?: Logger } = {},
): ShotResult {
  const sim = new Simulation(world, opts.logger ?? NULL_LOGGER);
  sim.release(d);
  return sim.runToCompletion({ earlyAbort: opts.earlyAbort ?? false });
}

/**
 * Sample a trajectory for the predicted-arc ghost (DESIGN.md §7).
 *
 * This is exactly the path the ball will fly, because it is the same core running the same
 * descriptor — which is a direct payoff of the determinism contract, not a separate predictor.
 */
export function tracePath(
  world: World,
  d: ShotDescriptor,
  opts: { every?: number; maxPoints?: number } = {},
): Vec2[] {
  const every = opts.every ?? 4;
  const maxPoints = opts.maxPoints ?? 2000;
  const sim = new Simulation(world, NULL_LOGGER);
  sim.release(d);
  const pts: Vec2[] = [sim.ball.p];
  while (sim.phase === 'flight' && pts.length < maxPoints) {
    for (let i = 0; i < every && sim.phase === 'flight'; i++) sim.step();
    pts.push(sim.ball.p);
  }
  return pts;
}
