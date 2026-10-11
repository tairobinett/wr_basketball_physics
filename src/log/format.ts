/**
 * Log formatting and export (DESIGN.md §8).
 *
 * The text format is column-aligned so a wall of events can be scanned by eye:
 *   [  1.284s t=308] COLLISION rim_front  steel   n=(-0.62,+0.78)  |v| 6.41->4.58 m/s  jN=6.85 ...
 */

import type { LogEvent } from './events.js';
import type { Vec2 } from '../core/units.js';
import { len } from '../core/units.js';

function f(n: number, width: number, places: number): string {
  return n.toFixed(places).padStart(width);
}

function signed(n: number, places = 2): string {
  const s = n.toFixed(places);
  return n >= 0 ? `+${s}` : s;
}

export function fmtVec(v: Vec2, places = 2): string {
  return `(${signed(v.x, places)},${signed(v.y, places)})`;
}

export function formatEvent(ev: LogEvent): string {
  const stamp = `[${f(ev.t, 7, 3)}s t=${String(ev.tick).padStart(5)}]`;

  switch (ev.cat) {
    case 'input':
      return `${stamp} INPUT     ${ev.param.padEnd(14)} ${ev.from.toFixed(3)} -> ${ev.to.toFixed(3)}`;

    case 'release':
      return (
        `${stamp} RELEASE   x=${ev.shot.shooterX.toFixed(3)}m y=${ev.shot.releaseY.toFixed(3)}m ` +
        `angle=${ev.shot.angleDeg.toFixed(1)}deg speed=${ev.shot.speed.toFixed(2)}m/s ` +
        `omega=${ev.shot.omega.toFixed(2)}rad/s v0=${fmtVec(ev.v0)} ` +
        `[drag=${ev.shot.flags.drag ? 'on' : 'off'} magnus=${ev.shot.flags.magnus ? 'on' : 'off'} ` +
        `phys=v${ev.shot.physicsVersion}]`
      );

    case 'step': {
      const forces = Object.entries(ev.forces)
        .map(([k, v]) => `${k}=${fmtVec(v)}N`)
        .join(' ');
      return (
        `${stamp} STEP      p=${fmtVec(ev.p, 3)}m v=${fmtVec(ev.v)}m/s ` +
        `|v|=${f(len(ev.v), 5, 2)} omega=${signed(ev.omega, 2)}rad/s E=${f(ev.energy, 6, 2)}J ${forces}`
      );
    }

    case 'collision':
      return (
        `${stamp} COLLISION ${ev.collider.padEnd(10)} ${ev.material.padEnd(8)} ` +
        `n=${fmtVec(ev.n)}  |v| ${f(len(ev.vIn), 5, 2)}->${f(len(ev.vOut), 5, 2)} m/s  ` +
        `omega ${signed(ev.omegaIn, 1)}->${signed(ev.omegaOut, 1)} rad/s  ` +
        `jN=${ev.jN.toFixed(2)} jT=${ev.jT.toFixed(2)}  dE=${signed(ev.dE, 1)} J` +
        `${ev.restitutionFloored ? '  [e floored]' : ''}${ev.sliding ? '  [sliding]' : ''}`
      );

    case 'scoring':
      return `${stamp} SCORING   ${ev.kind.padEnd(12)} x=${ev.x.toFixed(3)}m vy=${signed(ev.vy)}m/s`;

    case 'result': {
      const s = ev.summary;
      const entry = s.entryAngleDeg === null ? 'n/a' : `${s.entryAngleDeg.toFixed(1)}deg`;
      return (
        `${stamp} RESULT    ${ev.outcome.toUpperCase().padEnd(11)} (${ev.reason}) ` +
        `apex=${s.apexY.toFixed(2)}m flight=${s.flightTime.toFixed(2)}s entry=${entry} ` +
        `closest=${s.closestApproach.toFixed(3)}m frontRimClear=${s.frontRimClearance.toFixed(3)}m ` +
        `contacts=${s.totalContacts} (floor=${s.contacts.floor} board=${s.contacts.board} ` +
        `rim=${s.contacts.rim} obstacle=${s.contacts.obstacle}) resting=${s.restingContacts}`
      );
    }

    case 'system':
      return `${stamp} SYSTEM    ${ev.msg}`;
  }
}

/** Full-fidelity export. Includes the descriptor, so the run can be replayed from this file. */
export function toJSON(events: readonly LogEvent[]): string {
  return JSON.stringify({ format: 'wr-basketball-log', version: 1, events }, null, 2);
}

/** One row per sampled step, for plotting elsewhere. */
export function toCSV(events: readonly LogEvent[]): string {
  const rows = ['t,tick,x,y,vx,vy,speed,omega,energy'];
  for (const ev of events) {
    if (ev.cat !== 'step') continue;
    rows.push(
      [
        ev.t.toFixed(6),
        ev.tick,
        ev.p.x.toFixed(6),
        ev.p.y.toFixed(6),
        ev.v.x.toFixed(6),
        ev.v.y.toFixed(6),
        len(ev.v).toFixed(6),
        ev.omega.toFixed(6),
        ev.energy.toFixed(6),
      ].join(','),
    );
  }
  return rows.join('\n');
}
