/**
 * Placement of the outcome-table overlay (DESIGN.md §7, §12).
 *
 * The brief was "bottom right, under the basket, but not overlapping the parts the ball would pass
 * through on a successful shot". The first two are a layout choice; the third is a claim about the
 * physics, so it is measured here rather than eyeballed — and the measurement is what established
 * that the third cannot be fully satisfied.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANGLE_DEG,
  DEFAULT_RELEASE_Y,
  DEFAULT_SPEED,
  FT_LINE_X,
  R_BALL,
} from '../src/core/constants.js';
import { isMake } from '../src/core/scoring.js';
import { makeDescriptor, Simulation } from '../src/core/sim.js';
import {
  ballOverlapsRect,
  DEFAULT_VIEW,
  fitCamera,
  placeOverlay,
  rectToScreen,
  TABLE_OVERLAY_RECT,
} from '../src/render/camera.js';
import { REG_WORLD } from './helpers.js';

/** Flight path up to the first floor contact — "the shot", as opposed to the ball rolling around. */
function shotPath(angleDeg: number, speed: number): {
  pts: { x: number; y: number }[];
  made: boolean;
} {
  const sim = new Simulation(REG_WORLD);
  sim.release(
    makeDescriptor({
      levelId: 'regulation',
      shooterX: FT_LINE_X,
      releaseY: DEFAULT_RELEASE_Y,
      angleDeg,
      speed,
    }),
  );
  const pts: { x: number; y: number }[] = [];
  let collecting = true;
  while (sim.phase === 'flight') {
    if (collecting) pts.push({ x: sim.ball.p.x, y: sim.ball.p.y });
    sim.step();
    if (sim.ball.p.y <= R_BALL + 0.02) collecting = false;
  }
  return { pts, made: sim.result !== null && isMake(sim.result.outcome) };
}

/**
 * Does the ball at p overlap the overlay rect?
 *
 * Note the single-argument wrapper at every call site: passing this straight to `filter` would hand
 * it the array index as its second argument, inflating the ball radius to metres and matching
 * everything — which is exactly what happened the first time.
 */
function inRect(p: { x: number; y: number }): boolean {
  return (
    p.x + R_BALL > TABLE_OVERLAY_RECT.minX &&
    p.x - R_BALL < TABLE_OVERLAY_RECT.maxX &&
    p.y + R_BALL > TABLE_OVERLAY_RECT.minY &&
    p.y - R_BALL < TABLE_OVERLAY_RECT.maxY
  );
}

describe('overlay placement', () => {
  it('sits in the bottom right of the view, under the basket', () => {
    const r = TABLE_OVERLAY_RECT;
    expect(r.minY).toBe(DEFAULT_VIEW.min.y); // sits on the floor line
    expect(r.maxX).toBeLessThan(DEFAULT_VIEW.max.x); // gutter for the exit carom
    expect(r.maxX).toBeGreaterThan(REG_WORLD.goal.hoopX); // extends past the basket
    expect(r.minX).toBeLessThan(REG_WORLD.goal.hoopX); // and starts before it: under the basket
    expect(r.maxY).toBeLessThan(REG_WORLD.goal.rimY - 1); // well below the rim
    // Right half of the court, so "bottom right" holds.
    expect((r.minX + r.maxX) / 2).toBeGreaterThan((DEFAULT_VIEW.min.x + DEFAULT_VIEW.max.x) / 2);
  });

  it('is clear of the default made shot', () => {
    const { pts, made } = shotPath(DEFAULT_ANGLE_DEG, DEFAULT_SPEED);
    expect(made).toBe(true);
    const hits = pts.filter((p) => inRect(p));
    expect(hits, `default shot passes through the overlay at ${JSON.stringify(hits[0])}`).toEqual([]);
  });

  it('clears the default shot with a real margin, not by a whisker', () => {
    const { pts } = shotPath(DEFAULT_ANGLE_DEG, DEFAULT_SPEED);
    let lowest = Infinity;
    for (const p of pts) {
      if (p.x + R_BALL < TABLE_OVERLAY_RECT.minX) continue;
      if (p.x - R_BALL > TABLE_OVERLAY_RECT.maxX) continue;
      lowest = Math.min(lowest, p.y - R_BALL);
    }
    expect(lowest).toBeGreaterThan(TABLE_OVERLAY_RECT.maxY + 0.15);
  });

  it('is crossed by most other made shots, which is why the fade exists', () => {
    // The uncomfortable half of the measurement, kept as a test rather than a comment: the exit
    // carom owns the bottom-right of the view, so no rectangle there is clear of made shots in
    // general. The runtime fade is load-bearing, not a nice-to-have.
    let made = 0;
    let crossing = 0;
    for (let angle = 40; angle <= 65; angle += 5) {
      for (let s = 680; s <= 800; s += 4) {
        const shot = shotPath(angle, s / 100);
        if (!shot.made) continue;
        made++;
        if (shot.pts.some((p) => inRect(p))) crossing++;
      }
    }
    expect(made).toBeGreaterThan(20);
    // If this ever reaches zero the placement became genuinely safe and the fade could go.
    expect(crossing).toBeGreaterThan(made / 2);
  });
});

describe('overlay pixel placement', () => {
  const cam = fitCamera(1200, 700);

  it('maps the world rect to a box on the canvas', () => {
    const px = rectToScreen(cam, TABLE_OVERLAY_RECT);
    expect(px.width).toBeGreaterThan(0);
    expect(px.height).toBeGreaterThan(0);
    // Its right edge stops short of the view's right edge — the carom's gutter.
    const viewRight = cam.toScreen({ x: DEFAULT_VIEW.max.x, y: 0 }).x;
    expect(px.left + px.width).toBeLessThan(viewRight);
  });

  it('never shrinks below a usable size', () => {
    // A short window squeezes the world rect; the panel grows up and left from its corner instead
    // of becoming unreadable. That can push it into the ball's path, which the fade covers.
    const tiny = fitCamera(420, 260);
    const r = placeOverlay(tiny, 420, 260, 300, 180);
    expect(r.width).toBeGreaterThanOrEqual(300);
    expect(r.height).toBeGreaterThanOrEqual(180);
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.top).toBeGreaterThanOrEqual(8);
  });

  it('stays inside the canvas', () => {
    const r = placeOverlay(cam, 1200, 700, 300, 180);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(1200);
    expect(r.top + r.height).toBeLessThanOrEqual(700);
  });

  it('tracks the camera, so it stays put relative to the court', () => {
    // Same court geometry and aspect ratio at two sizes: the rect must land at the same fraction of
    // the canvas. Both are large enough that the minimum-size clamp does not bind — at 800px wide
    // it does, which is why that case is covered by the test above instead.
    const big = placeOverlay(fitCamera(1600, 900), 1600, 900, 300, 180);
    const small = placeOverlay(fitCamera(1200, 675), 1200, 675, 300, 180);
    expect(big.width).toBeGreaterThan(300);
    expect(small.width).toBeGreaterThan(300);
    expect(big.width / 1600).toBeCloseTo(small.width / 1200, 2);
    expect(big.height / 900).toBeCloseTo(small.height / 675, 2);
  });
});

describe('ball overlap test', () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };

  it('detects a ball inside the rect', () => {
    expect(ballOverlapsRect(rect, 150, 150, 10)).toBe(true);
  });

  it('detects a ball clipping the edge', () => {
    expect(ballOverlapsRect(rect, 95, 150, 10)).toBe(true);
    expect(ballOverlapsRect(rect, 305, 150, 10)).toBe(true);
  });

  it('ignores a ball clear of the rect', () => {
    expect(ballOverlapsRect(rect, 50, 150, 10)).toBe(false);
    expect(ballOverlapsRect(rect, 150, 50, 10)).toBe(false);
    expect(ballOverlapsRect(rect, 150, 250, 10)).toBe(false);
  });
});
