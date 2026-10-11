/**
 * Shot outcome state machine and per-shot statistics (DESIGN.md §6).
 *
 * Scoring rule: the ball's centre crosses the scoring plane (y = rim top) moving DOWNWARD while x
 * lies strictly between the rim's inner edges. The crossing x is found by linear interpolation
 * between the previous and current position, so detection does not depend on step size. Crossing
 * the plane upward never scores and never latches.
 *
 * Note on transcendentals: the entry-angle statistic uses atan2, which DESIGN.md §4.1 rule 4 keeps
 * out of the step loop. That is fine — it is computed from state, never fed back into it, so it
 * cannot affect a trajectory. It is a reported number, not a simulated one.
 */

import type { BallState } from './ball.js';
import type { Collider } from './colliders.js';
import { contactRole } from './colliders.js';
import { G, R_BALL, RIM_TUBE_R } from './constants.js';
import type { Metres, Seconds, Vec2 } from './units.js';
import { dist, len, len2, RAD_TO_DEG, v2 } from './units.js';
import type { GoalGeometry } from './world.js';

export type Outcome =
  | 'swish'
  | 'bank'
  | 'rattle'
  | 'rim_out'
  | 'miss_short'
  | 'miss_long'
  | 'airball'
  | 'stuck';

export const OUTCOMES: readonly Outcome[] = [
  'swish',
  'bank',
  'rattle',
  'rim_out',
  'miss_short',
  'miss_long',
  'airball',
  'stuck',
];

export function isMake(o: Outcome): boolean {
  return o === 'swish' || o === 'bank' || o === 'rattle';
}

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  swish: 'Swish (no contact)',
  bank: 'Bank (off the board)',
  rattle: 'Rattle (off the rim)',
  rim_out: 'Rimmed out',
  miss_short: 'Miss, short',
  miss_long: 'Miss, long',
  airball: 'Airball',
  stuck: 'Stuck on the rim',
};

export interface ShotSummary {
  readonly outcome: Outcome;
  readonly scored: boolean;
  /** Sim seconds from release to the shot resolving. */
  readonly flightTime: Seconds;
  /** Sim seconds from release to first contact with anything; null if the ball never touched. */
  readonly timeToFirstContact: Seconds | null;
  readonly apexY: Metres;
  /** Entry angle above horizontal at the scoring plane (deg); null if it never crossed. */
  readonly entryAngleDeg: number | null;
  /** Speed at the scoring plane (m/s); null if it never crossed. */
  readonly entrySpeed: number | null;
  /** Closest the ball's surface came to the front rim tube (m). Negative means it hit it. */
  readonly frontRimClearance: Metres;
  /** Closest the ball's centre came to the hoop centre (m). */
  readonly closestApproach: Metres;
  readonly contacts: Readonly<Record<'floor' | 'board' | 'rim' | 'obstacle', number>>;
  readonly totalContacts: number;
  /** Steps spent in sustained (restitution-floored) contact — rolling or sitting still. */
  readonly restingContacts: number;
  readonly finalP: Vec2;
  readonly endedAtRest: boolean;
}

/** How close to rim height counts as "in the hoop region", for rim-out detection. */
const HOOP_REGION_HALF_HEIGHT = 0.25;
/** Beyond this distance from the hoop centre, a miss is an airball. */
const AIRBALL_DIST = 0.5;

export class ShotTracker {
  private readonly goal: GoalGeometry;
  private readonly hoopCentre: Vec2;

  private apex = -Infinity;
  private closest = Infinity;
  private closestX = 0;
  private frontClearance = Infinity;

  private readonly counts = { floor: 0, board: 0, rim: 0, obstacle: 0 };
  private total = 0;
  private resting = 0;
  private firstContactT: Seconds | null = null;

  private scored = false;
  private scoreT: Seconds | null = null;

  /**
   * Everything the classification depends on, frozen at the instant the outcome became certain.
   *
   * This is what keeps an early-aborted sweep run and a full interactive run in agreement. Both
   * keep simulating differently AFTER the outcome is settled — the interactive one watches the ball
   * drop through the net and clatter around, the sweep stops dead — and any contact or approach
   * recorded in that tail would otherwise change the verdict. The early-abort agreement test caught
   * exactly this: a shot that went in cleanly off the board, then rattled the rim on its way down,
   * was reported as 'bank' by one run and 'rattle' by the other.
   *
   * Live stats (apex, closest approach, contact counts) keep updating for the log and the HUD; only
   * the classification reads from this snapshot.
   */
  private decidedAt: { rim: number; board: number; closest: number; closestX: number } | null = null;
  private entryAngle: number | null = null;
  private entrySpeedValue: number | null = null;

  private enteredRegion = false;
  private rimContactBeforeExit = false;

  constructor(goal: GoalGeometry) {
    this.goal = goal;
    this.hoopCentre = v2(goal.hoopX, goal.rimY);
  }

  /** Call once with the release state, before any stepping. */
  begin(ball: BallState): void {
    this.apex = ball.p.y;
    this.sample(ball);
  }

  private sample(ball: BallState): void {
    const p = ball.p;
    if (p.y > this.apex) this.apex = p.y;

    const d = dist(p, this.hoopCentre);
    if (d < this.closest) {
      this.closest = d;
      this.closestX = p.x;
    }

    const clearance = dist(p, this.goal.frontRim) - R_BALL - RIM_TUBE_R;
    if (clearance < this.frontClearance) this.frontClearance = clearance;

    const inGate = p.x > this.goal.leftEdge && p.x < this.goal.rightEdge;
    if (inGate && Math.abs(p.y - this.goal.rimY) <= HOOP_REGION_HALF_HEIGHT) {
      this.enteredRegion = true;
    }
  }

  /**
   * Advance the tracker across one step. `prev` is the position at the start of the step; the ball
   * is at the end of it. Returns true on the step where the shot scores.
   */
  update(prev: Vec2, ball: BallState, t: Seconds): boolean {
    this.sample(ball);

    const cur = ball.p;
    const plane = this.goal.rimY;

    // Downward crossing of the scoring plane.
    if (!this.scored && prev.y > plane && cur.y <= plane) {
      const span = prev.y - cur.y;
      const f = span > 0 ? (prev.y - plane) / span : 0;
      const xCross = prev.x + (cur.x - prev.x) * f;
      if (xCross > this.goal.leftEdge && xCross < this.goal.rightEdge) {
        this.scored = true;
        this.scoreT = t;
        // Contacts in this same step happened on the way in, so they belong to the snapshot.
        this.freeze();
        this.entrySpeedValue = len(ball.v);
        // Angle above horizontal, so a steep drop reads near 90 and a flat one near 0.
        this.entryAngle = Math.atan2(Math.abs(ball.v.y), Math.abs(ball.v.x)) * RAD_TO_DEG;
        return true;
      }
    }

    // Upward crossing: never scores. If the ball had already been in the hoop region and touched
    // the rim, this is the rim-out signature.
    if (!this.scored && prev.y < plane && cur.y >= plane) {
      if (this.enteredRegion && this.counts.rim > 0) this.rimContactBeforeExit = true;
    }

    // The decision test runs on EVERY step, in every mode, so the snapshot is taken at the same
    // moment whether or not the caller intends to stop there.
    if (this.decidedAt === null && this.cannotReachRim(ball)) this.freeze();

    return false;
  }

  private freeze(): void {
    this.decidedAt = {
      rim: this.counts.rim,
      board: this.counts.board,
      closest: this.closest,
      closestX: this.closestX,
    };
  }

  /**
   * True once the ball can never reach rim height again, so nothing it does afterwards can change
   * the outcome.
   *
   * The bound is conservative and therefore exact: `|v|^2 / 2g` is the highest the ball could rise
   * if ALL of its kinetic energy became height, which no bounce or drag can ever exceed. The second
   * condition — staying well below the rim — is what freezes the miss classification too, since a
   * ball more than AIRBALL_DIST below rim height is always more than AIRBALL_DIST from the hoop
   * centre.
   */
  private cannotReachRim(ball: BallState): boolean {
    const ceiling = ball.p.y + R_BALL + len2(ball.v) / (2 * G);
    return ceiling < this.goal.rimY && ball.p.y < this.goal.rimY - AIRBALL_DIST;
  }

  /**
   * Record a contact.
   *
   * `resting` separates sustained contact from genuine impacts. A ball sitting on the floor is
   * re-accelerated into it by gravity every step and so produces a fresh contact every step — one
   * shot in the golden set racked up 453 of them. Those are one continuous resting contact, not 453
   * impacts, so they are counted separately and never logged individually. Only real impacts count
   * toward the outcome classification.
   */
  noteContact(collider: Collider, t: Seconds, resting: boolean): void {
    if (resting) {
      this.resting++;
      return;
    }
    const role = contactRole(collider.id);
    this.counts[role]++;
    this.total++;
    if (this.firstContactT === null) this.firstContactT = t;
  }

  get hasScored(): boolean {
    return this.scored;
  }

  /**
   * True once the outcome class is settled, so a sweep can stop stepping
   * (DESIGN.md §12 performance item 1). Set by `update`, so it reflects the last completed step.
   */
  outcomeDecided(): boolean {
    return this.decidedAt !== null;
  }

  finish(ball: BallState, t: Seconds, endedAtRest: boolean): ShotSummary {
    return {
      outcome: this.classify(ball, endedAtRest),
      scored: this.scored,
      flightTime: this.scoreT ?? t,
      timeToFirstContact: this.firstContactT,
      apexY: this.apex,
      entryAngleDeg: this.entryAngle,
      entrySpeed: this.entrySpeedValue,
      frontRimClearance: this.frontClearance,
      closestApproach: this.closest,
      contacts: { ...this.counts },
      totalContacts: this.total,
      restingContacts: this.resting,
      finalP: ball.p,
      endedAtRest,
    };
  }

  private classify(ball: BallState, endedAtRest: boolean): Outcome {
    // Frozen at the decision point; the live values are only a fallback for a shot that somehow
    // resolved before either condition fired (e.g. straight out of bounds).
    const at =
      this.decidedAt ??
      { rim: this.counts.rim, board: this.counts.board, closest: this.closest, closestX: this.closestX };

    if (this.scored) {
      // Rim takes precedence over board: if it touched iron, "rattle" is the honest description.
      if (at.rim > 0) return 'rattle';
      if (at.board > 0) return 'bank';
      return 'swish';
    }

    if (
      endedAtRest &&
      dist(ball.p, this.hoopCentre) < 0.5 &&
      ball.p.y > this.goal.rimY - 0.3
    ) {
      return 'stuck';
    }

    if (this.rimContactBeforeExit) return 'rim_out';

    // "Airball" means it touched nothing but air. A shot that clanged off the board or the rim is
    // never an airball however far from the hoop centre it passed, so the contact test comes first
    // and the distance test only separates a true airball from a near miss.
    const hitTheGoal = at.rim > 0 || at.board > 0;
    if (!hitTheGoal && at.closest > AIRBALL_DIST) return 'airball';

    return at.closestX < this.goal.hoopX ? 'miss_short' : 'miss_long';
  }
}
