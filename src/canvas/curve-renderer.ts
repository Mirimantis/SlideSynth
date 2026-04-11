import type { BezierCurve, ToneDefinition, Vec2 } from '../types';
import type { Viewport } from './viewport';
import { getSegmentControlPoints } from '../model/curve';

const POINT_RADIUS = 5;
const POINT_RADIUS_UNSELECTED = 3;
const HANDLE_RADIUS = 3;

/**
 * Render all curves for a track.
 */
export function renderCurves(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curves: BezierCurve[],
  tone: ToneDefinition,
  selectedCurveId: string | null,
  selectedPointIndex: number | null,
): void {
  for (const curve of curves) {
    const isSelected = curve.id === selectedCurveId;
    renderCurve(ctx, vp, curve, tone, isSelected, selectedPointIndex);
  }
}

function renderCurve(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  curve: BezierCurve,
  tone: ToneDefinition,
  isSelected: boolean,
  selectedPointIndex: number | null,
): void {
  if (curve.points.length === 0) return;

  // Draw curve segments
  if (curve.points.length >= 2) {
    ctx.beginPath();
    ctx.strokeStyle = tone.color;
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.setLineDash(tone.dashPattern);

    const first = curve.points[0]!;
    const firstScreen = vp.worldToScreen(first.position.x, first.position.y);
    ctx.moveTo(firstScreen.sx, firstScreen.sy);

    for (let i = 0; i < curve.points.length - 1; i++) {
      const seg = getSegmentControlPoints(curve, i);
      if (!seg) continue;

      const cp1 = vp.worldToScreen(seg.p1.x, seg.p1.y);
      const cp2 = vp.worldToScreen(seg.p2.x, seg.p2.y);
      const end = vp.worldToScreen(seg.p3.x, seg.p3.y);

      ctx.bezierCurveTo(cp1.sx, cp1.sy, cp2.sx, cp2.sy, end.sx, end.sy);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw control points (always visible; handles only when selected)
  for (let i = 0; i < curve.points.length; i++) {
    const pt = curve.points[i]!;
    const screen = vp.worldToScreen(pt.position.x, pt.position.y);
    const isPointSelected = isSelected && selectedPointIndex === i;

    if (isSelected) {
      // Draw handles when curve is selected
      if (pt.handleIn) {
        drawHandle(ctx, vp, pt.position, pt.handleIn, tone.color);
      }
      if (pt.handleOut) {
        drawHandle(ctx, vp, pt.position, pt.handleOut, tone.color);
      }

      // Full-size anchor point
      ctx.beginPath();
      ctx.arc(screen.sx, screen.sy, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isPointSelected ? '#fff' : tone.color;
      ctx.fill();
      ctx.strokeStyle = isPointSelected ? '#fff' : '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Volume indicator: small bar below point
      if (isPointSelected) {
        const barWidth = 20;
        const barHeight = 3;
        const barX = screen.sx - barWidth / 2;
        const barY = screen.sy + POINT_RADIUS + 4;

        // Background
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        // Fill
        ctx.fillStyle = tone.color;
        ctx.fillRect(barX, barY, barWidth * pt.volume, barHeight);
      }
    } else {
      // Small, faint anchor point when not selected
      ctx.beginPath();
      ctx.arc(screen.sx, screen.sy, POINT_RADIUS_UNSELECTED, 0, Math.PI * 2);
      ctx.fillStyle = tone.color;
      ctx.fill();
    }
  }
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  anchor: Vec2,
  handleRel: Vec2,
  color: string,
): void {
  const anchorScreen = vp.worldToScreen(anchor.x, anchor.y);
  const handleAbs = { x: anchor.x + handleRel.x, y: anchor.y + handleRel.y };
  const handleScreen = vp.worldToScreen(handleAbs.x, handleAbs.y);

  // Whisker line
  ctx.beginPath();
  ctx.moveTo(anchorScreen.sx, anchorScreen.sy);
  ctx.lineTo(handleScreen.sx, handleScreen.sy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Handle dot
  ctx.beginPath();
  ctx.arc(handleScreen.sx, handleScreen.sy, HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Render a rubber-band line from the last point to the cursor during drawing.
 */
export function renderDrawPreview(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fromWorld: Vec2,
  toWorld: Vec2,
  color: string,
): void {
  const from = vp.worldToScreen(fromWorld.x, fromWorld.y);
  const to = vp.worldToScreen(toWorld.x, toWorld.y);

  ctx.beginPath();
  ctx.moveTo(from.sx, from.sy);
  ctx.lineTo(to.sx, to.sy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Cursor dot
  ctx.beginPath();
  ctx.arc(to.sx, to.sy, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalAlpha = 1;
}
