/**
 * World <-> screen transform (DESIGN.md §4).
 *
 * This is the ONLY place where metres become pixels. The sim never sees a pixel, and the renderer
 * never does physics.
 */

import type { Metres, Vec2 } from '../core/units.js';
import { v2 } from '../core/units.js';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface Camera {
  /** Pixels per metre. */
  readonly scale: number;
  toScreen(p: Vec2): ScreenPoint;
  toWorld(sx: number, sy: number): Vec2;
  /** Length in metres -> length in pixels. */
  px(metres: Metres): number;
}

export interface ViewRegion {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** The slice of the court we want on screen: the floor, the shooter, and well above the rim. */
export const DEFAULT_VIEW: ViewRegion = { min: v2(-0.6, -0.25), max: v2(7.0, 4.8) };

/**
 * Where the outcome table sits: bottom-right, under the basket, in world coordinates so it stays
 * put relative to the court at any window size.
 *
 * These bounds are measured from the physics, not picked by eye, and the measurement says the brief
 * ("bottom right, under the basket, clear of where the ball goes on a successful shot") cannot be
 * fully satisfied. A made shot does not drop vertically through the net: it enters at roughly a 40°
 * angle and caroms forward-right at about 4.5 m/s, so the exit path owns the bottom-right of the
 * view. Sweeping 432 made shots against candidate rectangles:
 *
 *   right edge | top  | clears the default shot | made shots crossing
 *         6.20 | 1.40 | yes                     | 75%
 *         6.40 | 1.60 | yes                     | 90%
 *         6.55 | 1.80 | no                      | 99%
 *         7.00 | any  | no                      | 100%
 *
 * Flush to the right edge of the view, *every* made shot crosses it. So this rect is chosen to
 * clear the default shot — the one you get by just pressing Space — with the right edge pulled in
 * to 6.4 m to leave the exit carom a gutter, and the rest is handled at runtime: the overlay fades
 * while the ball is over it (see main.ts), so it never actually hides the ball.
 *
 * The only region genuinely clear of made-shot flight paths is the lower LEFT, and that is where
 * the shooter stands.
 */
export const TABLE_OVERLAY_RECT = { minX: 3.4, minY: -0.25, maxX: 6.4, maxY: 1.6 } as const;

export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Does the ball overlap this rect on screen?
 *
 * Used to fade the outcome table out of the way rather than let it hide the ball. The ball is
 * treated as its bounding box, which errs toward fading slightly early — the right direction to err
 * in, since a fade that comes a frame late is the visible failure.
 */
export function ballOverlapsRect(
  rect: PixelRect,
  ballX: number,
  ballY: number,
  radiusPx: number,
): boolean {
  return (
    ballX + radiusPx > rect.left &&
    ballX - radiusPx < rect.left + rect.width &&
    ballY + radiusPx > rect.top &&
    ballY - radiusPx < rect.top + rect.height
  );
}

/** Convert a world-space rect to a pixel rect inside the canvas box. */
export function rectToScreen(
  cam: Camera,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): PixelRect {
  const topLeft = cam.toScreen(v2(rect.minX, rect.maxY));
  const bottomRight = cam.toScreen(v2(rect.maxX, rect.minY));
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * Place the overlay from its world rect, keeping it anchored to the bottom-right of the canvas and
 * never smaller than it needs to be to stay usable.
 *
 * On a small or short window the world rect can shrink below a workable size; when that happens the
 * panel grows up and to the left from its anchored corner rather than becoming unreadable. That can
 * push it into the ball's path, which is what the runtime fade is for.
 */
export function placeOverlay(
  cam: Camera,
  canvasW: number,
  canvasH: number,
  minWidth: number,
  minHeight: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number } = TABLE_OVERLAY_RECT,
): PixelRect {
  const px = rectToScreen(cam, rect);

  const width = Math.min(Math.max(px.width, minWidth), canvasW - 16);
  const height = Math.min(Math.max(px.height, minHeight), canvasH - 16);

  // Anchor the bottom-right corner, then extend left/up as needed.
  const right = Math.min(px.left + px.width, canvasW - 8);
  const bottom = Math.min(px.top + px.height, canvasH - 8);

  return {
    left: Math.max(right - width, 8),
    top: Math.max(bottom - height, 8),
    width,
    height,
  };
}

/**
 * Fit the view region into the canvas, preserving aspect ratio and centring the leftovers. y is
 * flipped here, once, so every other drawing routine can think in world coordinates.
 */
export function fitCamera(canvasW: number, canvasH: number, view: ViewRegion = DEFAULT_VIEW): Camera {
  const viewW = view.max.x - view.min.x;
  const viewH = view.max.y - view.min.y;
  const scale = Math.min(canvasW / viewW, canvasH / viewH);

  // Centre the fitted region in whichever axis has slack.
  const offsetX = (canvasW - viewW * scale) / 2;
  const offsetY = (canvasH - viewH * scale) / 2;

  return {
    scale,
    toScreen(p: Vec2): ScreenPoint {
      return {
        x: offsetX + (p.x - view.min.x) * scale,
        y: canvasH - offsetY - (p.y - view.min.y) * scale,
      };
    },
    toWorld(sx: number, sy: number): Vec2 {
      return v2(
        (sx - offsetX) / scale + view.min.x,
        (canvasH - offsetY - sy) / scale + view.min.y,
      );
    },
    px(metres: Metres): number {
      return metres * scale;
    },
  };
}
