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
