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

  it('offers the log filters and exports', () => {
    const chips = [...document.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(chips).toContain('collision');
    expect(chips).toContain('result');
    const buttons = [...document.querySelectorAll('.logbar button')].map((b) => b.textContent);
    expect(buttons).toContain('export JSON');
    expect(buttons).toContain('export CSV');
  });
});
