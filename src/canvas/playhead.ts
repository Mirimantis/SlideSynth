import type { Viewport } from './viewport';

/**
 * Render the playhead (vertical red line) at the given beat position.
 */
export function renderPlayhead(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  positionBeats: number,
  height: number,
): void {
  const { sx } = vp.worldToScreen(positionBeats, 0);

  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, height);
  ctx.strokeStyle = '#f44336';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Small triangle at top
  ctx.beginPath();
  ctx.moveTo(sx - 5, 0);
  ctx.lineTo(sx + 5, 0);
  ctx.lineTo(sx, 8);
  ctx.closePath();
  ctx.fillStyle = '#f44336';
  ctx.fill();
}
