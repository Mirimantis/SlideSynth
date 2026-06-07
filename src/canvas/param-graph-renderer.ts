import type { ParamCurve } from '../types';
import type { Viewport } from './viewport';
import type { ParamViewport } from './param-viewport';
import { getParamSegmentControlPoints } from '../model/param-curve';

const POINT_RADIUS = 4;
const HANDLE_RADIUS = 3;

/**
 * Render the Parameters Graph for the selected curve's volume lane.
 * The X axis is shared with the main viewport (time-locked); Y is value 0..1.
 *
 * The curve is drawn only across the PITCH curve's X extent
 * [pitchStartBeat, pitchEndBeat] — outside that span the curve isn't audible, so
 * rendering stops there (with constant-hold lead-in/out to those bounds). This
 * keeps the begin/end of the envelope clear even as points move.
 *
 * Drawn fresh every frame (cheap), so no dirty flag is needed.
 */
export function renderParamGraph(
  ctx: CanvasRenderingContext2D,
  pvp: ParamViewport,
  main: Viewport,
  width: number,
  height: number,
  lane: ParamCurve | null,
  color: string,
  selectedIdx: number | null,
  playheadBeat: number | null,
  pitchStartBeat: number | null,
  pitchEndBeat: number | null,
): void {
  ctx.clearRect(0, 0, width, height);

  // ── Horizontal value guides at 0, 0.5, 1 ──
  ctx.lineWidth = 1;
  for (const v of [0, 0.5, 1]) {
    const y = pvp.worldToScreen(0, v).sy;
    ctx.strokeStyle = v === 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // ── Vertical beat lines (aligned with the main canvas X) ──
  const leftBeat = main.state.offsetX;
  const rightBeat = main.state.offsetX + width / main.state.zoomX;
  let step = 1;
  while ((rightBeat - leftBeat) / step > 40) step *= 2;
  const firstBeat = Math.ceil(leftBeat / step) * step;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let b = firstBeat; b <= rightBeat; b += step) {
    const x = pvp.beatToX(b);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // ── Playhead marker (same screen X as the main playhead) ──
  if (playheadBeat !== null) {
    const x = pvp.beatToX(playheadBeat);
    if (x >= 0 && x <= width) {
      ctx.strokeStyle = 'rgba(255,80,80,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  if (!lane || lane.points.length === 0 || pitchStartBeat === null || pitchEndBeat === null) return;

  const startX = pvp.beatToX(pitchStartBeat);
  const endX = pvp.beatToX(pitchEndBeat);

  // ── Range boundary markers at the pitch curve's start / end ──
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (const x of [startX, endX]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // ── Volume curve, clipped to the pitch X extent ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(startX, 0, Math.max(0, endX - startX), height);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const first = lane.points[0]!;
  const firstS = pvp.worldToScreen(first.position.x, first.position.y);
  // Constant-hold lead-in from the pitch start to the first point.
  ctx.moveTo(startX, firstS.sy);
  ctx.lineTo(firstS.sx, firstS.sy);
  for (let i = 0; i < lane.points.length - 1; i++) {
    const seg = getParamSegmentControlPoints(lane, i);
    if (!seg) continue;
    const p1 = pvp.worldToScreen(seg.p1.x, seg.p1.y);
    const p2 = pvp.worldToScreen(seg.p2.x, seg.p2.y);
    const p3 = pvp.worldToScreen(seg.p3.x, seg.p3.y);
    ctx.bezierCurveTo(p1.sx, p1.sy, p2.sx, p2.sy, p3.sx, p3.sy);
  }
  // Constant-hold lead-out from the last point to the pitch end.
  const last = lane.points[lane.points.length - 1]!;
  const lastS = pvp.worldToScreen(last.position.x, last.position.y);
  ctx.lineTo(endX, lastS.sy);
  ctx.stroke();
  ctx.restore();

  // ── Handles for the selected point (drawn unclipped so they're grabbable) ──
  if (selectedIdx !== null) {
    const pt = lane.points[selectedIdx];
    if (pt) {
      const anchor = pvp.worldToScreen(pt.position.x, pt.position.y);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      for (const h of [pt.handleIn, pt.handleOut]) {
        if (!h) continue;
        const hs = pvp.worldToScreen(pt.position.x + h.x, pt.position.y + h.y);
        ctx.beginPath();
        ctx.moveTo(anchor.sx, anchor.sy);
        ctx.lineTo(hs.sx, hs.sy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hs.sx, hs.sy, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Anchor points ──
  for (let i = 0; i < lane.points.length; i++) {
    const pt = lane.points[i]!;
    const s = pvp.worldToScreen(pt.position.x, pt.position.y);
    const isSel = selectedIdx === i;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? '#fff' : color;
    ctx.fill();
    ctx.strokeStyle = isSel ? '#fff' : '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
