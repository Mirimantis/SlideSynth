import type { PlanchetteState } from '../types';
import type { Viewport } from './viewport';
import { RULER_HEIGHT } from './interaction';

// Terminology:
//   Rail       — the stationary vertical line in the middle of the gliss canvas.
//   Planchette — the movable indicator that rides the rail, following mouse Y.
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

/**
 * Render the planchette rail (vertical line + triangle cap) plus every planchette
 * riding it. MVP always has a single 'primary' planchette; Harmonic Prism will add
 * harmony voices as additional planchettes on the same rail.
 */
export function renderPlanchettes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  planchettes: PlanchetteState[],
  lastLoopWrapAt: number = 0,
): void {
  const railX = canvasWidth * RAIL_SCREEN_X_RATIO;
  const topY = RULER_HEIGHT;

  // Loop-wrap flash briefly overlays the rail in white as the playback wraps.
  const loopWrapAge = performance.now() - lastLoopWrapAt;
  const loopFlashing = lastLoopWrapAt > 0 && loopWrapAge < LOOP_WRAP_FLASH_MS;
  const loopFlashAlpha = loopFlashing ? 1 - loopWrapAge / LOOP_WRAP_FLASH_MS : 0;

  // Rail: one vertical line shared by all planchettes.
  ctx.beginPath();
  ctx.moveTo(railX, topY);
  ctx.lineTo(railX, canvasHeight);
  ctx.strokeStyle = loopFlashing ? LOOP_FLASH_COLOR : PRIMARY_COLOR;
  ctx.lineWidth = loopFlashing ? 4 : 2;
  if (loopFlashing) ctx.globalAlpha = Math.max(0.3, loopFlashAlpha);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Rail's triangle cap at top (marks the rail's position in the ruler band).
  ctx.beginPath();
  ctx.moveTo(railX - 6, topY);
  ctx.lineTo(railX + 6, topY);
  ctx.lineTo(railX, topY + 9);
  ctx.closePath();
  ctx.fillStyle = PRIMARY_COLOR;
  ctx.fill();

  // Planchettes — the dots riding the rail at each voice's current Y.
  const now = Date.now();
  for (const p of planchettes) {
    if (p.cursorWorldY == null || p.snappedWorldY == null) continue;

    const rawScreenY = vp.worldToScreen(0, p.cursorWorldY).sy;
    const snappedScreenY = vp.worldToScreen(0, p.snappedWorldY).sy;

    if (snappedScreenY < topY || snappedScreenY > canvasHeight) continue;

    const pulseAge = now - p.lastCrossedAt;
    const pulsing = pulseAge >= 0 && pulseAge < PULSE_DURATION_MS;
    const pulseAlpha = pulsing ? 1 - pulseAge / PULSE_DURATION_MS : 0;

    // Ghost dot at raw (unsnapped) Y — small and translucent, shows pre-snap cursor.
    if (Math.abs(rawScreenY - snappedScreenY) > 2 && rawScreenY >= topY && rawScreenY <= canvasHeight) {
      ctx.beginPath();
      ctx.arc(railX, rawScreenY, 3, 0, Math.PI * 2);
      ctx.fillStyle = GHOST_COLOR;
      ctx.fill();
    }

    // Planchette proper — solid dot at the snapped Y (this is what sounds & records).
    ctx.beginPath();
    ctx.arc(railX, snappedScreenY, 7, 0, Math.PI * 2);
    ctx.fillStyle = PRIMARY_COLOR;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Snap-line-cross pulse — brief horizontal flash at the planchette's Y.
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
