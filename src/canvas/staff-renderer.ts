import type { Viewport } from './viewport';
import {
  MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_SEMITONE, centsToNoteName, isCCents,
  DEFAULT_BEATS_PER_MEASURE, SUBDIVISIONS_PER_BEAT,
} from '../constants';
import type { StaffGrid, StaffLine } from '../tuning/tuning';
import { getAdaptiveBeatStep } from '../utils/snap';
import { themeColor } from '../theme/theme';

/** Lines outside the scale fade out as neighbouring notes close from 4 px to
 *  1.5 px apart, so a 72-note tuning zoomed out isn't a solid block. */
const FADE_FROM_PX = 4;
const FADE_TO_PX = 1.5;
/** Labels closer than this to a label already drawn are skipped. */
const LABEL_GAP_PX = 9;
/** A 12-EDO reference line this close to a note of the tuning isn't drawn. */
const REFERENCE_CLEAR_PX = 3;

/**
 * Render the background staff grid onto a canvas.
 * Draws horizontal note lines and vertical beat/subdivision lines.
 *
 * The pitch lines are the tuning's notes (13.8 (b)): the root's lines are the
 * bold octave markers, main lines are the natural letters (or every note of a
 * tuning named by number or ratio), and with a scale its notes are highlighted
 * and the rest dimmed. `reference` adds a faint 12-EDO layer under a tuning
 * other than 12-EDO. A null grid (pitch lines hidden) draws none.
 */
export function renderStaff(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  height: number,
  measureLen: number = DEFAULT_BEATS_PER_MEASURE,
  grid: StaffGrid | null = null,
  reference: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  // Find visible world range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, height);

  const minBeat = Math.floor(topLeft.wx);
  const maxBeat = Math.ceil(bottomRight.wx);

  // ── Horizontal pitch lines ─────────────────────────────────
  if (grid) {
    const visible = grid.lines.filter(l => l.cents >= bottomRight.wy - CENTS_PER_SEMITONE && l.cents <= topLeft.wy + CENTS_PER_SEMITONE);
    if (reference && !grid.twelveEdo) renderReference(ctx, vp, width, visible, Math.max(bottomRight.wy, MIN_PITCH_CENTS), Math.min(topLeft.wy, MAX_PITCH_CENTS));
    renderPitchLines(ctx, vp, width, grid, visible);
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
          ctx.strokeStyle = themeColor('staff-subdiv-eighth');
          ctx.lineWidth = 0.8;
        } else if (isQuarter) {
          ctx.strokeStyle = themeColor('staff-subdiv-quarter');
          ctx.lineWidth = 0.5;
        } else {
          ctx.strokeStyle = themeColor('staff-subdiv-fine');
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
      ctx.strokeStyle = themeColor('staff-measure');
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = themeColor('staff-beat');
      ctx.lineWidth = 0.8;
    }

    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();

    // Beat number label at the bottom
    if (isMeasureStart || vp.state.zoomX >= 50) {
      ctx.fillStyle = isMeasureStart ? themeColor('staff-measure-label') : themeColor('staff-beat-label');
      ctx.font = isMeasureStart ? 'bold 11px monospace' : '10px monospace';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(b + 1), sx + 3, height - 4);
    }
  }
}

/** The tuning's notes: lines, then labels. */
function renderPitchLines(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  grid: StaffGrid,
  visible: readonly StaffLine[],
): void {
  const zoom = vp.state.zoomY;
  const stepPx = grid.minStep * zoom;
  const fade = Math.max(0, Math.min(1, (stepPx - FADE_TO_PX) / (FADE_FROM_PX - FADE_TO_PX)));
  const highlighted = (l: StaffLine) => grid.hasScale && l.inScale;

  for (const l of visible) {
    const alpha = l.isRoot || highlighted(l) ? 1 : fade;
    if (alpha <= 0) continue;
    if (grid.hasScale) {
      if (l.inScale) {
        ctx.strokeStyle = themeColor(l.isRoot ? 'staff-key-c' : l.natural ? 'staff-key-natural' : 'staff-key-accidental');
        ctx.lineWidth = l.isRoot ? 2.0 : 1.0;
      } else {
        ctx.strokeStyle = themeColor('staff-key-out');
        ctx.lineWidth = 0.3;
      }
    } else {
      ctx.strokeStyle = themeColor(l.isRoot ? 'staff-line-c' : l.natural ? 'staff-line-natural' : 'staff-line-accidental');
      ctx.lineWidth = l.isRoot ? 1.5 : l.natural ? 0.8 : 0.5;
    }
    const { sy } = vp.worldToScreen(0, l.cents);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Labels on the left edge. The root's always; main lines (naturals, the
  // scale's notes) once a twelfth of the period is 10 px tall; every line once
  // the smallest step is 18 px. Earlier ones win where labels would collide.
  const mainLabels = (grid.period / 12) * zoom >= 10;
  const allLabels = stepPx >= 18;
  const tiers = [
    visible.filter(l => l.isRoot),
    mainLabels ? visible.filter(l => !l.isRoot && (l.natural || highlighted(l))) : [],
    allLabels ? visible.filter(l => !l.isRoot && !l.natural && !highlighted(l)) : [],
  ];
  const placed: number[] = [];
  ctx.textBaseline = 'middle';
  for (const tier of tiers) {
    for (const l of tier) {
      const { sy } = vp.worldToScreen(0, l.cents);
      if (placed.some(y => Math.abs(y - sy) < LABEL_GAP_PX)) continue;
      placed.push(sy);
      if (grid.hasScale) {
        ctx.fillStyle = themeColor(!l.inScale ? 'staff-key-label-out' : l.isRoot ? 'staff-key-label-c' : 'staff-key-label');
      } else {
        ctx.fillStyle = themeColor(l.isRoot ? 'staff-label-c' : 'staff-label');
      }
      ctx.font = l.isRoot ? 'bold 11px monospace' : '10px monospace';
      ctx.fillText(l.label, 4, sy);
    }
  }
}

/** The faint 12-EDO layer under another tuning: a dashed line on each
 *  standard note that no note of the tuning sits on, and C's name at the right
 *  edge. */
function renderReference(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  visible: readonly StaffLine[],
  lo: number,
  hi: number,
): void {
  const clear = REFERENCE_CLEAR_PX / vp.state.zoomY;
  ctx.save();
  ctx.strokeStyle = themeColor('staff-ref-line');
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.fillStyle = themeColor('staff-ref-label');
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let c = Math.ceil(lo / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE; c <= hi; c += CENTS_PER_SEMITONE) {
    const { sy } = vp.worldToScreen(0, c);
    if (!visible.some(l => Math.abs(l.cents - c) < clear)) {
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }
    if (isCCents(c)) ctx.fillText(centsToNoteName(c), width - 4, sy);
  }
  ctx.restore();
}
