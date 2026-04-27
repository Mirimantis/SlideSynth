// Harmonic Prism — Projection Mode renderer.
//
// Given a source BezierCurve + ChordSpec + octave range, render "echo"
// curves projected up/down the canvas at harmonic intervals. Echoes are
// visually dimmed and dashed, sitting behind real curves. They are NOT
// audible — pure visual guides that become snap targets via snap.ts.

import type { BezierCurve } from '../types';
import type { Viewport } from './viewport';
import { getSegmentControlPoints } from '../model/curve';
import { evaluateCurveAtBeat } from '../audio/curve-sampler';
import { chordOffsets, type ChordSpec } from '../utils/harmonics';
import { MIN_NOTE, MAX_NOTE } from '../constants';

const ECHO_STROKE = 'rgba(200, 160, 255, 0.55)';    // lavender, dimmed
const ECHO_LINE_WIDTH = 1.25;
const ECHO_DASH: number[] = [5, 6];

/**
 * Rainbow color stops shared between the Projection source highlight (gradient
 * across the curve) and Draw mode planchettes (one solid stop per voice index).
 * Index 0 = primary/closest harmony; subsequent indices step through the
 * spectrum so siblings are visually distinct.
 */
export const PRISM_RAINBOW_STOPS: readonly string[] = [
  '#ff5555',  // red       — primary / harmony-0
  '#ffaa33',  // orange    — harmony-1
  '#ffee44',  // yellow    — harmony-2
  '#66dd66',  // green     — harmony-3
  '#55ccff',  // cyan      — harmony-4
  '#aa77ff',  // purple    — extra (gradient only; harmony cap is 4)
  '#ff66cc',  // pink      — extra (gradient only)
];

/** Equally-spaced gradient offsets matching PRISM_RAINBOW_STOPS. */
const PRISM_RAINBOW_OFFSETS: readonly number[] = [0.00, 0.16, 0.33, 0.50, 0.66, 0.83, 1.00];

/**
 * Render harmonic echoes of a source curve up and down the canvas.
 * Skips the (octave=0, offset=0) echo since it coincides with the source itself.
 */
export function renderProjection(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  sourceCurve: BezierCurve,
  chordSpec: ChordSpec,
  octaveRange: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (sourceCurve.points.length < 2) return;
  const octaves = Math.max(0, Math.min(3, Math.round(octaveRange)));
  const offsets = chordOffsets(chordSpec);
  if (offsets.length === 0) return;

  // Source Y extent — used for offscreen culling per echo.
  let minSourceY = Infinity;
  let maxSourceY = -Infinity;
  for (const pt of sourceCurve.points) {
    if (pt.position.y < minSourceY) minSourceY = pt.position.y;
    if (pt.position.y > maxSourceY) maxSourceY = pt.position.y;
  }

  ctx.save();
  ctx.strokeStyle = ECHO_STROKE;
  ctx.lineWidth = ECHO_LINE_WIDTH;
  ctx.setLineDash(ECHO_DASH);

  for (let octave = -octaves; octave <= octaves; octave++) {
    for (const offset of offsets) {
      const yShift = octave * 12 + offset;
      if (octave === 0 && offset === 0) continue; // source itself
      // Cull: is this echo anywhere on screen vertically?
      const shiftedMin = minSourceY + yShift;
      const shiftedMax = maxSourceY + yShift;
      if (shiftedMax < MIN_NOTE || shiftedMin > MAX_NOTE) continue;
      const topScreenY = vp.worldToScreen(0, shiftedMax).sy;
      const botScreenY = vp.worldToScreen(0, shiftedMin).sy;
      if (botScreenY < 0 || topScreenY > canvasHeight) continue;

      drawEcho(ctx, vp, sourceCurve, yShift, canvasWidth);
    }
  }

  ctx.restore();
}

function drawEcho(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curve: BezierCurve,
  yShift: number,
  _canvasWidth: number,
): void {
  ctx.beginPath();
  const first = curve.points[0]!;
  const firstScreen = vp.worldToScreen(first.position.x, first.position.y + yShift);
  ctx.moveTo(firstScreen.sx, firstScreen.sy);

  for (let i = 0; i < curve.points.length - 1; i++) {
    const seg = getSegmentControlPoints(curve, i);
    if (!seg) continue;
    const p1 = vp.worldToScreen(seg.p1.x, seg.p1.y + yShift);
    const p2 = vp.worldToScreen(seg.p2.x, seg.p2.y + yShift);
    const p3 = vp.worldToScreen(seg.p3.x, seg.p3.y + yShift);
    ctx.bezierCurveTo(p1.sx, p1.sy, p2.sx, p2.sy, p3.sx, p3.sy);
  }
  ctx.stroke();
}

/**
 * Highlight the projection-source curve with a rainbow gradient stroke so
 * the user can identify which curve is currently driving the echoes.
 * Drawn on top of the normal curve render.
 */
export function renderProjectionSourceHighlight(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curve: BezierCurve,
): void {
  if (curve.points.length < 2) return;

  // Build a linear gradient spanning the curve's screen-space X extent.
  const firstWX = curve.points[0]!.position.x;
  const lastWX = curve.points[curve.points.length - 1]!.position.x;
  const x0 = vp.worldToScreen(firstWX, 0).sx;
  const x1 = vp.worldToScreen(lastWX, 0).sx;
  // If the curve spans no screen width (extreme zoom-out), fall back to a
  // single hue rather than a degenerate gradient.
  const grad = (Math.abs(x1 - x0) < 1)
    ? null
    : ctx.createLinearGradient(x0, 0, x1, 0);
  if (grad) {
    for (let i = 0; i < PRISM_RAINBOW_STOPS.length; i++) {
      grad.addColorStop(PRISM_RAINBOW_OFFSETS[i]!, PRISM_RAINBOW_STOPS[i]!);
    }
  }

  ctx.save();
  ctx.strokeStyle = grad ?? PRISM_RAINBOW_STOPS[PRISM_RAINBOW_STOPS.length - 1]!;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();

  const first = curve.points[0]!;
  const firstScreen = vp.worldToScreen(first.position.x, first.position.y);
  ctx.moveTo(firstScreen.sx, firstScreen.sy);
  for (let i = 0; i < curve.points.length - 1; i++) {
    const seg = getSegmentControlPoints(curve, i);
    if (!seg) continue;
    const p1 = vp.worldToScreen(seg.p1.x, seg.p1.y);
    const p2 = vp.worldToScreen(seg.p2.x, seg.p2.y);
    const p3 = vp.worldToScreen(seg.p3.x, seg.p3.y);
    ctx.bezierCurveTo(p1.sx, p1.sy, p2.sx, p2.sy, p3.sx, p3.sy);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw-mode chord-cluster preview. Renders the primary as a rainbow-filled
 * disc and each harmony as a solid-color disc at `(snappedBaseY + offset[i])`.
 * Visual cue for "where the chord cluster will land if you click".
 *
 * `screenX` is the canvas-space X to anchor all dots at (typically the cursor X).
 * `snappedBaseY` is the world-space Y the primary will sit at after click-time snap.
 */
export function renderPrismDrawPreview(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  screenX: number,
  snappedBaseY: number,
  chordSpec: ChordSpec,
  canvasHeight: number,
  rulerHeight: number,
): void {
  const offsets = chordOffsets(chordSpec);
  if (offsets.length === 0) return;

  const PRIMARY_R = 8;
  const HARMONY_R = 5;

  ctx.save();

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]!;
    const y = snappedBaseY + offset;
    if (y < MIN_NOTE || y > MAX_NOTE) continue;

    const screenY = vp.worldToScreen(0, y).sy;
    if (screenY < rulerHeight - PRIMARY_R || screenY > canvasHeight + PRIMARY_R) continue;

    if (i === 0) {
      // Primary: rainbow-filled disc with white outline.
      const grad = ctx.createLinearGradient(screenX, screenY - PRIMARY_R, screenX, screenY + PRIMARY_R);
      for (let s = 0; s < PRISM_RAINBOW_STOPS.length; s++) {
        grad.addColorStop(PRISM_RAINBOW_OFFSETS[s]!, PRISM_RAINBOW_STOPS[s]!);
      }
      ctx.beginPath();
      ctx.arc(screenX, screenY, PRIMARY_R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Harmony i (i = 1..N-1): solid color from rainbow stops, indexed at i-1
      // so harmony-0 = red, harmony-1 = orange, etc.
      const colorIdx = (i - 1) % PRISM_RAINBOW_STOPS.length;
      ctx.beginPath();
      ctx.arc(screenX, screenY, HARMONY_R, 0, Math.PI * 2);
      ctx.fillStyle = PRISM_RAINBOW_STOPS[colorIdx]!;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Return the MIDI-note Y values for every echo curve at a given X (beats).
 * Used by snap.ts to treat projection echoes as snap targets.
 * Returns an empty array if the X falls outside the source curve's range.
 */
export function computeProjectionTargetsAtX(
  sourceCurve: BezierCurve,
  chordSpec: ChordSpec,
  octaveRange: number,
  atBeat: number,
): number[] {
  const hit = evaluateCurveAtBeat(sourceCurve, atBeat);
  if (!hit) return [];

  const octaves = Math.max(0, Math.min(3, Math.round(octaveRange)));
  const offsets = chordOffsets(chordSpec);
  const targets: number[] = [];
  for (let octave = -octaves; octave <= octaves; octave++) {
    for (const offset of offsets) {
      const y = hit.noteNumber + offset + octave * 12;
      if (y >= MIN_NOTE && y <= MAX_NOTE) targets.push(y);
    }
  }
  return targets;
}
