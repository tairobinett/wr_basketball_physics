/** Structured log event types (DESIGN.md §8). */

import type { MaterialId } from '../core/materials.js';
import type { Outcome, ShotSummary } from '../core/scoring.js';
import type { Vec2 } from '../core/units.js';
import type { ShotDescriptor } from '../core/sim.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn';

export const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
};

export type LogCategory =
  | 'input'
  | 'release'
  | 'step'
  | 'collision'
  | 'scoring'
  | 'result'
  | 'system';

interface EventBase {
  /** Sim time in seconds since release. */
  readonly t: number;
  /** Step index since release. */
  readonly tick: number;
  readonly level: LogLevel;
}

export type LogEvent = EventBase &
  (
    | {
        readonly cat: 'input';
        readonly kind: 'param_change';
        readonly param: string;
        readonly from: number;
        readonly to: number;
      }
    | {
        readonly cat: 'release';
        readonly shot: ShotDescriptor;
        /**
         * The resolved release velocity. Recorded so a replay can be driven from the vector and
         * skip the sin/cos entirely (DESIGN.md §4.1 rule 4).
         */
        readonly v0: Vec2;
      }
    | {
        readonly cat: 'step';
        readonly p: Vec2;
        readonly v: Vec2;
        readonly omega: number;
        readonly forces: Readonly<Record<string, Vec2>>;
        readonly energy: number;
      }
    | {
        readonly cat: 'collision';
        readonly collider: string;
        readonly material: MaterialId;
        readonly n: Vec2;
        readonly q: Vec2;
        readonly vIn: Vec2;
        readonly vOut: Vec2;
        readonly omegaIn: number;
        readonly omegaOut: number;
        readonly jN: number;
        readonly jT: number;
        readonly dE: number;
        readonly restitutionFloored: boolean;
        readonly sliding: boolean;
      }
    | {
        readonly cat: 'scoring';
        readonly kind: 'plane_cross' | 'region_enter' | 'rim_out';
        readonly x: number;
        readonly vy: number;
      }
    | {
        readonly cat: 'result';
        readonly outcome: Outcome;
        readonly summary: ShotSummary;
        readonly reason: 'scored' | 'at_rest' | 'out_of_bounds' | 'timeout' | 'decided';
      }
    | { readonly cat: 'system'; readonly msg: string }
  );
