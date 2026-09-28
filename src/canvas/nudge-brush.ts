import type { BezierCurve } from '../types';
import type { Viewport } from './viewport';
import { pitchPoints } from '../model/curve';
import { themeColor } from '../theme/theme';

/**
 * The Nudge brush on the canvas (BACKLOG 13.26): a faint band over its reach,
 * brightest at the centre as the falloff is, and the points it will move lit
 * up by their weight.
 */
export function renderNudgeBrush(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curve: BezierCurve,
  centerX: number,
  radius: number,
  /** The points to light and their weights: those in reach while hovering or
   *  smoothing, the ones being pushed during a Push. */
  reach: readonly { index: number; weight: number }[],
  top: number,
  height: number,
): void {
  const left = vp.worldToScreen(centerX - radius, 0).sx;
  const right = vp.worldToScreen(centerX + radius, 0).sx;
  if (right - left < 1) return;
  ctx.save();
  const band = ctx.createLinearGradient(left, 0, right, 0);
  band.addColorStop(0, themeColor('nudge-band-edge'));
  band.addColorStop(0.5, themeColor('nudge-band'));
  band.addColorStop(1, themeColor('nudge-band-edge'));
  ctx.fillStyle = band;
  ctx.fillRect(left, top, right - left, height - top);

  const points = pitchPoints(curve);
  ctx.fillStyle = themeColor('nudge-point');
  for (const { index, weight } of reach) {
    const p = points[index]?.position;
    if (!p) continue;
    const s = vp.worldToScreen(p.x, p.y);
    ctx.globalAlpha = 0.25 + 0.75 * weight;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, 2 + 2.5 * weight, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A thin, faint ring round the cursor at the brush's size. */
export function renderNudgeRing(ctx: CanvasRenderingContext2D, sx: number, sy: number, radiusPx: number): void {
  ctx.save();
  ctx.strokeStyle = themeColor('nudge-ring');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
