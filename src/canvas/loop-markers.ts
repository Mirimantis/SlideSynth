import type { Viewport } from './viewport';

export const LOOP_IN_COLOR = '#4caf50';
export const LOOP_OUT_COLOR = '#b71c1c';
const RANGE_TINT = 'rgba(76, 175, 80, 0.07)';

/**
 * Render the two draggable loop-range markers (green = in, red = out) in the
 * ruler bar, plus a subtle tint across the range between them. Mirrors the
 * playhead's line + top-triangle geometry.
 * Called only when Loop is enabled.
 */
export function renderLoopMarkers(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  loopStartBeats: number,
  loopEndBeats: number,
  canvasHeight: number,
): void {
  const { sx: sxIn } = vp.worldToScreen(loopStartBeats, 0);
  const { sx: sxOut } = vp.worldToScreen(loopEndBeats, 0);

  // Tint the range between markers so the active loop zone reads visually.
  if (sxOut > sxIn) {
    ctx.fillStyle = RANGE_TINT;
    ctx.fillRect(sxIn, 0, sxOut - sxIn, canvasHeight);
  }

  drawMarker(ctx, sxIn, canvasHeight, LOOP_IN_COLOR, 'in');
  drawMarker(ctx, sxOut, canvasHeight, LOOP_OUT_COLOR, 'out');
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  sx: number,
  height: number,
  color: string,
  which: 'in' | 'out',
): void {
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Top-edge triangle, pointing toward the loop range (right for 'in', left for 'out')
  ctx.beginPath();
  if (which === 'in') {
    // Pointing right (the loop range is to the right of this marker)
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + 10, 0);
    ctx.lineTo(sx, 10);
  } else {
    // Pointing left
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx - 10, 0);
    ctx.lineTo(sx, 10);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Screen-X hit-test for the two markers. Returns which marker (if any) is
 * within `hitRadiusPx` of the given screen X inside the ruler band.
 * Used by the interaction layer before falling through to playhead scrub.
 */
export function hitTestLoopMarkers(
  vp: Viewport,
  sx: number,
  loopStartBeats: number,
  loopEndBeats: number,
  hitRadiusPx: number = 8,
): 'start' | 'end' | null {
  const sxIn = vp.worldToScreen(loopStartBeats, 0).sx;
  const sxOut = vp.worldToScreen(loopEndBeats, 0).sx;
  const dIn = Math.abs(sx - sxIn);
  const dOut = Math.abs(sx - sxOut);
  const inHit = dIn <= hitRadiusPx;
  const outHit = dOut <= hitRadiusPx;
  if (inHit && outHit) return dIn <= dOut ? 'start' : 'end';
  if (inHit) return 'start';
  if (outHit) return 'end';
  return null;
}
