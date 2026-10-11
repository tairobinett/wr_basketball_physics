/**
 * Court, goal, shooter and ball rendering (DESIGN.md §7).
 *
 * Everything here is drawn from world geometry, never from hardcoded pixel values, so moving the
 * goal or changing the ball size shows up on screen with no edits.
 */

import type { BallState } from '../core/ball.js';
import { BOARD_BOTTOM_Y, BOARD_TOP_Y, RIM_TUBE_R, R_BALL } from '../core/constants.js';
import type { Metres, Vec2 } from '../core/units.js';
import { v2 } from '../core/units.js';
import type { World } from '../core/world.js';
import type { Camera } from './camera.js';

export const COLORS = {
  sky: '#0e1118',
  skyGlow: '#171d2a',
  floor: '#5a3c22',
  floorLine: '#8a5f36',
  wall: '#1b2230',
  board: '#c9d6e4',
  boardGlass: 'rgba(201, 214, 228, 0.14)',
  boardSquare: '#e8622a',
  rim: '#e8622a',
  rimShade: '#b8431a',
  net: 'rgba(235, 240, 248, 0.55)',
  ball: '#d96d25',
  ballDark: '#a84f17',
  ballSeam: '#231209',
  shooter: '#8fa3bd',
  text: '#cfd8e3',
} as const;

function line(ctx: CanvasRenderingContext2D, cam: Camera, a: Vec2, b: Vec2): void {
  const sa = cam.toScreen(a);
  const sb = cam.toScreen(b);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  c: Vec2,
  r: Metres,
  fill: boolean,
): void {
  const s = cam.toScreen(c);
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(cam.px(r), 0.75), 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, COLORS.skyGlow);
  g.addColorStop(1, COLORS.sky);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function drawCourt(ctx: CanvasRenderingContext2D, cam: Camera, world: World): void {
  const { min, max } = world.bounds;

  // Floor slab.
  const floorTop = cam.toScreen(v2(min.x, 0));
  const floorRight = cam.toScreen(v2(max.x, 0));
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(floorTop.x, floorTop.y, floorRight.x - floorTop.x, cam.px(0.6));

  ctx.strokeStyle = COLORS.floorLine;
  ctx.lineWidth = 2;
  line(ctx, cam, v2(min.x, 0), v2(max.x, 0));

  // Metre ticks along the floor, so distances are readable at a glance.
  ctx.strokeStyle = 'rgba(207, 216, 227, 0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(207, 216, 227, 0.35)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (let x = 0; x <= Math.ceil(max.x); x++) {
    line(ctx, cam, v2(x, 0), v2(x, -0.08));
    const s = cam.toScreen(v2(x, -0.12));
    ctx.fillText(`${x}m`, s.x, s.y + 10);
  }
}

/** The free-throw line marker on the floor. */
export function drawFreeThrowLine(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: Metres,
): void {
  ctx.strokeStyle = 'rgba(232, 98, 42, 0.5)';
  ctx.lineWidth = 2;
  line(ctx, cam, v2(x, 0), v2(x, 0.14));
  ctx.fillStyle = 'rgba(232, 98, 42, 0.6)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  const s = cam.toScreen(v2(x, 0.22));
  ctx.fillText('FT', s.x, s.y);
}

export function drawGoal(ctx: CanvasRenderingContext2D, cam: Camera, world: World): void {
  const { goal } = world;

  // Support arm behind the board.
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = cam.px(0.12);
  line(ctx, cam, v2(goal.boardX + 0.05, BOARD_BOTTOM_Y + 0.2), v2(goal.boardX + 0.6, BOARD_BOTTOM_Y + 0.2));
  line(ctx, cam, v2(goal.boardX + 0.6, 0), v2(goal.boardX + 0.6, BOARD_TOP_Y));

  // Backboard: a glass pane seen edge-on, drawn with thickness so it reads as a solid object.
  const top = cam.toScreen(v2(goal.boardX, BOARD_TOP_Y));
  const bottom = cam.toScreen(v2(goal.boardX, BOARD_BOTTOM_Y));
  ctx.fillStyle = COLORS.boardGlass;
  ctx.fillRect(top.x, top.y, Math.max(cam.px(0.05), 3), bottom.y - top.y);
  ctx.strokeStyle = COLORS.board;
  ctx.lineWidth = 2.5;
  line(ctx, cam, v2(goal.boardX, BOARD_BOTTOM_Y), v2(goal.boardX, BOARD_TOP_Y));

  // The inner square's bottom edge sits level with the rim.
  ctx.strokeStyle = COLORS.boardSquare;
  ctx.lineWidth = 2;
  line(ctx, cam, v2(goal.boardX - 0.02, goal.rimY), v2(goal.boardX - 0.02, goal.rimY + 0.457));

  // Net, purely cosmetic: it has no collider and cannot affect the physics (DESIGN.md §7).
  ctx.strokeStyle = COLORS.net;
  ctx.lineWidth = 1;
  const netDepth = 0.4;
  const strands = 7;
  for (let i = 0; i <= strands; i++) {
    const f = i / strands;
    const topX = goal.leftEdge + f * (goal.rightEdge - goal.leftEdge);
    const botX = goal.hoopX + (topX - goal.hoopX) * 0.45;
    line(ctx, cam, v2(topX, goal.rimY), v2(botX, goal.rimY - netDepth));
  }
  for (const f of [0.33, 0.66, 1]) {
    const y = goal.rimY - netDepth * f;
    const halfWidth = ((goal.rightEdge - goal.leftEdge) / 2) * (1 - 0.55 * f);
    line(ctx, cam, v2(goal.hoopX - halfWidth, y), v2(goal.hoopX + halfWidth, y));
  }

  // Rim: two tube cross-sections, which is exactly what the colliders are.
  ctx.fillStyle = COLORS.rim;
  circle(ctx, cam, goal.frontRim, RIM_TUBE_R * 2.2, true);
  circle(ctx, cam, goal.backRim, RIM_TUBE_R * 2.2, true);
  ctx.strokeStyle = COLORS.rimShade;
  ctx.lineWidth = 1;
  circle(ctx, cam, goal.frontRim, RIM_TUBE_R * 2.2, false);
  circle(ctx, cam, goal.backRim, RIM_TUBE_R * 2.2, false);
}

/**
 * Static stick figure (DESIGN.md §7). No animation, no pose changes: the whole body scales so the
 * hands sit at the release height, which is the only thing that moves when that slider changes.
 */
export function drawShooter(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  x: Metres,
  releaseY: Metres,
): void {
  const ARM = 0.55;
  const shoulderY = Math.max(releaseY - ARM, 0.8);
  const s = shoulderY / 1.45; // reference shoulder height for an adult
  const hipY = 0.95 * s;
  const headR = 0.115 * s;
  const headY = shoulderY + headR * 1.4;

  ctx.strokeStyle = COLORS.shooter;
  ctx.lineWidth = Math.max(cam.px(0.035), 2);
  ctx.lineCap = 'round';

  // Legs, slightly apart.
  line(ctx, cam, v2(x - 0.18 * s, 0), v2(x, hipY));
  line(ctx, cam, v2(x + 0.18 * s, 0), v2(x, hipY));
  // Torso.
  line(ctx, cam, v2(x, hipY), v2(x, shoulderY));
  // Arms up to the release point.
  line(ctx, cam, v2(x, shoulderY), v2(x - 0.07, releaseY - R_BALL * 0.5));
  line(ctx, cam, v2(x, shoulderY), v2(x + 0.12, releaseY - R_BALL * 0.5));

  ctx.fillStyle = COLORS.shooter;
  circle(ctx, cam, v2(x, headY), headR, true);
}

export function drawBall(ctx: CanvasRenderingContext2D, cam: Camera, ball: BallState): void {
  const s = cam.toScreen(ball.p);
  const r = cam.px(R_BALL);

  const g = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.35, r * 0.1, s.x, s.y, r);
  g.addColorStop(0, COLORS.ball);
  g.addColorStop(1, COLORS.ballDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Seams, rotated by theta so spin is visible. This is the only reason theta is tracked.
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-ball.theta);
  ctx.strokeStyle = COLORS.ballSeam;
  ctx.lineWidth = Math.max(r * 0.09, 1);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.55, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
