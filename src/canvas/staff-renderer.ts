import type { Viewport } from './viewport';
import {
  MIN_NOTE, MAX_NOTE,
  noteNumberToName, isCNote, isNaturalNote,
  DEFAULT_BEATS_PER_MEASURE, SUBDIVISIONS_PER_BEAT,
} from '../constants';

/**
 * Render the background staff grid onto a canvas.
 * Draws horizontal note lines and vertical beat/subdivision lines.
 */
export function renderStaff(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  height: number,
  totalBeats: number,
  beatsPerMeasure: number = DEFAULT_BEATS_PER_MEASURE,
): void {
  ctx.clearRect(0, 0, width, height);

  // Find visible world range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, height);

  const minBeat = Math.floor(topLeft.wx);
  const maxBeat = Math.ceil(bottomRight.wx);
  const minNote = Math.floor(bottomRight.wy);
  const maxNote = Math.ceil(topLeft.wy);

  // ── Horizontal note lines ──────────────────────────────────
  for (let n = Math.max(minNote, MIN_NOTE); n <= Math.min(maxNote, MAX_NOTE); n++) {
    const { sy } = vp.worldToScreen(0, n);

    if (isCNote(n)) {
      // C notes: bold line + label
      ctx.strokeStyle = '#445';
      ctx.lineWidth = 1.5;
    } else if (isNaturalNote(n)) {
      ctx.strokeStyle = '#334';
      ctx.lineWidth = 0.8;
    } else {
      // Sharps/flats: dimmer
      ctx.strokeStyle = '#262636';
      ctx.lineWidth = 0.5;
    }

    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();

    // Note labels on the left edge
    if (isCNote(n) || (vp.state.zoomY >= 10 && isNaturalNote(n)) || vp.state.zoomY >= 18) {
      ctx.fillStyle = isCNote(n) ? '#8899aa' : '#556';
      ctx.font = isCNote(n) ? 'bold 11px monospace' : '10px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteNumberToName(n), 4, sy);
    }
  }

  // ── Vertical beat/subdivision lines ────────────────────────

  // Determine subdivision visibility based on zoom
  const showSixteenths = vp.state.zoomX >= 60;
  const showEighths = vp.state.zoomX >= 35;

  const startBeat = Math.max(0, minBeat);
  const endBeat = Math.min(totalBeats, maxBeat);

  for (let b = startBeat; b <= endBeat; b++) {
    // Draw subdivisions within this beat
    if (showEighths || showSixteenths) {
      const subdiv = showSixteenths ? SUBDIVISIONS_PER_BEAT : 2;
      for (let s = 1; s < subdiv; s++) {
        const subBeat = b + s / subdiv;
        const { sx } = vp.worldToScreen(subBeat, 0);
        if (sx < 0 || sx > width) continue;

        const isEighth = subdiv === SUBDIVISIONS_PER_BEAT && s % (SUBDIVISIONS_PER_BEAT / 2) === 0;
        const isQuarter = subdiv === SUBDIVISIONS_PER_BEAT && s % (SUBDIVISIONS_PER_BEAT / 4) === 0;

        if (isEighth) {
          ctx.strokeStyle = '#2a2a3a';
          ctx.lineWidth = 0.8;
        } else if (isQuarter) {
          ctx.strokeStyle = '#222233';
          ctx.lineWidth = 0.5;
        } else {
          ctx.strokeStyle = '#1e1e2a';
          ctx.lineWidth = 0.3;
        }

        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
    }

    // Beat line
    const { sx } = vp.worldToScreen(b, 0);
    if (sx < 0 || sx > width) continue;

    const isMeasureStart = b % beatsPerMeasure === 0;

    if (isMeasureStart) {
      ctx.strokeStyle = '#556';
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = '#334';
      ctx.lineWidth = 0.8;
    }

    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();

    // Beat number label at the bottom
    if (isMeasureStart || vp.state.zoomX >= 50) {
      ctx.fillStyle = isMeasureStart ? '#8899aa' : '#445';
      ctx.font = isMeasureStart ? 'bold 11px monospace' : '10px monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(b + 1), sx + 3, height - 4);
    }
  }
}
