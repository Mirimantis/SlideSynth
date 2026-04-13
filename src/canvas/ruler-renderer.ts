import type { Viewport } from './viewport';
import { RULER_HEIGHT } from './interaction';

/**
 * Render the ruler bar at the top of the canvas with beat/subdivision ticks.
 * Tick hierarchy adapts to zoom level, matching the adaptive snap granularity.
 */
export function renderRuler(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  totalBeats: number,
  beatsPerMeasure: number,
): void {
  const h = RULER_HEIGHT;

  // Dark background
  ctx.fillStyle = '#111122';
  ctx.fillRect(0, 0, width, h);

  // Bottom border
  ctx.strokeStyle = '#446';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(width, h - 0.5);
  ctx.stroke();

  // Visible beat range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, 0);
  const minBeat = Math.max(0, Math.floor(topLeft.wx));
  const maxBeat = Math.min(totalBeats, Math.ceil(bottomRight.wx));

  const zx = vp.state.zoomX;

  // Determine which subdivision level to show based on zoom
  // These thresholds match staff-renderer and getAdaptiveSubdivisions
  const showSixteenths = zx >= 60;
  const showEighths = zx >= 35;

  for (let b = minBeat; b <= maxBeat; b++) {
    const { sx } = vp.worldToScreen(b, 0);
    if (sx < 0 || sx > width) continue;

    const isMeasure = b % beatsPerMeasure === 0;

    // Draw subdivision ticks within this beat
    if (showEighths || showSixteenths) {
      const subdiv = showSixteenths ? 16 : showEighths ? 2 : 1;
      for (let s = 1; s < subdiv; s++) {
        const subBeat = b + s / subdiv;
        const { sx: subSx } = vp.worldToScreen(subBeat, 0);
        if (subSx < 0 || subSx > width) continue;

        const isEighthTick = subdiv === 16 && s % 8 === 0;
        const isQuarterTick = subdiv === 16 && s % 4 === 0;

        let tickH: number;
        let color: string;
        if (isEighthTick) {
          tickH = 7;
          color = '#556';
        } else if (isQuarterTick) {
          tickH = 5;
          color = '#445';
        } else {
          tickH = 3;
          color = '#334';
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(subSx, h);
        ctx.lineTo(subSx, h - tickH);
        ctx.stroke();
      }
    }

    // Beat / measure tick
    let tickH: number;
    if (isMeasure) {
      tickH = h - 2; // full-height tick
      ctx.strokeStyle = '#778';
      ctx.lineWidth = 1.5;
    } else {
      tickH = 10;
      ctx.strokeStyle = '#556';
      ctx.lineWidth = 0.8;
    }

    ctx.beginPath();
    ctx.moveTo(sx, h);
    ctx.lineTo(sx, h - tickH);
    ctx.stroke();

    // Labels — measure numbers always, beat numbers when zoomed in
    if (isMeasure) {
      const measureNum = b / beatsPerMeasure + 1;
      ctx.fillStyle = '#aabbcc';
      ctx.font = 'bold 10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(String(measureNum), sx + 3, 2);
    } else if (zx >= 50) {
      const beatInMeasure = (b % beatsPerMeasure) + 1;
      ctx.fillStyle = '#667';
      ctx.font = '9px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(String(beatInMeasure), sx + 2, 4);
    }
  }
}
