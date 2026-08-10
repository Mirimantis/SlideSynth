import type { PlanchetteState } from '../types';
import type { RecordedSample } from '../model/curve';
import type { Viewport } from './viewport';
import { RULER_HEIGHT } from './interaction';
import { PRISM_RAINBOW_STOPS } from './projection-renderer';

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
 * Build a horizontal rainbow gradient sized to the planchette circle. Used as
 * the stroke style for the primary planchette when Prism Draw is on, so the
 * primary reads as the "prism" voice while harmonies render in solid rainbow
 * stops around it.
 */
export function rainbowGlyphStroke(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): CanvasGradient {
  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  const stops = PRISM_RAINBOW_STOPS;
  for (let i = 0; i < stops.length; i++) {
    grad.addColorStop(i / Math.max(1, stops.length - 1), stops[i]!);
  }
  return grad;
}

/** Pick the stroke color for a Prism-mode rail planchette by voiceId.
 *  Primary returns a gradient (built per-call from cx/cy/r); harmonies
 *  return solid rainbow stops. */
export function prismPlanchetteStroke(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  voiceId: string,
): string | CanvasGradient {
  if (voiceId === 'primary') return rainbowGlyphStroke(ctx, cx, cy, r);
  if (voiceId.startsWith('harmony-')) {
    const idx = Number(voiceId.slice('harmony-'.length));
    if (Number.isInteger(idx) && idx >= 0 && idx < PRISM_RAINBOW_STOPS.length) {
      return PRISM_RAINBOW_STOPS[idx]!;
    }
  }
  return PRIMARY_COLOR;
}

/**
 * Draw the planchette visual: a hollow circle with a small crosshair inside
 * and a triangle on each side pointing inward at the circle's horizontal axis.
 * Same glyph is used for rail-bound and free-moving planchettes.
 */
export function renderPlanchetteGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string | CanvasGradient = PRIMARY_COLOR,
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
 * Soft halo behind a planchette showing the dynamics-bus value for that voice
 * (BACKLOG 11.1) — bigger and brighter as the swell rises. Drawn *behind* the
 * glyph rather than scaling it: the glyph marks an exact pitch, so its geometry
 * has to stay put while loudness moves.
 */
function renderDynamicsHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dynamics: number,
  color: string,
): void {
  const d = Math.max(0, Math.min(1, dynamics));
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.30 * d;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, CIRCLE_RADIUS * (0.8 + 1.4 * d), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Render the rail + any planchettes riding it at their snapped Y values.
 * Used in Glissandograph rendering (rail is always present) and in Compose
 * when Scroll-Canvas Playback is active.
 *
 * `dynamicsOf` resolves a voice's current dynamics-bus value; returning null
 * (which is what the bus's `fixed` source does) draws the planchette exactly as
 * it looked before the bus existed.
 */
export function renderPlanchettes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  planchettes: PlanchetteState[],
  lastLoopWrapAt: number = 0,
  prismMode: boolean = false,
  dynamicsOf?: (voiceId: string) => number | null,
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

    const dyn = dynamicsOf?.(p.voiceId) ?? null;
    if (dyn != null) {
      // Gradients can't fill a halo meaningfully, so the halo always uses the
      // voice's solid trail colour even in Prism mode.
      renderDynamicsHalo(ctx, railX, snappedScreenY, dyn, recordingTrailColor(p.voiceId, prismMode));
    }

    const color: string | CanvasGradient = prismMode
      ? prismPlanchetteStroke(ctx, railX, snappedScreenY, CIRCLE_RADIUS, p.voiceId)
      : PRIMARY_COLOR;
    renderPlanchetteGlyph(ctx, railX, snappedScreenY, color);

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
 * Brief expanding ring + halo for a metronome tick. Downbeats are bigger +
 * brighter than accent/weak ticks so the beat hierarchy is visible. `ageMs`
 * is the wall-clock age of the most recent click; ring fades + grows over
 * `METRONOME_FLASH_DURATION_MS`.
 */
export const METRONOME_FLASH_DURATION_MS = 180;

export function renderMetronomeFlash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ageMs: number,
  tier: 'downbeat' | 'accent' | 'weak',
): void {
  if (ageMs < 0 || ageMs >= METRONOME_FLASH_DURATION_MS) return;
  const t = ageMs / METRONOME_FLASH_DURATION_MS;   // 0..1
  const alpha = 1 - t;
  const maxRadius = tier === 'downbeat' ? 22 : tier === 'accent' ? 16 : 12;
  const radius = CIRCLE_RADIUS + (maxRadius - CIRCLE_RADIUS) * t;
  const lineWidth = tier === 'downbeat' ? 2.5 : 1.8;
  const color = tier === 'downbeat' ? '#ffeb3b' : tier === 'accent' ? '#ffb74d' : '#f4a3a3';
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Resolve a solid stroke color for an in-flight recording trail by voiceId.
 *  Mirrors `prismPlanchetteStroke` but always returns a string (gradients are
 *  anchored to the planchette circle and don't tile cleanly along a polyline).
 *  In Prism mode the primary voice borrows the middle rainbow stop so it reads
 *  as the "prism" voice without the gradient. */
export function recordingTrailColor(voiceId: string, prismMode: boolean): string {
  if (prismMode) {
    if (voiceId === 'primary') {
      return PRISM_RAINBOW_STOPS[Math.floor(PRISM_RAINBOW_STOPS.length / 2)] ?? PRIMARY_COLOR;
    }
    if (voiceId.startsWith('harmony-')) {
      const idx = Number(voiceId.slice('harmony-'.length));
      if (Number.isInteger(idx) && idx >= 0 && idx < PRISM_RAINBOW_STOPS.length) {
        return PRISM_RAINBOW_STOPS[idx]!;
      }
    }
  }
  return PRIMARY_COLOR;
}

/**
 * Render a live polyline behind each in-flight recording voice. Reads the raw
 * per-voice sample buffer from the performance engine and strokes one polyline
 * per voice in world coordinates, so Scroll Canvas mode pans the trail with
 * the canvas. Buffers are cleared by `finalizeCurve` / `stopSession`, so the
 * trail vanishes the same frame the simplified curve commits.
 */
export function renderRecordingTrails(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  buffers: ReadonlyMap<string, readonly RecordedSample[]>,
  canvasHeight: number,
  prismMode: boolean,
): void {
  const topY = RULER_HEIGHT;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [voiceId, samples] of buffers) {
    if (samples.length < 2) continue;
    ctx.strokeStyle = recordingTrailColor(voiceId, prismMode);
    // The trail thickens with each sample's dynamics (BACKLOG 11.1) so the
    // shape of the swell is visible as it's played. A single path can only
    // carry one lineWidth, so the polyline is broken into runs of equal
    // (quantized) width — a handful of strokes per voice, not one per segment.
    // A `fixed`-source take has one width throughout, i.e. a single stroke,
    // which is exactly the pre-bus drawing.
    let started = false;
    let runWidth = trailWidthFor(samples[0]!.volume);
    ctx.lineWidth = runWidth;
    ctx.beginPath();
    let last: { sx: number; sy: number } | null = null;
    for (const s of samples) {
      const scr = vp.worldToScreen(s.beat, s.note);
      // Skip points outside the canvas body but keep the polyline continuous
      // by re-entering with moveTo when we come back in range.
      if (scr.sy < topY || scr.sy > canvasHeight) {
        started = false;
        last = null;
        continue;
      }
      const width = trailWidthFor(s.volume);
      if (started && width !== runWidth) {
        // Close out the current run, then reopen from the same point at the new
        // width so the trail stays visually continuous across the seam.
        ctx.stroke();
        ctx.lineWidth = width;
        runWidth = width;
        ctx.beginPath();
        if (last) ctx.moveTo(last.sx, last.sy);
      }
      if (!started) {
        ctx.moveTo(scr.sx, scr.sy);
        started = true;
      } else {
        ctx.lineTo(scr.sx, scr.sy);
      }
      last = scr;
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Trail stroke width for a captured dynamics value, quantized to 0.5 px so a
 *  gently drifting value doesn't split the polyline into hundreds of runs. */
function trailWidthFor(volume: number): number {
  const d = Math.max(0, Math.min(1, volume));
  return Math.round((1 + 3 * d) * 2) / 2;
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
