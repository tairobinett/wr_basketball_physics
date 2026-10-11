/**
 * Debug overlays (DESIGN.md §7).
 *
 * The predicted-arc ghost is the interesting one: it is not a separate predictor, it is the same
 * core run headlessly from the current parameters. It is exactly the path the ball will fly, which
 * is a direct payoff of the determinism contract.
 */

import type { BallState } from '../core/ball.js';
import type { Collider } from '../core/colliders.js';
import { R_BALL } from '../core/constants.js';
import type { Vec2 } from '../core/units.js';
import { addScaled, len, v2 } from '../core/units.js';
import type { World } from '../core/world.js';
import type { Camera } from './camera.js';

export interface ContactMark {
  readonly p: Vec2;
  readonly n: Vec2;
  /** Sim time of the contact, used to fade the mark out. */
  readonly t: number;
}

export function drawTrail(ctx: CanvasRenderingContext2D, cam: Camera, trail: readonly Vec2[]): void {
  if (trail.length < 2) return;
  ctx.strokeStyle = 'rgba(232, 160, 90, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const first = trail[0];
  if (first === undefined) return;
  const s0 = cam.toScreen(first);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < trail.length; i++) {
    const p = trail[i];
    if (p === undefined) continue;
    const s = cam.toScreen(p);
    ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

export function drawGhost(ctx: CanvasRenderingContext2D, cam: Camera, path: readonly Vec2[]): void {
  if (path.length < 2) return;
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(207, 216, 227, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const first = path[0];
  if (first !== undefined) {
    const s0 = cam.toScreen(first);
    ctx.moveTo(s0.x, s0.y);
  }
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    if (p === undefined) continue;
    const s = cam.toScreen(p);
    ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Wireframe of the actual colliders — what the physics sees, as opposed to what is drawn. */
export function drawColliders(ctx: CanvasRenderingContext2D, cam: Camera, world: World): void {
  ctx.strokeStyle = 'rgba(120, 230, 160, 0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (const col of world.colliders as readonly Collider[]) {
    if (col.kind === 'segment') {
      const a = cam.toScreen(col.a);
      const b = cam.toScreen(col.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      const c = cam.toScreen(col.c);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(cam.px(col.r), 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // The scoring gate: the rim's inner edges and the plane the ball must cross downward.
  ctx.strokeStyle = 'rgba(120, 230, 160, 0.45)';
  ctx.setLineDash([3, 3]);
  const gl = cam.toScreen(v2(world.goal.leftEdge, world.goal.rimY));
  const gr = cam.toScreen(v2(world.goal.rightEdge, world.goal.rimY));
  ctx.beginPath();
  ctx.moveTo(gl.x, gl.y);
  ctx.lineTo(gr.x, gr.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawVelocity(ctx: CanvasRenderingContext2D, cam: Camera, ball: BallState): void {
  const speed = len(ball.v);
  if (speed < 0.05) return;
  // 0.1 m of arrow per m/s keeps it readable at shot speeds.
  const tip = addScaled(ball.p, ball.v, 0.1);
  const a = cam.toScreen(ball.p);
  const b = cam.toScreen(tip);

  ctx.strokeStyle = 'rgba(120, 190, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 8 * Math.cos(ang - 0.4), b.y - 8 * Math.sin(ang - 0.4));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 8 * Math.cos(ang + 0.4), b.y - 8 * Math.sin(ang + 0.4));
  ctx.stroke();
}

/** Contact normals, fading out over a second of sim time. */
export function drawContacts(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  marks: readonly ContactMark[],
  now: number,
): void {
  for (const m of marks) {
    const age = now - m.t;
    if (age > 1) continue;
    const alpha = 1 - age;
    ctx.strokeStyle = `rgba(255, 110, 110, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 2;
    const a = cam.toScreen(m.p);
    const b = cam.toScreen(addScaled(m.p, m.n, R_BALL * 2.5));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 110, 110, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The aim arrow shown while dragging from the shooter. */
export function drawAim(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  from: Vec2,
  angleDeg: number,
  speed: number,
  maxSpeed: number,
): void {
  const rad = (angleDeg * Math.PI) / 180;
  const lengthM = 0.4 + 1.6 * (speed / maxSpeed);
  const tip = v2(from.x + Math.cos(rad) * lengthM, from.y + Math.sin(rad) * lengthM);
  const a = cam.toScreen(from);
  const b = cam.toScreen(tip);

  ctx.strokeStyle = 'rgba(232, 98, 42, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 11 * Math.cos(ang - 0.35), b.y - 11 * Math.sin(ang - 0.35));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 11 * Math.cos(ang + 0.35), b.y - 11 * Math.sin(ang + 0.35));
  ctx.stroke();
}
