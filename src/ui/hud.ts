/** Live readouts and the shot verdict (DESIGN.md §7). */

import type { BallState } from '../core/ball.js';
import { OUTCOME_LABELS, isMake } from '../core/scoring.js';
import type { ShotSummary } from '../core/scoring.js';
import { len } from '../core/units.js';
import type { SimPhase } from '../core/sim.js';

export interface HudHandle {
  readonly el: HTMLElement;
  update(ball: BallState, t: number, phase: SimPhase): void;
  showResult(summary: ShotSummary | null): void;
}

function statRow(label: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'stat';
  const l = document.createElement('span');
  l.className = 'stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'stat-value';
  v.textContent = '—';
  row.append(l, v);
  return { row, value: v };
}

export function createHud(): HudHandle {
  const el = document.createElement('div');
  el.className = 'hud';

  const verdict = document.createElement('div');
  verdict.className = 'verdict';
  verdict.textContent = 'Ready';

  const live = document.createElement('div');
  live.className = 'stats';
  const sTime = statRow('time');
  const sSpeed = statRow('speed');
  const sHeight = statRow('height');
  const sSpin = statRow('spin');
  live.append(sTime.row, sSpeed.row, sHeight.row, sSpin.row);

  const shot = document.createElement('div');
  shot.className = 'stats';
  const sApex = statRow('apex');
  const sEntry = statRow('entry angle');
  const sClear = statRow('rim clearance');
  const sClosest = statRow('closest approach');
  const sContacts = statRow('contacts');
  shot.append(sApex.row, sEntry.row, sClear.row, sClosest.row, sContacts.row);

  el.append(verdict, live, shot);

  return {
    el,
    update(ball, t, phase) {
      sTime.value.textContent = `${t.toFixed(2)} s`;
      sSpeed.value.textContent = `${len(ball.v).toFixed(2)} m/s`;
      sHeight.value.textContent = `${ball.p.y.toFixed(2)} m`;
      sSpin.value.textContent = `${ball.omega.toFixed(1)} rad/s`;
      if (phase === 'idle') verdict.textContent = 'Ready';
      else if (phase === 'flight') {
        verdict.textContent = 'In flight';
        verdict.className = 'verdict';
      }
    },
    showResult(summary) {
      if (summary === null) {
        verdict.textContent = 'Ready';
        verdict.className = 'verdict';
        for (const s of [sApex, sEntry, sClear, sClosest, sContacts]) s.value.textContent = '—';
        return;
      }
      verdict.textContent = OUTCOME_LABELS[summary.outcome];
      verdict.className = `verdict ${isMake(summary.outcome) ? 'make' : 'miss'}`;
      sApex.value.textContent = `${summary.apexY.toFixed(2)} m`;
      sEntry.value.textContent =
        summary.entryAngleDeg === null ? '—' : `${summary.entryAngleDeg.toFixed(1)}°`;
      sClear.value.textContent =
        summary.contacts.rim > 0
          ? 'hit rim'
          : `${(summary.rimClearance * 100).toFixed(1)} cm`;
      sClosest.value.textContent = `${(summary.closestApproach * 100).toFixed(1)} cm`;
      sContacts.value.textContent =
        `${summary.totalContacts}` +
        (summary.contacts.rim > 0 ? ` (rim ${summary.contacts.rim})` : '') +
        (summary.contacts.board > 0 ? ` (board ${summary.contacts.board})` : '');
    },
  };
}
