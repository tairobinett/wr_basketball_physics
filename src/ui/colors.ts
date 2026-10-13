/**
 * Outcome-table cell colouring, to the client's specification.
 *
 *   black            air ball (missed without touching the rim)
 *   gray             hit the rim but did not score
 *   blue             hit the rim and scored after bouncing UP off it
 *   orange           hit the rim and scored, deflected DOWN off it
 *   red -> magenta   scored without touching the rim, interpolated by rim clearance
 *
 * Pure string/number work, kept out of table.ts so it can be tested without a DOM. The categories
 * themselves live in `sweep/grid.ts`, since which kind of cell this is is a fact about the shot
 * rather than a styling decision.
 *
 * Note that "hit the rim" means hit it AT THE HOOP (`rimContactsInbound`), not at any point in the
 * flight: a ball that bounces off the floor and back up into the iron has not changed how the shot
 * went in.
 */

import { R_BALL, R_RIM } from '../core/constants.js';
import type { CellCategory } from '../sweep/grid.js';
import { categorize } from '../sweep/grid.js';

/** The geometric ceiling on clearance: a ball falling dead centre through the hoop. */
export const MAX_CLEARANCE = R_RIM - R_BALL;

/** The fields of a cell the colouring depends on. */
export interface ColorInput {
  readonly made: 0 | 1;
  readonly rimContacts: number;
  readonly rimBounce: 'up' | 'down' | null;
  readonly clearance: number;
}

const BLACK = '#07090d';
const GRAY = '#6b7280';
const BLUE = '#2f6fd0';
const ORANGE = '#e07a1f';

/**
 * Red at zero clearance, magenta at `max`.
 *
 * Interpolated in sRGB, where red -> magenta is just the blue channel rising, so there is no hue
 * detour to worry about and the ramp reads as one continuous scale. Direction is a choice the spec
 * left open: more clearance means further toward magenta, so magenta marks the shots that went
 * through cleanest.
 *
 * `max` is the SCALE, and it defaults to the geometric ceiling but should normally be the largest
 * clean-make clearance actually in the table. The reason is that the geometric ceiling assumes a
 * ball dropping vertically through the hoop, and a free throw arrives at roughly a 40 degree entry
 * angle, passing through diagonally. Real clean makes from the free-throw line therefore top out
 * around 2 cm at 52 degrees and 4 cm at 56 — a fifth of the 10.89 cm ceiling. Scaled against the
 * ceiling, every realistic table would be shades of red with the magenta end never reached, and the
 * gradient would carry almost no information. Normalising to the table's own maximum spends the
 * whole ramp on the range that is actually present; the legend prints the cm range so the colours
 * stay readable as numbers.
 */
export function clearanceRamp(clearance: number, max: number = MAX_CLEARANCE): string {
  const span = max > 0 ? max : MAX_CLEARANCE;
  const f = Math.max(0, Math.min(1, clearance / span));
  const blue = Math.round(255 * f);
  return `rgb(255, 0, ${blue})`;
}

export function cellColor(c: ColorInput, clearanceScale: number = MAX_CLEARANCE): string {
  switch (categorize(c)) {
    case 'airball':
      return BLACK;
    case 'rim_miss':
      return GRAY;
    case 'rim_up':
      return BLUE;
    case 'rim_down':
      return ORANGE;
    case 'clean_make':
      return clearanceRamp(c.clearance, clearanceScale);
  }
}

/**
 * Largest clean-make clearance in a set of cells — the ramp's scale. Returns null when no cell is a
 * clean make, in which case no cell uses the ramp at all.
 */
export function clearanceScaleFor(cells: readonly ColorInput[]): number | null {
  let max = -Infinity;
  for (const c of cells) {
    if (categorize(c) === 'clean_make' && c.clearance > max) max = c.clearance;
  }
  return max === -Infinity ? null : max;
}

export interface LegendEntry {
  readonly category: CellCategory;
  readonly label: string;
  /** A flat colour, or the gradient ramp for the clean-make scale. */
  readonly color: string | 'ramp';
}

/**
 * Legend entries. `clearanceScale` is the ramp's upper bound in metres, so the clean-make entry can
 * say what the colours actually mean for the table on screen; pass null before a table exists.
 */
export function legendFor(clearanceScale: number | null): readonly LegendEntry[] {
  const scaleLabel =
    clearanceScale === null
      ? 'clearance, brightest = most room'
      : `clearance 0 → ${(clearanceScale * 100).toFixed(1)} cm`;
  return [
    { category: 'airball', label: 'missed, no rim contact', color: BLACK },
    { category: 'rim_miss', label: 'hit rim, missed', color: GRAY },
    { category: 'rim_up', label: 'hit rim, scored (bounced up)', color: BLUE },
    { category: 'rim_down', label: 'hit rim, scored (bounced down)', color: ORANGE },
    { category: 'clean_make', label: `scored clean — ${scaleLabel}`, color: 'ramp' },
  ];
}

/** CSS gradient for the clean-make ramp, for the legend swatch. */
export function rampGradientCSS(): string {
  return `linear-gradient(to right, rgb(255, 0, 0), rgb(255, 0, 255))`;
}

// Cell text is white across all five categories. Every one of them is dark or saturated enough to
// carry it, though bright magenta is close to the contrast line, so the stylesheet pairs white
// text with a shadow rather than relying on the background alone.
