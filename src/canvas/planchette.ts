import type { PlanchetteState } from '../types';
import type { Viewport } from './viewport';
import { RULER_HEIGHT } from './interaction';

export const PLANCHETTE_SCREEN_X_RATIO = 0.5;

const PULSE_DURATION_MS = 200;
const PRIMARY_COLOR = '#f44336';
const GHOST_COLOR = 'rgba(244, 67, 54, 0.35)';
const PULSE_COLOR = '#ffeb3b';

/**
 * Render all planchettes (stationary vertical marker + per-voice Y indicator).
 * MVP always has a single 'primary' planchette; Harmonic Prism will add harmony voices.
 */
export function renderPlanchettes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  planchettes: PlanchetteState[],
): void {
  const screenX = canvasWidth * PLANCHETTE_SCREEN_X_RATIO;
  const topY = RULER_HEIGHT;

  // Vertical planchette track line (shared across all voices)
  ctx.beginPath();
  ctx.moveTo(screenX, topY);
  ctx.lineTo(screenX, canvasHeight);
  ctx.strokeStyle = PRIMARY_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Triangle cap at top
  ctx.beginPath();
  ctx.moveTo(screenX - 6, topY);
  ctx.lineTo(screenX + 6, topY);
  ctx.lineTo(screenX, topY + 9);
  ctx.closePath();
  ctx.fillStyle = PRIMARY_COLOR;
  ctx.fill();

  // Per-voice Y indicator
  const now = Date.now();
  for (const p of planchettes) {
    if (p.cursorWorldY == null || p.snappedWorldY == null) continue;

    const rawScreenY = vp.worldToScreen(0, p.cursorWorldY).sy;
    const snappedScreenY = vp.worldToScreen(0, p.snappedWorldY).sy;

    if (snappedScreenY < topY || snappedScreenY > canvasHeight) continue;

    const pulseAge = now - p.lastCrossedAt;
    const pulsing = pulseAge >= 0 && pulseAge < PULSE_DURATION_MS;
    const pulseAlpha = pulsing ? 1 - pulseAge / PULSE_DURATION_MS : 0;

    // Ghost dot at raw (unsnapped) Y — small and translucent
    if (Math.abs(rawScreenY - snappedScreenY) > 2 && rawScreenY >= topY && rawScreenY <= canvasHeight) {
      ctx.beginPath();
      ctx.arc(screenX, rawScreenY, 3, 0, Math.PI * 2);
      ctx.fillStyle = GHOST_COLOR;
      ctx.fill();
    }

    // Solid indicator at snapped Y — this is what sounds & records
    ctx.beginPath();
    ctx.arc(screenX, snappedScreenY, 7, 0, Math.PI * 2);
    ctx.fillStyle = PRIMARY_COLOR;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Snap-line-cross pulse: a wider flash across the staff at the current Y
    if (pulsing) {
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
