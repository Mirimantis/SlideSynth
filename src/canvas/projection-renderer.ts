// Harmonic Prism — Projection Mode renderer.
//
// Given a source BezierCurve + ChordSpec + octave range, render "echo"
// curves projected up/down the canvas at harmonic intervals. Echoes are
// visually dimmed and dashed, sitting behind real curves. They are NOT
// audible — pure visual guides that become snap targets via snap.ts.

import type { BezierCurve } from '../types';
import type { Viewport } from './viewport';
import { getSegmentControlPoints, pitchPoints } from '../model/curve';
import { evaluateCurveAtBeat } from '../audio/curve-sampler';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_OCTAVE } from '../constants';
import { prismSpectrum, themeColor } from '../theme/theme';

const ECHO_LINE_WIDTH = 1.25;
const ECHO_DASH: number[] = [5, 6];

/** Equally-spaced gradient offsets for the Prism spectrum (theme --spectrum-1..7). */
const PRISM_RAINBOW_OFFSETS: readonly number[] = [0.00, 0.16, 0.33, 0.50, 0.66, 0.83, 1.00];

/**
 * Render harmonic echoes of a source curve up and down the canvas.
 * Skips the (octave=0, offset=0) echo since it coincides with the source itself.
 */
export function renderProjection(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  sourceCurve: BezierCurve,
  offsets: readonly number[],
  octaveRange: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (pitchPoints(sourceCurve).length < 2) return;
  const octaves = Math.max(0, Math.min(3, Math.round(octaveRange)));
  if (offsets.length === 0) return;

  // Source Y extent — used for offscreen culling per echo.
  let minSourceY = Infinity;
  let maxSourceY = -Infinity;
  for (const pt of pitchPoints(sourceCurve)) {
    if (pt.position.y < minSourceY) minSourceY = pt.position.y;
    if (pt.position.y > maxSourceY) maxSourceY = pt.position.y;
  }

  ctx.save();
  ctx.strokeStyle = themeColor('echo-stroke');
  ctx.lineWidth = ECHO_LINE_WIDTH;
  ctx.setLineDash(ECHO_DASH);

  for (let octave = -octaves; octave <= octaves; octave++) {
    for (const offset of offsets) {
      const yShift = octave * CENTS_PER_OCTAVE + offset;
      if (octave === 0 && offset === 0) continue; // source itself
      // Cull: is this echo anywhere on screen vertically?
      const shiftedMin = minSourceY + yShift;
      const shiftedMax = maxSourceY + yShift;
      if (shiftedMax < MIN_PITCH_CENTS || shiftedMin > MAX_PITCH_CENTS) continue;
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
  const first = pitchPoints(curve)[0]!;
  const firstScreen = vp.worldToScreen(first.position.x, first.position.y + yShift);
  ctx.moveTo(firstScreen.sx, firstScreen.sy);

  for (let i = 0; i < pitchPoints(curve).length - 1; i++) {
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
  if (pitchPoints(curve).length < 2) return;

  // Build a linear gradient spanning the curve's screen-space X extent.
  const firstWX = pitchPoints(curve)[0]!.position.x;
  const lastWX = pitchPoints(curve)[pitchPoints(curve).length - 1]!.position.x;
  const x0 = vp.worldToScreen(firstWX, 0).sx;
  const x1 = vp.worldToScreen(lastWX, 0).sx;
  // If the curve spans no screen width (extreme zoom-out), fall back to a
  // single hue rather than a degenerate gradient.
  const grad = (Math.abs(x1 - x0) < 1)
    ? null
    : ctx.createLinearGradient(x0, 0, x1, 0);
  if (grad) {
    for (let i = 0; i < prismSpectrum().length; i++) {
      grad.addColorStop(PRISM_RAINBOW_OFFSETS[i]!, prismSpectrum()[i]!);
    }
  }

  ctx.save();
  ctx.strokeStyle = grad ?? prismSpectrum()[prismSpectrum().length - 1]!;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();

  const first = pitchPoints(curve)[0]!;
  const firstScreen = vp.worldToScreen(first.position.x, first.position.y);
  ctx.moveTo(firstScreen.sx, firstScreen.sy);
  for (let i = 0; i < pitchPoints(curve).length - 1; i++) {
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
  offsets: readonly number[],
  canvasHeight: number,
  rulerHeight: number,
): void {
  if (offsets.length === 0) return;

  const PRIMARY_R = 8;
  const HARMONY_R = 5;

  ctx.save();

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]!;
    const y = snappedBaseY + offset;
    if (y < MIN_PITCH_CENTS || y > MAX_PITCH_CENTS) continue;

    const screenY = vp.worldToScreen(0, y).sy;
    if (screenY < rulerHeight - PRIMARY_R || screenY > canvasHeight + PRIMARY_R) continue;

    if (i === 0) {
      // Primary: rainbow-filled disc with white outline.
      const grad = ctx.createLinearGradient(screenX, screenY - PRIMARY_R, screenX, screenY + PRIMARY_R);
      for (let s = 0; s < prismSpectrum().length; s++) {
        grad.addColorStop(PRISM_RAINBOW_OFFSETS[s]!, prismSpectrum()[s]!);
      }
      ctx.beginPath();
      ctx.arc(screenX, screenY, PRIMARY_R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = themeColor('prism-primary-edge');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Harmony i (i = 1..N-1): solid color from rainbow stops, indexed at i-1
      // so harmony-0 = red, harmony-1 = orange, etc.
      const colorIdx = (i - 1) % prismSpectrum().length;
      ctx.beginPath();
      ctx.arc(screenX, screenY, HARMONY_R, 0, Math.PI * 2);
      ctx.fillStyle = prismSpectrum()[colorIdx]!;
      ctx.fill();
      ctx.strokeStyle = themeColor('prism-harmony-edge');
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
  offsets: readonly number[],
  octaveRange: number,
  atBeat: number,
): number[] {
  const hit = evaluateCurveAtBeat(sourceCurve, atBeat);
  if (!hit) return [];

  const octaves = Math.max(0, Math.min(3, Math.round(octaveRange)));
  const targets: number[] = [];
  for (let octave = -octaves; octave <= octaves; octave++) {
    for (const offset of offsets) {
      const y = hit.noteNumber + offset + octave * CENTS_PER_OCTAVE;
      if (y >= MIN_PITCH_CENTS && y <= MAX_PITCH_CENTS) targets.push(y);
    }
  }
  return targets;
}
