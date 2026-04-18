import type { Viewport } from './viewport';
import { RULER_HEIGHT, SECONDS_RULER_HEIGHT, BEAT_RULER_HEIGHT } from './interaction';

/**
 * Render the ruler bar at the top of the canvas.
 * Consists of a seconds ruler (top) stacked above a beat/measure ruler (bottom).
 * Both are part of the playhead scrub interaction area.
 */
export function renderRuler(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  beatsPerMeasure: number,
  bpm: number,
): void {
  renderSecondsRuler(ctx, vp, width, bpm);
  renderBeatRuler(ctx, vp, width, beatsPerMeasure, SECONDS_RULER_HEIGHT);

  // Outer bottom border of the whole ruler area
  ctx.strokeStyle = '#446';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_HEIGHT - 0.5);
  ctx.lineTo(width, RULER_HEIGHT - 0.5);
  ctx.stroke();
}

/**
 * Render the seconds ruler (top strip).
 * Tick interval adapts to zoom using a 1-2-5 pattern so ticks stay ~60px apart.
 * Updates whenever BPM or zoom changes (caller passes current bpm).
 */
function renderSecondsRuler(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  bpm: number,
): void {
  const h = SECONDS_RULER_HEIGHT;

  // Slightly lighter background so the two rulers are visually distinct
  ctx.fillStyle = '#161628';
  ctx.fillRect(0, 0, width, h);

  // Divider between seconds ruler and beat ruler
  ctx.strokeStyle = '#334';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(width, h - 0.5);
  ctx.stroke();

  if (bpm <= 0) return;

  // Beat <-> second conversion
  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 60 / bpm;
  const pixelsPerSecond = vp.state.zoomX * beatsPerSecond;

  // Visible second range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, 0);
  const minSecond = Math.max(0, topLeft.wx * secondsPerBeat);
  const maxSecond = bottomRight.wx * secondsPerBeat;

  // Adaptive tick interval: pick smallest 1-2-5 step where major ticks are ~60px apart
  const majorStep = pickMajorStep(pixelsPerSecond, 60);
  const minorStep = majorStep / 5;

  // Draw minor ticks only if they're far enough apart to be readable (~6px min)
  const drawMinor = minorStep * pixelsPerSecond >= 6;

  // Minor ticks
  if (drawMinor) {
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 0.5;
    const firstMinor = Math.ceil(minSecond / minorStep) * minorStep;
    for (let s = firstMinor; s <= maxSecond + 1e-6; s += minorStep) {
      // Skip minor ticks that coincide with a major (avoid double-draw look)
      if (Math.abs(s / majorStep - Math.round(s / majorStep)) < 1e-6) continue;
      const beat = s * beatsPerSecond;
      const { sx } = vp.worldToScreen(beat, 0);
      if (sx < 0 || sx > width) continue;
      ctx.beginPath();
      ctx.moveTo(sx, h);
      ctx.lineTo(sx, h - 3);
      ctx.stroke();
    }
  }

  // Major ticks + labels
  ctx.strokeStyle = '#667';
  ctx.lineWidth = 0.8;
  ctx.fillStyle = '#99a';
  ctx.font = '9px monospace';
  ctx.textBaseline = 'top';

  const firstMajor = Math.ceil(minSecond / majorStep - 1e-9) * majorStep;
  for (let s = firstMajor; s <= maxSecond + 1e-6; s += majorStep) {
    const beat = s * beatsPerSecond;
    const { sx } = vp.worldToScreen(beat, 0);
    if (sx < -40 || sx > width + 40) continue;

    ctx.beginPath();
    ctx.moveTo(sx, h);
    ctx.lineTo(sx, h - 7);
    ctx.stroke();

    if (sx >= 0 && sx <= width) {
      ctx.fillText(formatSeconds(s, majorStep), sx + 3, 2);
    }
  }
}

/**
 * Pick a tick interval from the 1-2-5 sequence (..., 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, ...)
 * so that a single interval spans at least `minPixels` on screen.
 */
function pickMajorStep(pixelsPerSecond: number, minPixels: number): number {
  if (pixelsPerSecond <= 0) return 1;
  const raw = minPixels / pixelsPerSecond; // seconds per tick needed
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let mult: number;
  if (norm <= 1) mult = 1;
  else if (norm <= 2) mult = 2;
  else if (norm <= 5) mult = 5;
  else mult = 10;
  return mult * pow;
}

/**
 * Format a time value for the seconds ruler label.
 * Uses decimals for sub-second steps, M:SS for >= 1s steps.
 */
function formatSeconds(seconds: number, step: number): string {
  if (step < 1) {
    // Decimal seconds — use enough precision to distinguish adjacent ticks
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return `${seconds.toFixed(decimals)}s`;
  }
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Render the beat/measure ruler (bottom strip).
 * Tick hierarchy adapts to zoom level, matching the adaptive snap granularity.
 */
function renderBeatRuler(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  width: number,
  beatsPerMeasure: number,
  topY: number,
): void {
  const h = BEAT_RULER_HEIGHT;
  const baseY = topY + h; // screen-y of ruler bottom edge

  // Dark background
  ctx.fillStyle = '#111122';
  ctx.fillRect(0, topY, width, h);

  // Visible beat range
  const topLeft = vp.screenToWorld(0, 0);
  const bottomRight = vp.screenToWorld(width, 0);
  const minBeat = Math.max(0, Math.floor(topLeft.wx));
  const maxBeat = Math.ceil(bottomRight.wx);

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
        ctx.moveTo(subSx, baseY);
        ctx.lineTo(subSx, baseY - tickH);
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
    ctx.moveTo(sx, baseY);
    ctx.lineTo(sx, baseY - tickH);
    ctx.stroke();

    // Labels — measure numbers always, beat numbers when zoomed in
    if (isMeasure) {
      const measureNum = b / beatsPerMeasure + 1;
      ctx.fillStyle = '#aabbcc';
      ctx.font = 'bold 10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(String(measureNum), sx + 3, topY + 2);
    } else if (zx >= 50) {
      const beatInMeasure = (b % beatsPerMeasure) + 1;
      ctx.fillStyle = '#667';
      ctx.font = '9px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(String(beatInMeasure), sx + 2, topY + 4);
    }
  }
}
