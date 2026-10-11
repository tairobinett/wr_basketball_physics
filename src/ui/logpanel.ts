/**
 * The log drawer (DESIGN.md §8).
 *
 * Renders a windowed view of the ring buffer with category and level filters plus text search, and
 * exports JSON (full fidelity, replayable) or CSV (one row per sampled step).
 */

import type { LogCategory, LogEvent, LogLevel } from '../log/events.js';
import { LEVEL_ORDER } from '../log/events.js';
import { formatEvent, toCSV, toJSON } from '../log/format.js';
import type { RingLogger } from '../log/logger.js';
import { createButton, createSelect } from './controls.js';

/** How many lines to keep in the DOM. The buffer holds 50k; rendering them all would be silly. */
const MAX_RENDERED = 400;

const CATEGORIES: readonly LogCategory[] = [
  'input',
  'release',
  'step',
  'collision',
  'scoring',
  'result',
  'system',
];

export interface LogPanelHandle {
  readonly el: HTMLElement;
  refresh(): void;
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function createLogPanel(logger: RingLogger): LogPanelHandle {
  const el = document.createElement('div');
  el.className = 'logpanel';

  const bar = document.createElement('div');
  bar.className = 'logbar';

  const enabledCats = new Set<LogCategory>(CATEGORIES);
  let minLevel: LogLevel = 'debug';
  let search = '';
  let autoscroll = true;

  const catWrap = document.createElement('div');
  catWrap.className = 'cat-filters';
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip on';
    b.textContent = cat;
    b.addEventListener('click', () => {
      if (enabledCats.has(cat)) {
        enabledCats.delete(cat);
        b.className = 'chip';
      } else {
        enabledCats.add(cat);
        b.className = 'chip on';
      }
      render();
    });
    catWrap.append(b);
  }

  const levelSel = createSelect<LogLevel>(
    'level',
    [
      { value: 'trace', label: 'trace (includes steps)' },
      { value: 'debug', label: 'debug' },
      { value: 'info', label: 'info' },
      { value: 'warn', label: 'warn' },
    ],
    minLevel,
    (v) => {
      minLevel = v;
      // The logger's own threshold controls what is RECORDED; this control filters what is shown,
      // so lowering it to trace also has to turn step recording on at the source.
      logger.setMinLevel(v === 'trace' ? 'trace' : 'debug');
      render();
    },
  );
  levelSel.classList.add('inline');

  const searchBox = document.createElement('input');
  searchBox.type = 'search';
  searchBox.placeholder = 'search…';
  searchBox.className = 'logsearch';
  searchBox.addEventListener('input', () => {
    search = searchBox.value.toLowerCase();
    render();
  });

  const autoBtn = createButton('autoscroll: on', () => {
    autoscroll = !autoscroll;
    autoBtn.textContent = `autoscroll: ${autoscroll ? 'on' : 'off'}`;
  });

  const clearBtn = createButton('clear', () => {
    logger.clear();
    render();
  });

  const jsonBtn = createButton('export JSON', () => {
    download('shot-log.json', toJSON(logger.toArray()), 'application/json');
  });

  const csvBtn = createButton('export CSV', () => {
    download('shot-steps.csv', toCSV(logger.toArray()), 'text/csv');
  });

  bar.append(catWrap, levelSel, searchBox, autoBtn, clearBtn, jsonBtn, csvBtn);

  const out = document.createElement('pre');
  out.className = 'logout';

  const count = document.createElement('div');
  count.className = 'logcount';

  el.append(bar, out, count);

  function visible(ev: LogEvent): boolean {
    if (!enabledCats.has(ev.cat)) return false;
    if (LEVEL_ORDER[ev.level] < LEVEL_ORDER[minLevel]) return false;
    if (search !== '' && !formatEvent(ev).toLowerCase().includes(search)) return false;
    return true;
  }

  function render(): void {
    const all = logger.toArray();
    const kept: string[] = [];
    // Walk backwards so the window is the most recent matching events.
    for (let i = all.length - 1; i >= 0 && kept.length < MAX_RENDERED; i--) {
      const ev = all[i];
      if (ev === undefined || !visible(ev)) continue;
      kept.push(formatEvent(ev));
    }
    kept.reverse();
    out.textContent = kept.join('\n');
    count.textContent = `${kept.length} shown · ${all.length} buffered (cap ${50_000})`;
    if (autoscroll) out.scrollTop = out.scrollHeight;
  }

  /**
   * The panel follows the log rather than waiting to be polled, so events emitted while nothing is
   * moving — parameter changes, system messages — show up immediately instead of only once a shot
   * is in flight.
   *
   * Throttled, because a shot in flight emits collisions faster than there is any point redrawing
   * a few hundred lines of text. The first event after a quiet spell renders at once; a burst
   * coalesces into one render per interval.
   */
  const MIN_RENDER_GAP_MS = 80;
  let lastRender = 0;
  let pending = false;

  function scheduleRender(): void {
    const now = Date.now();
    if (now - lastRender >= MIN_RENDER_GAP_MS) {
      lastRender = now;
      render();
      return;
    }
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      lastRender = Date.now();
      render();
    }, MIN_RENDER_GAP_MS);
  }

  logger.subscribe(scheduleRender);

  render();
  return { el, refresh: render };
}
