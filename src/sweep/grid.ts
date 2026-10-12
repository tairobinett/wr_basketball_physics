/**
 * The outcome table: sweep power x angle and report make/miss plus rim clearance per cell
 * (DESIGN.md §12).
 *
 * Pure and dependency-free, like everything else that touches the core, so it runs identically on
 * the main thread, in a Worker, or in a test.
 *
 * Every cell is a full simulation with an exact verdict. There is no probability, no sampling and
 * no randomness anywhere in it — the same spec always produces the same table.
 */

import { PHYSICS_VERSION } from '../core/constants.js';
import type { PhysicsFlags } from '../core/forces.js';
import { NO_AIR } from '../core/forces.js';
import type { MaterialOverrides } from '../core/materials.js';
import type { Outcome } from '../core/scoring.js';
import { isMake } from '../core/scoring.js';
import { makeDescriptor, runShot } from '../core/sim.js';
import type { World } from '../core/world.js';

export interface SweepSpec {
  /** Degrees. */
  readonly angleMin: number;
  readonly angleMax: number;
  readonly angleStep: number;
  /** Metres per second. */
  readonly speedMin: number;
  readonly speedMax: number;
  readonly speedStep: number;

  readonly shooterX: number;
  readonly releaseY: number;
  readonly flags: PhysicsFlags;
  readonly levelId: string;
  readonly materialOverrides?: MaterialOverrides;
}

export interface SweepCell {
  /** The binary result the client asked for: 1 = basket, 0 = miss. */
  readonly made: 0 | 1;
  readonly outcome: Outcome;
  /**
   * Metres from the ball's surface to the nearest rim tube at its closest approach. 0 means it
   * struck the rim (see ShotSummary.rimClearance), and ~0.109 is the geometric maximum, reached by
   * a ball falling dead centre through the hoop.
   */
  readonly clearance: number;
  readonly frontClearance: number;
  readonly backClearance: number;
  /** Non-zero means the clearance of ~0 is a genuine rim strike rather than a rounded near miss. */
  readonly rimContacts: number;
  readonly entryAngleDeg: number | null;
}

export interface SweepTable {
  readonly spec: SweepSpec;
  readonly physicsVersion: number;
  /** Column axis. */
  readonly angles: readonly number[];
  /** Row axis. */
  readonly speeds: readonly number[];
  /** `cells[speedIndex][angleIndex]`. */
  readonly cells: readonly (readonly SweepCell[])[];
  readonly madeCount: number;
}

/**
 * Build an inclusive axis from min..max by step.
 *
 * Values are snapped to the step grid to keep floating-point crumbs out of the axis labels — a
 * naive `for (v = min; v <= max; v += step)` accumulates error and can also drop the final value.
 */
export function buildAxis(min: number, max: number, step: number): number[] {
  if (!(step > 0)) throw new Error(`step must be positive, got ${step}`);
  if (max < min) throw new Error(`max (${max}) must be >= min (${min})`);
  const n = Math.floor((max - min) / step + 1e-9);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    // Round to 6 decimals: enough for 0.001-degree or 0.001-m/s axes, with no 7.249999999 labels.
    out.push(Math.round((min + i * step) * 1e6) / 1e6);
  }
  return out;
}

export function cellCount(spec: SweepSpec): number {
  return (
    buildAxis(spec.angleMin, spec.angleMax, spec.angleStep).length *
    buildAxis(spec.speedMin, spec.speedMax, spec.speedStep).length
  );
}

export interface SweepProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * Run the sweep.
 *
 * `earlyAbort` is on: a run stops as soon as the ball can no longer reach rim height, at which
 * point both the verdict and every reported statistic are frozen. An aborted run and a full
 * interactive run therefore produce identical numbers — asserted in tests/determinism.spec.ts —
 * so a cell in this table means exactly what the HUD means after firing that same shot.
 */
export function sweepGrid(
  world: World,
  spec: SweepSpec,
  onProgress?: (p: SweepProgress) => void,
): SweepTable {
  const angles = buildAxis(spec.angleMin, spec.angleMax, spec.angleStep);
  const speeds = buildAxis(spec.speedMin, spec.speedMax, spec.speedStep);
  const total = angles.length * speeds.length;

  const cells: SweepCell[][] = [];
  let madeCount = 0;
  let done = 0;

  for (const speed of speeds) {
    const row: SweepCell[] = [];
    for (const angleDeg of angles) {
      const base = {
        levelId: spec.levelId,
        shooterX: spec.shooterX,
        releaseY: spec.releaseY,
        angleDeg,
        speed,
        omega: 0,
        flags: spec.flags ?? NO_AIR,
      };
      const d = spec.materialOverrides
        ? makeDescriptor({ ...base, materialOverrides: spec.materialOverrides })
        : makeDescriptor(base);

      const res = runShot(world, d, { earlyAbort: true });
      const s = res.summary;
      const made = isMake(res.outcome) ? 1 : 0;
      if (made === 1) madeCount++;

      row.push({
        made,
        outcome: res.outcome,
        clearance: s.rimClearance,
        frontClearance: s.frontRimClearance,
        backClearance: s.backRimClearance,
        rimContacts: s.contacts.rim,
        entryAngleDeg: s.entryAngleDeg,
      });

      done++;
    }
    cells.push(row);
    onProgress?.({ done, total });
  }

  return { spec, physicsVersion: PHYSICS_VERSION, angles, speeds, cells, madeCount };
}

// ---------------------------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------------------------

/** Long format: one row per cell. The shape you want for plotting or further analysis. */
export function tableToLongCSV(table: SweepTable): string {
  const rows = [
    'speed_mps,power_pct,angle_deg,made,outcome,clearance_m,clearance_cm,front_clearance_m,back_clearance_m,rim_contacts,entry_angle_deg',
  ];
  const maxSpeed = 15;
  table.speeds.forEach((speed, si) => {
    const row = table.cells[si];
    if (row === undefined) return;
    table.angles.forEach((angle, ai) => {
      const c = row[ai];
      if (c === undefined) return;
      rows.push(
        [
          speed.toFixed(4),
          ((speed / maxSpeed) * 100).toFixed(2),
          angle.toFixed(3),
          c.made,
          c.outcome,
          c.clearance.toFixed(5),
          (c.clearance * 100).toFixed(2),
          c.frontClearance.toFixed(5),
          c.backClearance.toFixed(5),
          c.rimContacts,
          c.entryAngleDeg === null ? '' : c.entryAngleDeg.toFixed(3),
        ].join(','),
      );
    });
  });
  return rows.join('\n');
}

/**
 * Matrix format: speeds down the side, angles across the top. The shape you want to paste into a
 * spreadsheet and look at.
 */
export function tableToMatrixCSV(table: SweepTable, field: 'made' | 'clearance'): string {
  const header = ['speed_mps\\angle_deg', ...table.angles.map((a) => a.toFixed(3))].join(',');
  const rows = [header];
  table.speeds.forEach((speed, si) => {
    const row = table.cells[si];
    if (row === undefined) return;
    const values = table.angles.map((_, ai) => {
      const c = row[ai];
      if (c === undefined) return '';
      return field === 'made' ? String(c.made) : (c.clearance * 100).toFixed(2);
    });
    rows.push([speed.toFixed(4), ...values].join(','));
  });
  return rows.join('\n');
}

export function tableToJSON(table: SweepTable): string {
  return JSON.stringify(
    {
      format: 'wr-basketball-outcome-table',
      version: 1,
      clearanceUnits: 'metres, ball surface to nearest rim tube surface at closest approach',
      ...table,
    },
    null,
    2,
  );
}
