import type { Viewport } from './viewport';
import {
  MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_SEMITONE,
  centsToNoteName, isCCents, isNaturalCents,
  DEFAULT_BEATS_PER_MEASURE, SUBDIVISIONS_PER_BEAT,
} from '../constants';
import type { ScaleDefinition } from '../utils/scales';
import { isNoteInScale, isMicrotonal, getScaleNotes } from '../utils/scales';
import { getAdaptiveBeatStep } from '../utils/snap';

/**
 * Render the background staff grid onto a canvas.
 * Draws horizontal note lines and vertical beat/subdivision lines.
 * When a scale is active, in-scale notes are highlighted and out-of-scale notes are dimmed.
 */
export function renderStaff(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  height: number,
  measureLen: number = DEFAULT_BEATS_PER_MEASURE,
  scaleRoot: number | null = null,
  scale: ScaleDefinition | null = null,
  hidePitchLines: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  // Find visible world range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, height);

  const minBeat = Math.floor(topLeft.wx);
  const maxBeat = Math.ceil(bottomRight.wx);
  // Visible pitch range snapped outward to 12-TET lines (100-cent grid).
  const minNote = Math.floor(bottomRight.wy / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
  const maxNote = Math.ceil(topLeft.wy / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;

  const hasScale = scaleRoot !== null && scale !== null;
  const microtonalScale = hasScale && isMicrotonal(scale!);
  // For microtonal scales, don't dim/highlight integer lines — keep default styling
  const highlightIntegers = hasScale && !microtonalScale;
  // 8.19 "None" Key mode: skip default chromatic pitch lines + labels entirely.
  // Microtonal scale guides only fire under hasScale, so they're naturally excluded.
  const drawPitchLines = !hidePitchLines || hasScale;

  // ── Horizontal note lines ──────────────────────────────────
  if (drawPitchLines) {
    for (let n = Math.max(minNote, MIN_PITCH_CENTS); n <= Math.min(maxNote, MAX_PITCH_CENTS); n += CENTS_PER_SEMITONE) {
      const { sy } = vp.worldToScreen(0, n);

      if (highlightIntegers) {
        const inScale = isNoteInScale(n, scaleRoot!, scale!);
        if (inScale) {
          if (isCCents(n)) {
            ctx.strokeStyle = '#5577aa';
            ctx.lineWidth = 2.0;
          } else if (isNaturalCents(n)) {
            ctx.strokeStyle = '#445566';
            ctx.lineWidth = 1.0;
          } else {
            ctx.strokeStyle = '#4a6080';
            ctx.lineWidth = 1.0;
          }
        } else {
          ctx.strokeStyle = '#1a1a28';
          ctx.lineWidth = 0.3;
        }
      } else {
        if (isCCents(n)) {
          ctx.strokeStyle = '#445';
          ctx.lineWidth = 1.5;
        } else if (isNaturalCents(n)) {
          ctx.strokeStyle = '#334';
          ctx.lineWidth = 0.8;
        } else {
          ctx.strokeStyle = '#262636';
          ctx.lineWidth = 0.5;
        }
      }

      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();

      // Note labels on the left edge
      // When a scale is active, show labels for all in-scale notes at moderate zoom
      const inScaleForLabel = highlightIntegers && isNoteInScale(n, scaleRoot!, scale!);
      const showLabel = isCCents(n)
        || (vp.state.zoomY >= 0.10 && (isNaturalCents(n) || inScaleForLabel))
        || vp.state.zoomY >= 0.18;
      if (showLabel) {
        if (highlightIntegers) {
          if (inScaleForLabel) {
            ctx.fillStyle = isCCents(n) ? '#99bbdd' : '#667788';
          } else {
            ctx.fillStyle = '#333';
          }
        } else {
          ctx.fillStyle = isCCents(n) ? '#8899aa' : '#556';
        }
        ctx.font = isCCents(n) ? 'bold 11px monospace' : '10px monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(centsToNoteName(n), 4, sy);
      }
    }
  }

  // ── Scale guide lines (microtonal scales) ──────────────────
  // For microtonal scales, draw ALL scale degrees as guide lines
  // (dashed for fractional positions, solid for integer positions)
  if (microtonalScale) {
    const scaleNotes = getScaleNotes(scaleRoot!, scale!);
    for (const n of scaleNotes) {
      if (n < minNote || n > maxNote) continue;
      const { sy } = vp.worldToScreen(0, n);
      // "Fractional" = off the 12-TET 100-cent grid (microtonal degree).
      const centsOff = Math.round(n - Math.floor(n / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE);
      const isFractional = centsOff !== 0;

      ctx.strokeStyle = '#4a6a8a';
      ctx.lineWidth = 1.0;
      if (isFractional) {
        ctx.setLineDash([4, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
      if (isFractional) {
        ctx.setLineDash([]);
      }

      // Guide line label: nearest lower 12-TET line + cents remainder
      if (vp.state.zoomY >= 0.14) {
        const baseCents = Math.floor(n / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
        ctx.fillStyle = '#6688aa';
        ctx.font = '9px monospace';
        ctx.textBaseline = 'middle';
        const label = centsOff > 0
          ? `${centsToNoteName(baseCents)}+${centsOff}c`
          : centsToNoteName(baseCents);
        ctx.fillText(label, 4, sy);
      }
    }
  }

  // ── Vertical beat/subdivision lines ────────────────────────

  // Determine subdivision visibility based on zoom
  const showSixteenths = vp.state.zoomX >= 60;
  const showEighths = vp.state.zoomX >= 35;

  // Coarsen the main vertical-line step when zoomed way out: beats →
  // measures → every-2nd measure → every-4th, etc. Keeps the canvas from
  // drawing thousands of sub-pixel lines at low zoom.
  const beatStep = getAdaptiveBeatStep(vp.state.zoomX, measureLen);
  const startBeat = Math.max(0, Math.floor(minBeat / beatStep) * beatStep);
  const endBeat = maxBeat;

  for (let b = startBeat; b <= endBeat; b += beatStep) {
    // Draw subdivisions within this beat (only when rendering every beat)
    if (beatStep === 1 && (showEighths || showSixteenths)) {
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

    const isMeasureStart = measureLen > 0 && b % measureLen === 0;

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
