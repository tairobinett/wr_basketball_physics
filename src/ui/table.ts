/**
 * The outcome table (DESIGN.md §12).
 *
 * Two axes — power down the side, release angle across the top — and two numbers per cell: the
 * binary 1/0 make, and the rim clearance in centimetres.
 *
 * Split in two places on screen, which is why this module hands back two elements:
 *
 *  - `specEl` — the sweep ranges and the Generate button, which live in the right-hand Controls
 *    panel alongside every other variable.
 *  - `overlayEl` — the generated table itself, floating over the court at the bottom right, under
 *    the basket. `render/camera.ts` owns where exactly, in world coordinates.
 *
 * Clearance is the distance from the ball's surface to the nearest rim tube at its closest
 * approach. A cell reads `hit` when the ball actually struck the iron, which the colouring treats
 * as clearance zero.
 */

import { MAX_SPEED } from '../core/constants.js';
import type { PhysicsFlags } from '../core/forces.js';
import type { MaterialOverrides } from '../core/materials.js';
import { OUTCOME_LABELS } from '../core/scoring.js';
import type { World } from '../core/world.js';
import { isCancellation, runSweep } from '../sweep/client.js';
import type { CellCategory, SweepCell, SweepSpec, SweepTable } from '../sweep/grid.js';
import {
  categorize,
  cellCount,
  tableToJSON,
  tableToLongCSV,
  tableToMatrixCSV,
} from '../sweep/grid.js';
import { cellColor, clearanceScaleFor, legendFor, MAX_CLEARANCE, rampGradientCSS } from './colors.js';
import { createButton, createSlider, createToggle } from './controls.js';

/** Above this, generating gets slow enough to warn about rather than silently churn. */
const BIG_TABLE = 6000;

export interface TablePanelDeps {
  /** Current world, for the no-Worker fallback and for material overrides. */
  getWorld(): World;
  getShooterX(): number;
  getReleaseY(): number;
  getFlags(): PhysicsFlags;
  getOverrides(): MaterialOverrides | undefined;
  /** Clicking a cell loads that shot into the controls and fires it. */
  onPickShot(angleDeg: number, speed: number): void;
  /** Called whenever the overlay shows or hides, so the toggle button can follow. */
  onVisibilityChange?(open: boolean): void;
}

export interface TablePanelHandle {
  /** Sweep ranges and the Generate button — belongs in the Controls panel. */
  readonly specEl: HTMLElement;
  /** The generated table — floats over the court. */
  readonly overlayEl: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const CATEGORY_TEXT: Readonly<Record<CellCategory, string>> = {
  airball: 'missed without touching the rim',
  rim_miss: 'hit the rim, did not score',
  rim_up: 'hit the rim, scored after bouncing up',
  rim_down: 'hit the rim, scored, deflected down',
  clean_make: 'scored without touching the rim',
};

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function cellTitle(c: SweepCell, angle: number, speed: number): string {
  const lines = [
    `angle ${angle.toFixed(2)}°, speed ${speed.toFixed(3)} m/s (${((speed / MAX_SPEED) * 100).toFixed(1)}% power)`,
    `${OUTCOME_LABELS[c.outcome]} — made = ${c.made}`,
    CATEGORY_TEXT[categorize(c)],
    c.rimContacts > 0
      ? `hit the rim (${c.rimContacts} contact${c.rimContacts === 1 ? '' : 's'}), clearance 0`
      : `rim clearance ${(c.clearance * 100).toFixed(2)} cm (front ${(c.frontClearance * 100).toFixed(2)}, back ${(c.backClearance * 100).toFixed(2)})`,
  ];
  if (c.entryAngleDeg !== null) lines.push(`entry angle ${c.entryAngleDeg.toFixed(1)}°`);
  lines.push('click to fire this shot');
  return lines.join('\n');
}

function buildLegend(clearanceScale: number | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tablelegend';
  for (const entry of legendFor(clearanceScale)) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const sw = document.createElement('i');
    sw.className = 'legend-swatch';
    sw.setAttribute(
      'style',
      entry.color === 'ramp'
        ? `background: ${rampGradientCSS()}; width: 40px;`
        : `background: ${entry.color};`,
    );
    const label = document.createElement('span');
    label.textContent = entry.label;
    item.append(sw, label);
    wrap.append(item);
  }
  return wrap;
}

export function createTablePanel(deps: TablePanelDeps): TablePanelHandle {
  // --- Sweep spec (Controls panel) ------------------------------------------------------------

  const spec = {
    angleMin: 40,
    angleMax: 65,
    angleStep: 2.5,
    speedMin: 6.8,
    speedMax: 8.0,
    // 0.02 m/s shifts the ball's arrival point by ~3 cm. Coarser than that and nearly every cell
    // in the interesting band is a rim strike, which hides the gradient the table exists to show.
    speedStep: 0.02,
  };

  const specEl = document.createElement('div');

  const mk = (
    id: string,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string,
    places: number,
    set: (v: number) => void,
  ): HTMLElement => {
    const h = createSlider({ id, label, min, max, step, value, unit, places }, (v) => {
      set(v);
      updateCount();
    });
    return h.el;
  };

  const countNote = document.createElement('div');
  countNote.className = 'control-hint';

  const genBtn = createButton('Generate table', () => void generate(), 'primary');
  const cancelBtn = createButton('Cancel', () => current?.cancel());
  cancelBtn.disabled = true;

  const showClearance = createToggle('Show clearance numbers', true, (v) => {
    withClearance = v;
    if (table !== null) renderTable(table);
  });

  specEl.append(
    mk('t-amin', 'Angle from', 0, 89, 0.5, spec.angleMin, '°', 1, (v) => (spec.angleMin = v)),
    mk('t-amax', 'Angle to', 0, 89, 0.5, spec.angleMax, '°', 1, (v) => (spec.angleMax = v)),
    mk('t-astep', 'Angle step', 0.25, 10, 0.25, spec.angleStep, '°', 2, (v) => (spec.angleStep = v)),
    mk('t-smin', 'Speed from', 0, MAX_SPEED, 0.05, spec.speedMin, 'm/s', 2, (v) => (spec.speedMin = v)),
    mk('t-smax', 'Speed to', 0, MAX_SPEED, 0.05, spec.speedMax, 'm/s', 2, (v) => (spec.speedMax = v)),
    mk('t-sstep', 'Speed step', 0.005, 1, 0.005, spec.speedStep, 'm/s', 3, (v) => (spec.speedStep = v)),
    showClearance.el,
    countNote,
  );

  const specButtons = document.createElement('div');
  specButtons.className = 'row';
  specButtons.append(genBtn, cancelBtn);
  specEl.append(specButtons);

  // --- Overlay (over the court) ---------------------------------------------------------------

  const overlayEl = document.createElement('div');
  overlayEl.className = 'table-overlay hidden';
  overlayEl.id = 'table-overlay';

  const head = document.createElement('div');
  head.className = 'overlay-head';
  const title = document.createElement('h2');
  title.textContent = 'Outcome table';
  const summaryNote = document.createElement('div');
  summaryNote.className = 'overlay-summary';
  const closeBtn = createButton('✕', () => close(), 'panel-close');
  closeBtn.setAttribute('aria-label', 'Hide the outcome table');
  head.append(title, summaryNote, closeBtn);

  let legend = buildLegend(null);

  const scroller = document.createElement('div');
  scroller.className = 'tablescroll';
  const placeholder = document.createElement('p');
  placeholder.className = 'control-hint';
  placeholder.textContent =
    'Set the sweep ranges in the Controls panel and press Generate. Each cell is a full simulation: 1 = basket, 0 = miss, with the clearance to the nearest rim tube in centimetres.';
  scroller.append(placeholder);

  const exportBar = document.createElement('div');
  exportBar.className = 'overlay-exports';
  const expLong = createButton('CSV rows', () => {
    if (table !== null) download('outcome-table-long.csv', tableToLongCSV(table), 'text/csv');
  });
  const expMade = createButton('CSV makes', () => {
    if (table !== null) download('outcome-made-matrix.csv', tableToMatrixCSV(table, 'made'), 'text/csv');
  });
  const expClear = createButton('CSV clearance', () => {
    if (table !== null)
      download('outcome-clearance-matrix.csv', tableToMatrixCSV(table, 'clearance'), 'text/csv');
  });
  const expJson = createButton('JSON', () => {
    if (table !== null) download('outcome-table.json', tableToJSON(table), 'application/json');
  });
  exportBar.append(expLong, expMade, expClear, expJson);

  overlayEl.append(head, legend, scroller, exportBar);

  // --- State ----------------------------------------------------------------------------------

  let table: SweepTable | null = null;
  let withClearance = true;
  let current: { cancel(): void } | null = null;
  let open_ = false;

  function open(): void {
    if (open_) return;
    open_ = true;
    overlayEl.classList.remove('hidden');
    deps.onVisibilityChange?.(true);
  }

  function close(): void {
    if (!open_) return;
    open_ = false;
    overlayEl.classList.add('hidden');
    deps.onVisibilityChange?.(false);
  }

  function currentSpec(): SweepSpec {
    const base = {
      angleMin: Math.min(spec.angleMin, spec.angleMax),
      angleMax: Math.max(spec.angleMin, spec.angleMax),
      angleStep: spec.angleStep,
      speedMin: Math.min(spec.speedMin, spec.speedMax),
      speedMax: Math.max(spec.speedMin, spec.speedMax),
      speedStep: spec.speedStep,
      shooterX: deps.getShooterX(),
      releaseY: deps.getReleaseY(),
      flags: deps.getFlags(),
      levelId: 'regulation',
    };
    const o = deps.getOverrides();
    return o ? { ...base, materialOverrides: o } : base;
  }

  function updateCount(): void {
    let n: number;
    try {
      n = cellCount(currentSpec());
    } catch {
      countNote.textContent = 'invalid range';
      return;
    }
    countNote.textContent =
      `${n.toLocaleString()} cells` + (n > BIG_TABLE ? ' — large, may take a few seconds' : '');
  }

  function progressNode(done: number, total: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tableprogress';
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    wrap.textContent = `Simulating… ${done.toLocaleString()} / ${total.toLocaleString()} shots (${pct}%)`;
    return wrap;
  }

  async function generate(): Promise<void> {
    const s = currentSpec();
    // Generating is what brings the table on screen — the client's "generate overlapping the
    // simulation". No separate step to go and look at it.
    open();
    genBtn.disabled = true;
    cancelBtn.disabled = false;
    scroller.replaceChildren(progressNode(0, cellCount(s)));

    const o = deps.getOverrides();
    const handle = runSweep(s, {
      world: deps.getWorld(),
      ...(o !== undefined ? { materialOverrides: o } : {}),
      onProgress: (done, total) => {
        scroller.replaceChildren(progressNode(done, total));
      },
    });
    current = handle;

    try {
      const result = await handle.promise;
      table = result;
      renderTable(result);
    } catch (err) {
      if (isCancellation(err)) {
        scroller.replaceChildren(placeholder);
      } else {
        const p = document.createElement('p');
        p.className = 'control-hint';
        p.textContent = `Sweep failed: ${err instanceof Error ? err.message : String(err)}`;
        scroller.replaceChildren(p);
      }
    } finally {
      current = null;
      genBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  }

  function renderTable(t: SweepTable): void {
    // The ramp is scaled to the clean makes actually in this table — see colors.ts for why the
    // geometric ceiling would waste most of the gradient.
    const flat = t.cells.flat();
    const scale = clearanceScaleFor(flat) ?? MAX_CLEARANCE;

    const freshLegend = buildLegend(clearanceScaleFor(flat));
    legend.replaceWith(freshLegend);
    legend = freshLegend;

    const tbl = document.createElement('table');
    tbl.className = 'outcome-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    corner.innerHTML = 'pwr&nbsp;↓<br>ang&nbsp;→';
    hr.append(corner);
    for (const a of t.angles) {
      const th = document.createElement('th');
      th.textContent = `${a.toFixed(a % 1 === 0 ? 0 : 1)}°`;
      hr.append(th);
    }
    thead.append(hr);

    const tbody = document.createElement('tbody');
    t.speeds.forEach((speed, si) => {
      const row = t.cells[si];
      if (row === undefined) return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'rowhead';
      th.innerHTML = `${speed.toFixed(2)}<small> m/s</small>`;
      tr.append(th);

      t.angles.forEach((angle, ai) => {
        const c = row[ai];
        const td = document.createElement('td');
        if (c === undefined) {
          tr.append(td);
          return;
        }
        td.setAttribute('style', `background: ${cellColor(c, scale)};`);
        td.title = cellTitle(c, angle, speed);
        td.className = `cell ${categorize(c)}`;

        const made = document.createElement('b');
        made.textContent = String(c.made);
        td.append(made);

        if (withClearance) {
          const clear = document.createElement('span');
          clear.className = 'clearance';
          // A rim contact is shown as "hit" rather than 0.00, so the zero is never ambiguous.
          clear.textContent = c.rimContacts > 0 ? 'hit' : (c.clearance * 100).toFixed(1);
          td.append(clear);
        }

        td.addEventListener('click', () => deps.onPickShot(angle, speed));
        tr.append(td);
      });
      tbody.append(tr);
    });

    tbl.append(thead, tbody);
    scroller.replaceChildren(tbl);

    const total = t.angles.length * t.speeds.length;
    const pct = total === 0 ? 0 : (t.madeCount / total) * 100;
    const best = bestCell(t);
    summaryNote.textContent =
      `${t.madeCount}/${total} made (${pct.toFixed(0)}%)` +
      (best === null ? '' : ` · best ${(best.cell.clearance * 100).toFixed(1)} cm at ${best.angle.toFixed(1)}°`);
  }

  /** The made shot with the most room to spare — the centre of the sweet spot. */
  function bestCell(t: SweepTable): { cell: SweepCell; angle: number; speed: number } | null {
    let best: { cell: SweepCell; angle: number; speed: number } | null = null;
    t.speeds.forEach((speed, si) => {
      const row = t.cells[si];
      if (row === undefined) return;
      t.angles.forEach((angle, ai) => {
        const c = row[ai];
        if (c === undefined || c.made !== 1) return;
        if (best === null || c.clearance > best.cell.clearance) best = { cell: c, angle, speed };
      });
    });
    return best;
  }

  updateCount();
  return { specEl, overlayEl, open, close, isOpen: () => open_ };
}
