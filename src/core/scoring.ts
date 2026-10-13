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
import { COLLIDER_IDS, contactRole } from './colliders.js';
import { G, R_BALL, RIM_TUBE_R } from './constants.js';
import type { Metres, Seconds, Vec2 } from './units.js';
import { dist, distPointSegment, len, len2, RAD_TO_DEG, v2 } from './units.js';
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
  /**
   * Closest the ball's SURFACE came to either rim tube's surface, over the whole flight (m).
   *
   * This is the "how close did it come to the iron" number. Zero means it struck the rim — swept
   * collision resolution means the ball never interpenetrates, so a contact reads as 0 (give or
   * take the 1e-5 contact skin) rather than going negative. Check `contacts.rim` to distinguish a
   * clean 0 from a near miss that rounds to 0.
   *
   * The ceiling is geometric: a ball falling exactly through the centre of the hoop clears each
   * tube by (R_RIM + r_tube) - R_BALL - r_tube = 0.1089 m. So for a made shot this number runs from
   * 0 (rattled in) to ~10.9 cm (dead centre), which makes it a direct measure of how good the make
   * was.
   */
  readonly rimClearance: Metres;
  /** Per-tube breakdown of the above. */
  readonly frontRimClearance: Metres;
  readonly backRimClearance: Metres;
  /** Closest the ball's centre came to the hoop centre (m). */
  readonly closestApproach: Metres;
  /**
   * Rim contacts made while the ball was still at the hoop — i.e. the ones that are part of the
   * shot. `contacts.rim` is the whole-flight total and can include the ball bouncing back up into
   * the iron off the floor, which is not.
   */
  readonly rimContactsInbound: number;
  /**
   * Which way the ball came off its last rim contact at the hoop: 'up' for a bounce that rose
   * before falling, 'down' for a deflection straight through. Null when it never touched the rim.
   */
  readonly rimBounce: 'up' | 'down' | null;
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
  /**
   * Below this centre height the ball cannot touch a rim tube: the tubes sit at
   * `rimY - r_tube`, and contact needs the centres within `R_BALL + r_tube` of each other.
   */
  private readonly rimReachY: number;

  private apex = -Infinity;
  private closest = Infinity;
  private closestX = 0;
  private frontClearance = Infinity;
  private backClearance = Infinity;

  private readonly counts = { floor: 0, board: 0, rim: 0, obstacle: 0 };
  private total = 0;
  private resting = 0;
  private firstContactT: Seconds | null = null;

  private scored = false;
  private scoreT: Seconds | null = null;

  /**
   * What happened AT THE HOOP, snapshotted when the ball drops clear of the rim.
   *
   * "Clear of the rim" means the ball's centre has fallen far enough below the tube centres that no
   * further rim contact is geometrically possible (`rimReachY`). That is the right boundary, and
   * the plane crossing is not: a ball can pass the scoring plane and then clip the back of the rim
   * from inside on its way down, a contact that happens a step or two later. Snapshotting at the
   * crossing recorded that shot as a clean swish with a rim contact attached — self-contradictory,
   * and visible the moment cells are coloured by whether the rim was touched.
   *
   * Contacts after this point (the ball bouncing off the floor and back up into the iron) are not
   * part of the shot and must not change its verdict, which was the original reason for
   * snapshotting at all.
   */
  private inbound: {
    rim: number;
    board: number;
    front: number;
    back: number;
    /** Vertical direction the ball took off the last rim contact: true = upward. */
    bounceUp: boolean | null;
  } | null = null;

  /** Ball has been at or above rim height, so a later descent past the rim is meaningful. */
  private aboveRim = false;
  /** Direction off the most recent rim contact; snapshotted into `inbound` when that closes. */
  private lastRimBounceUp: boolean | null = null;
  /** Rim contacts made while the ball was still able to touch the rim. */
  private rimContactsInbound = 0;

  /**
   * Every reported statistic, frozen once the ball can no longer reach rim height (see
   * `cannotReachRim`). After that point nothing it does is part of the shot — it is just a ball
   * bouncing around the court.
   *
   * Freezing matters because an interactive run and a swept run diverge AFTER this moment: the
   * interactive one keeps simulating until the ball rests or leaves the court, the swept one stops.
   * With the freeze, both report byte-identical statistics, which is what makes the clearance
   * column in the outcome table mean the same thing as the clearance in the HUD.
   *
   * Note this is deliberately NOT the scoring instant. The minimum rim clearance occurs about a
   * centimetre BELOW rim level (the tube centres sit at rimY - r_tube), so freezing at the plane
   * crossing would cut the measurement off just before its true minimum.
   */
  private frozen: {
    rim: number;
    board: number;
    closest: number;
    closestX: number;
    apex: number;
    front: number;
    back: number;
  } | null = null;
  private entryAngle: number | null = null;
  private entrySpeedValue: number | null = null;

  private enteredRegion = false;
  private rimContactBeforeExit = false;

  constructor(goal: GoalGeometry) {
    this.goal = goal;
    this.hoopCentre = v2(goal.hoopX, goal.rimY);
    this.rimReachY = goal.frontRim.y - (R_BALL + RIM_TUBE_R);
  }

  /** Call once with the release state, before any stepping. */
  begin(ball: BallState): void {
    this.apex = ball.p.y;
    this.sample(ball.p, ball.p);
  }

  /**
   * Fold one step of travel into the statistics.
   *
   * Distances are measured against the swept segment `prev -> cur`, not against its endpoints, so
   * the numbers do not depend on the step size. That matters most for rim clearance: the whole
   * quantity is a few centimetres, and endpoint sampling at 4 m/s would miss the true minimum by
   * up to 1.7 cm — a third of the number being reported.
   */
  private sample(prev: Vec2, cur: Vec2): void {
    if (this.frozen !== null) return;

    if (cur.y > this.apex) this.apex = cur.y;

    const d = distPointSegment(this.hoopCentre, prev, cur);
    if (d < this.closest) {
      this.closest = d;
      // Record where along the path the closest approach happened, for short-vs-long.
      this.closestX = cur.x;
    }

    const front = distPointSegment(this.goal.frontRim, prev, cur) - R_BALL - RIM_TUBE_R;
    if (front < this.frontClearance) this.frontClearance = front;

    const back = distPointSegment(this.goal.backRim, prev, cur) - R_BALL - RIM_TUBE_R;
    if (back < this.backClearance) this.backClearance = back;

    const inGate = cur.x > this.goal.leftEdge && cur.x < this.goal.rightEdge;
    if (inGate && Math.abs(cur.y - this.goal.rimY) <= HOOP_REGION_HALF_HEIGHT) {
      this.enteredRegion = true;
    }
  }

  /**
   * Advance the tracker across one step. `prev` is the position at the start of the step; the ball
   * is at the end of it. Returns true on the step where the shot scores.
   */
  update(prev: Vec2, ball: BallState, t: Seconds): boolean {
    this.sample(prev, ball.p);

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

    // Close the at-the-hoop window once the ball has been up at rim height and has since fallen
    // clear of the rim. Both snapshots are taken from in-flight state on every step, in every run
    // mode, so an aborted run and a full run take them at the same instant.
    if (cur.y >= this.goal.rimY) this.aboveRim = true;
    if (this.inbound === null && this.aboveRim && cur.y < this.rimReachY) this.closeInbound();

    if (this.frozen === null && this.cannotReachRim(ball)) this.freeze();

    return false;
  }

  private closeInbound(): void {
    this.inbound = {
      rim: this.rimContactsInbound,
      board: this.counts.board,
      front: this.frontClearance,
      back: this.backClearance,
      bounceUp: this.lastRimBounceUp,
    };
  }

  private freeze(): void {
    this.frozen = {
      rim: this.counts.rim,
      board: this.counts.board,
      closest: this.closest,
      closestX: this.closestX,
      apex: this.apex,
      front: this.frontClearance,
      back: this.backClearance,
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
  /**
   * @param vOutY vertical velocity immediately AFTER the impulse, which is what says whether the
   *   ball came off the rim upward (a soft bounce that may drop back in) or was deflected downward
   *   through the hoop. The two look quite different and the table colours them differently.
   */
  noteContact(collider: Collider, t: Seconds, resting: boolean, vOutY: number): void {
    const isRim =
      collider.id === COLLIDER_IDS.rimFront || collider.id === COLLIDER_IDS.rimBack;

    // A rim touch is zero clearance by definition, and saying so explicitly is not redundant: the
    // sampled measurement in `sample()` walks the straight chord from one step to the next, but a
    // collision BENDS the real path mid-step, so the chord passes farther from the tube than the
    // ball actually did. Without this, a shot that demonstrably hit the iron could report 3.7 mm of
    // clearance — the table and the contact count would contradict each other.
    //
    // This runs before the resting check so that a ball which settles on the rim still clamps.
    if (this.frozen === null && isRim) {
      if (collider.id === COLLIDER_IDS.rimFront) this.frontClearance = Math.min(this.frontClearance, 0);
      else this.backClearance = Math.min(this.backClearance, 0);
    }

    if (isRim && this.inbound === null) {
      this.rimContactsInbound++;
      this.lastRimBounceUp = vOutY > 0;
    }

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
    return this.frozen !== null;
  }

  /**
   * Statistics as frozen (see `frozen`), falling back to live values for a shot that resolved
   * before the freeze could fire — e.g. one that flew straight out of bounds.
   */
  private stats() {
    return (
      this.frozen ?? {
        rim: this.counts.rim,
        board: this.counts.board,
        closest: this.closest,
        closestX: this.closestX,
        apex: this.apex,
        front: this.frontClearance,
        back: this.backClearance,
      }
    );
  }

  /**
   * What happened at the hoop: the inbound snapshot if the ball got there and fell clear, else the
   * live values (a shot that never reached rim height, or one still sitting on the rim).
   */
  private atHoop() {
    return (
      this.inbound ?? {
        rim: this.rimContactsInbound,
        board: this.counts.board,
        front: this.frontClearance,
        back: this.backClearance,
        bounceUp: this.lastRimBounceUp,
      }
    );
  }

  finish(ball: BallState, t: Seconds, endedAtRest: boolean): ShotSummary {
    const s = this.stats();
    const hoop = this.atHoop();
    return {
      outcome: this.classify(ball, endedAtRest),
      scored: this.scored,
      flightTime: this.scoreT ?? t,
      timeToFirstContact: this.firstContactT,
      apexY: s.apex,
      entryAngleDeg: this.entryAngle,
      entrySpeed: this.entrySpeedValue,
      rimClearance: Math.min(hoop.front, hoop.back),
      frontRimClearance: hoop.front,
      backRimClearance: hoop.back,
      rimContactsInbound: hoop.rim,
      rimBounce: hoop.bounceUp === null ? null : hoop.bounceUp ? 'up' : 'down',
      closestApproach: s.closest,
      contacts: { ...this.counts },
      totalContacts: this.total,
      restingContacts: this.resting,
      finalP: ball.p,
      endedAtRest,
    };
  }

  private classify(ball: BallState, endedAtRest: boolean): Outcome {
    const at = this.stats();

    if (this.scored) {
      // Only what happened at the hoop counts — see `inbound`.
      const hoop = this.atHoop();
      // Rim takes precedence over board: if it touched iron, "rattle" is the honest description.
      if (hoop.rim > 0) return 'rattle';
      if (hoop.board > 0) return 'bank';
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
