/**
 * @vitest-environment jsdom
 *
 * Boot smoke test for the UI layer.
 *
 * The sim core is covered by the other specs; this one exists because a module-initialisation
 * mistake in main.ts (an ordering bug, a missing element, a handler that throws) would produce a
 * blank page that no amount of core testing would catch.
 *
 * jsdom has no canvas implementation, so the 2D context is stubbed with a recorder. That is enough
 * to exercise every drawing path and to prove the wiring holds together.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

/** A 2D context stub: every method is a no-op, and calls are counted. */
function makeContextStub(): { ctx: unknown; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    canvas: null,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    setTransform: () => {},
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      // Properties like fillStyle/lineWidth are read and written freely.
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        void args;
        return undefined;
      };
    },
    set(obj, prop: string, value: unknown) {
      obj[prop] = value;
      return true;
    },
  });
  return { ctx, calls };
}

let calls: Map<string, number>;

beforeAll(async () => {
  document.body.innerHTML = '<main id="app"></main>';

  const stub = makeContextStub();
  calls = stub.calls;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = (() => stub.ctx) as any;

  // jsdom's rAF would keep the loop spinning; run exactly one frame on demand instead.
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });

  await import('../src/main.js');

  // Drive a couple of frames by hand.
  const first = frames.shift();
  first?.(16);
  const second = frames.shift();
  second?.(33);
});

describe('app boots', () => {
  it('mounts the court, panel and log drawer', () => {
    expect(document.querySelector('canvas.court')).not.toBeNull();
    expect(document.querySelector('.panel')).not.toBeNull();
    expect(document.querySelector('.drawer')).not.toBeNull();
    expect(document.querySelector('.hud')).not.toBeNull();
  });

  it('actually draws something', () => {
    expect(calls.get('fillRect') ?? 0).toBeGreaterThan(0);
    expect(calls.get('stroke') ?? 0).toBeGreaterThan(0);
    expect(calls.get('arc') ?? 0).toBeGreaterThan(0);
  });

  it('builds every shot control', () => {
    for (const id of ['slider-x', 'slider-y', 'slider-angle', 'slider-power']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  describe('controls panel visibility', () => {
    const toggle = (): HTMLButtonElement =>
      document.querySelector('.panel-toggle') as HTMLButtonElement;
    const panel = (): HTMLElement => document.querySelector('.panel') as HTMLElement;
    const appEl = (): HTMLElement => document.getElementById('app') as HTMLElement;

    it('starts closed, with the toggle button as the only chrome', () => {
      expect(toggle()).not.toBeNull();
      expect(panel().classList.contains('hidden')).toBe(true);
      expect(appEl().classList.contains('controls-open')).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      // The grid must drop the panel column too, or the court is short 320px of dead space.
      expect(toggle().getAttribute('aria-controls')).toBe('controls-panel');
      expect(panel().id).toBe('controls-panel');
    });

    it('opens on the button and closes again', () => {
      toggle().click();
      expect(panel().classList.contains('hidden')).toBe(false);
      expect(appEl().classList.contains('controls-open')).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().classList.contains('on')).toBe(true);

      toggle().click();
      expect(panel().classList.contains('hidden')).toBe(true);
      expect(appEl().classList.contains('controls-open')).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes from the panel’s own close button', () => {
      toggle().click();
      expect(panel().classList.contains('hidden')).toBe(false);
      // Scoped: the table overlay has a close button of its own, earlier in document order.
      (document.querySelector('.panel > .panel-head .panel-close') as HTMLButtonElement).click();
      expect(panel().classList.contains('hidden')).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('toggles with the M key', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(panel().classList.contains('hidden')).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
      expect(panel().classList.contains('hidden')).toBe(true);
    });

    it('still builds every control while hidden, so opening is instant', () => {
      expect(panel().classList.contains('hidden')).toBe(true);
      for (const id of ['slider-x', 'slider-y', 'slider-angle', 'slider-power']) {
        expect(document.getElementById(id), id).not.toBeNull();
      }
    });
  });

  it('shows the ready verdict before any shot', () => {
    expect(document.querySelector('.verdict')?.textContent).toBe('Ready');
  });

  it('releases a shot on Space and logs it', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const logText = document.querySelector('.logout')?.textContent ?? '';
    expect(logText).toContain('RELEASE');
    // The release line records the resolved v0 vector, per the determinism contract.
    expect(logText).toMatch(/v0=\(\+\d/);
  });

  it('writes the shot into the URL hash so it can be shared', () => {
    expect(location.hash).toMatch(/a=\d+(\.\d+)?/);
    expect(location.hash).toMatch(/s=\d+(\.\d+)?/);
  });

  it('nudges the angle with the arrow keys', () => {
    const angle = document.getElementById('slider-angle') as HTMLInputElement;
    const before = Number(angle.value);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(Number(angle.value)).toBeCloseTo(before + 1, 5);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(Number(angle.value)).toBeCloseTo(before, 5);
  });

  it('toggles the help overlay with ?', () => {
    const help = document.querySelector('.help');
    expect(help?.classList.contains('hidden')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    expect(help?.classList.contains('hidden')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(help?.classList.contains('hidden')).toBe(true);
  });

  it('keeps the outcome table overlay hidden until asked for', () => {
    const overlay = document.querySelector('.table-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains('hidden')).toBe(true);
    const toggle = document.querySelector('.table-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('table-overlay');
  });

  it('opens and closes the overlay from its button and the T key', () => {
    const overlay = document.querySelector('.table-overlay') as HTMLElement;
    const toggle = document.querySelector('.table-toggle') as HTMLButtonElement;

    toggle.click();
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.classList.contains('on')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts the sweep ranges in the controls panel, not the overlay', () => {
    // The ranges are variables, so they belong with the other variables.
    for (const id of ['slider-t-amin', 'slider-t-amax', 'slider-t-smin', 'slider-t-sstep']) {
      const el = document.getElementById(id);
      expect(el, id).not.toBeNull();
      expect(el?.closest('.panel'), id).not.toBeNull();
      expect(el?.closest('.table-overlay'), id).toBeNull();
    }
  });

  it('generates a table with a binary result and a clearance per cell', async () => {
    // jsdom has no Worker, so this runs the synchronous fallback — same pure sweep function.
    const gen = [...document.querySelectorAll('.panel button')].find(
      (b) => b.textContent === 'Generate table',
    ) as HTMLButtonElement | undefined;
    expect(gen).toBeDefined();
    gen?.click();

    // Generating is what brings the overlay up — no separate step to go and look at it.
    expect(document.querySelector('.table-overlay')?.classList.contains('hidden')).toBe(false);

    // Let the (already-resolved) promise and its .then chain flush.
    await new Promise((r) => setTimeout(r, 0));

    const table = document.querySelector('table.outcome-table');
    expect(table).not.toBeNull();

    const headers = [...(table?.querySelectorAll('thead th') ?? [])].map((h) => h.textContent);
    // Corner plus one column per angle in the default 40-65 range at 2.5 deg steps.
    expect(headers.length).toBe(1 + 11);
    expect(headers[1]).toBe('40°');

    const rows = table?.querySelectorAll('tbody tr') ?? [];
    expect(rows.length).toBe(61); // 6.8 to 8.0 m/s at 0.02 steps

    const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
    expect(cells.length).toBe(11 * 61);

    // Every cell carries the binary make and a clearance figure.
    for (const td of cells) {
      const made = td.querySelector('b')?.textContent;
      expect(['0', '1']).toContain(made);
      const clearance = td.querySelector('.clearance')?.textContent ?? '';
      expect(clearance === 'hit' || Number.isFinite(Number(clearance))).toBe(true);
    }

    // The default window straddles the make band, so the table must contain both results.
    const madeValues = cells.map((td) => td.querySelector('b')?.textContent);
    expect(madeValues).toContain('1');
    expect(madeValues).toContain('0');

    // And the overlay's header reports the make rate plus the widest margin found.
    const summary = document.querySelector('.overlay-summary')?.textContent ?? '';
    expect(summary).toMatch(/\d+\/\d+ made/);
    expect(summary).toMatch(/best \d+(\.\d+)? cm/);
  });

  it('renders the table inside the overlay, over the court', () => {
    const table = document.querySelector('table.outcome-table');
    expect(table).not.toBeNull();
    // It must be in the floating overlay, which must itself be over the canvas.
    expect(table?.closest('.table-overlay')).not.toBeNull();
    expect(document.querySelector('.table-overlay')?.closest('.court-wrap')).not.toBeNull();
    expect(document.querySelector('.table-overlay')?.closest('.drawer')).toBeNull();
  });

  it('keeps the log drawer for the log alone', () => {
    expect(document.querySelector('.drawer .logpanel')).not.toBeNull();
    expect(document.querySelector('.drawer .table-overlay')).toBeNull();
    expect(document.querySelector('button.tab')).toBeNull();
  });

  it('fires the shot for a table cell that is clicked', () => {
    // Cells carry their colour category as a class.
    const made = [
      ...document.querySelectorAll(
        'table.outcome-table td.clean_make, table.outcome-table td.rim_up, table.outcome-table td.rim_down',
      ),
    ] as HTMLElement[];
    expect(made.length).toBeGreaterThan(0);
    made[0]?.click();
    // The court is now simulating that cell's shot, and the log recorded the release.
    const logText = document.querySelector('.logout')?.textContent ?? '';
    expect(logText).toContain('RELEASE');
  });

  it('offers the table exports in the overlay', () => {
    const labels = [...document.querySelectorAll('.overlay-exports button')].map(
      (b) => b.textContent,
    );
    expect(labels).toContain('CSV rows');
    expect(labels).toContain('CSV clearance');
    expect(labels).toContain('JSON');
  });

  it('offers the log filters and exports', () => {
    const chips = [...document.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(chips).toContain('collision');
    expect(chips).toContain('result');
    const buttons = [...document.querySelectorAll('.logbar button')].map((b) => b.textContent);
    expect(buttons).toContain('export JSON');
    expect(buttons).toContain('export CSV');
  });
});
