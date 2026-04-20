import type { PlanchetteState } from '../types';
import type { Viewport } from './viewport';
import { RULER_HEIGHT } from './interaction';

// Terminology:
//   Rail       — the stationary vertical line in the middle of the canvas while
//                Scroll-Canvas Playback is active. Visual frame-of-reference.
//   Planchette — the movable indicator showing the pitch currently being Performed
//                (sounded by LMB, or previewed via keyboard modifier in Idle).
// MVP renders one rail and one primary planchette on it. Harmonic Prism will add
// additional planchettes (chord/harmony voices) to the same rail.

export const RAIL_SCREEN_X_RATIO = 0.5;
/** @deprecated use RAIL_SCREEN_X_RATIO. Retained as an alias for callers in flight. */
export const PLANCHETTE_SCREEN_X_RATIO = RAIL_SCREEN_X_RATIO;

const PULSE_DURATION_MS = 200;
const LOOP_WRAP_FLASH_MS = 250;
const PRIMARY_COLOR = '#f44336';
const GHOST_COLOR = 'rgba(244, 67, 54, 0.35)';
const PULSE_COLOR = '#ffeb3b';
const LOOP_FLASH_COLOR = '#ffffff';
const CIRCLE_RADIUS = 9;

/**
 * Draw the planchette visual: a hollow circle with a small crosshair inside
 * and a triangle on each side pointing inward at the circle's horizontal axis.
 * Same glyph is used for rail-bound and free-moving planchettes.
 */
export function renderPlanchetteGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string = PRIMARY_COLOR,
): void {
  const r = CIRCLE_RADIUS;
  ctx.save();

  // Hollow circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Crosshair inside the circle (four short segments leaving a tiny gap at centre)
  const innerGap = 2.5;
  const innerReach = r - 2;
  ctx.beginPath();
  ctx.moveTo(cx - innerReach, cy); ctx.lineTo(cx - innerGap, cy);
  ctx.moveTo(cx + innerGap, cy);   ctx.lineTo(cx + innerReach, cy);
  ctx.moveTo(cx, cy - innerReach); ctx.lineTo(cx, cy - innerGap);
  ctx.moveTo(cx, cy + innerGap);   ctx.lineTo(cx, cy + innerReach);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Triangles on each side, pointing at the circle's Y level.
  const triSize = 7;
  const triGap = 3;
  ctx.fillStyle = color;
  // Left triangle: tip points right (at the circle), base on the outer left.
  ctx.beginPath();
  ctx.moveTo(cx - r - triGap, cy);
  ctx.lineTo(cx - r - triGap - triSize, cy - triSize * 0.65);
  ctx.lineTo(cx - r - triGap - triSize, cy + triSize * 0.65);
  ctx.closePath();
  ctx.fill();
  // Right triangle: tip points left (at the circle), base on the outer right.
  ctx.beginPath();
  ctx.moveTo(cx + r + triGap, cy);
  ctx.lineTo(cx + r + triGap + triSize, cy - triSize * 0.65);
  ctx.lineTo(cx + r + triGap + triSize, cy + triSize * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Draw the vertical rail + top triangle cap. */
export function renderRail(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  lastLoopWrapAt: number = 0,
): void {
  const railX = canvasWidth * RAIL_SCREEN_X_RATIO;
  const topY = RULER_HEIGHT;
  const loopWrapAge = performance.now() - lastLoopWrapAt;
  const loopFlashing = lastLoopWrapAt > 0 && loopWrapAge < LOOP_WRAP_FLASH_MS;
  const loopFlashAlpha = loopFlashing ? 1 - loopWrapAge / LOOP_WRAP_FLASH_MS : 0;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(railX, topY);
  ctx.lineTo(railX, canvasHeight);
  ctx.strokeStyle = loopFlashing ? LOOP_FLASH_COLOR : PRIMARY_COLOR;
  ctx.lineWidth = loopFlashing ? 4 : 2;
  if (loopFlashing) ctx.globalAlpha = Math.max(0.3, loopFlashAlpha);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Triangle cap at the top (ruler band).
  ctx.beginPath();
  ctx.moveTo(railX - 6, topY);
  ctx.lineTo(railX + 6, topY);
  ctx.lineTo(railX, topY + 9);
  ctx.closePath();
  ctx.fillStyle = PRIMARY_COLOR;
  ctx.fill();
  ctx.restore();
}

/**
 * Render the rail + any planchettes riding it at their snapped Y values.
 * Used in Glissandograph rendering (rail is always present) and in Compose
 * when Scroll-Canvas Playback is active.
 */
export function renderPlanchettes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  planchettes: PlanchetteState[],
  lastLoopWrapAt: number = 0,
): void {
  renderRail(ctx, canvasWidth, canvasHeight, lastLoopWrapAt);
  const railX = canvasWidth * RAIL_SCREEN_X_RATIO;
  const topY = RULER_HEIGHT;
  const now = Date.now();
  for (const p of planchettes) {
    if (p.snappedWorldY == null) continue;
    const snappedScreenY = vp.worldToScreen(0, p.snappedWorldY).sy;
    if (snappedScreenY < topY || snappedScreenY > canvasHeight) continue;

    // Ghost dot at raw (unsnapped) Y — small translucent, shows pre-snap pointer position.
    if (p.cursorWorldY != null) {
      const rawScreenY = vp.worldToScreen(0, p.cursorWorldY).sy;
      if (Math.abs(rawScreenY - snappedScreenY) > 2 && rawScreenY >= topY && rawScreenY <= canvasHeight) {
        ctx.beginPath();
        ctx.arc(railX, rawScreenY, 3, 0, Math.PI * 2);
        ctx.fillStyle = GHOST_COLOR;
        ctx.fill();
      }
    }

    renderPlanchetteGlyph(ctx, railX, snappedScreenY, PRIMARY_COLOR);

    // Snap-line-cross pulse — brief horizontal flash at the planchette's Y.
    const pulseAge = now - p.lastCrossedAt;
    if (pulseAge >= 0 && pulseAge < PULSE_DURATION_MS) {
      const pulseAlpha = 1 - pulseAge / PULSE_DURATION_MS;
      ctx.save();
      ctx.globalAlpha = pulseAlpha;
      ctx.beginPath();
      ctx.moveTo(0, snappedScreenY);
      ctx.lineTo(canvasWidth, snappedScreenY);
      ctx.strokeStyle = PULSE_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Render a free-floating planchette at an arbitrary screen X (cursor-anchored).
 * Used in Compose when the user is previewing a pitch via keyboard-modifier
 * (Idle + Space) — the planchette is NOT on a rail, it's at the cursor.
 */
export function renderFreePlanchette(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  screenX: number,
  snappedWorldY: number,
  cursorWorldY: number | null,
  canvasHeight: number,
): void {
  const topY = RULER_HEIGHT;
  const snappedScreenY = vp.worldToScreen(0, snappedWorldY).sy;
  if (snappedScreenY < topY || snappedScreenY > canvasHeight) return;
  // Ghost dot for raw cursor (same semantics as rail planchette).
  if (cursorWorldY != null) {
    const rawScreenY = vp.worldToScreen(0, cursorWorldY).sy;
    if (Math.abs(rawScreenY - snappedScreenY) > 2 && rawScreenY >= topY && rawScreenY <= canvasHeight) {
      ctx.beginPath();
      ctx.arc(screenX, rawScreenY, 3, 0, Math.PI * 2);
      ctx.fillStyle = GHOST_COLOR;
      ctx.fill();
    }
  }
  renderPlanchetteGlyph(ctx, screenX, snappedScreenY, PRIMARY_COLOR);
}
