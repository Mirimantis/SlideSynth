import type { GuideDefinition } from '../types';
import type { Viewport } from './viewport';
import { noteNumberToName } from '../constants';

export const GUIDE_COLOR = '#7a8fa6';
export const GUIDE_SELECTED_COLOR = '#e6c84a';
const LABEL_FONT = '11px monospace';
const LABEL_BG = 'rgba(20, 28, 40, 0.85)';
/** How far past the edge to draw the label so it sits in the ruler/staff strip. */
const LABEL_PADDING = 4;

/** Render every guide as a thin dashed line with optional inline label. */
export function renderGuides(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  guides: readonly GuideDefinition[],
  canvasWidth: number,
  canvasHeight: number,
  selectedGuideId: string | null,
): void {
  if (guides.length === 0) return;
  ctx.save();
  for (const g of guides) {
    const isSelected = g.id === selectedGuideId;
    const color = isSelected ? GUIDE_SELECTED_COLOR : GUIDE_COLOR;
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.6 : 1;
    ctx.setLineDash(isSelected ? [] : [4, 4]);
    ctx.beginPath();
    if (g.orientation === 'x') {
      const sx = vp.worldToScreen(g.position, 0).sx;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvasHeight);
      ctx.stroke();
      drawLabel(ctx, g, sx, LABEL_PADDING + 14, color, 'left');
    } else {
      const sy = vp.worldToScreen(0, g.position).sy;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvasWidth, sy);
      ctx.stroke();
      drawLabel(ctx, g, LABEL_PADDING + 32, sy - 4, color, 'left');
    }
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  g: GuideDefinition,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign,
): void {
  const text = g.label || defaultLabel(g);
  if (!text) return;
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(x - 2, y - 8, w + 4, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Default label so an unnamed guide still has something useful to read. */
function defaultLabel(g: GuideDefinition): string {
  if (g.orientation === 'x') {
    return `b${g.position.toFixed(2)}`;
  } else {
    const nearest = Math.round(g.position);
    return noteNumberToName(nearest);
  }
}

/**
 * Returns the closest guide whose line is within `hitRadiusPx` of (sx, sy).
 * X-guides hit on horizontal distance; Y-guides on vertical distance.
 */
export function hitTestGuides(
  vp: Viewport,
  sx: number,
  sy: number,
  guides: readonly GuideDefinition[],
  hitRadiusPx: number = 6,
): string | null {
  let best: string | null = null;
  let bestDist = hitRadiusPx;
  for (const g of guides) {
    let d: number;
    if (g.orientation === 'x') {
      const guideSx = vp.worldToScreen(g.position, 0).sx;
      d = Math.abs(sx - guideSx);
    } else {
      const guideSy = vp.worldToScreen(0, g.position).sy;
      d = Math.abs(sy - guideSy);
    }
    if (d <= bestDist) {
      bestDist = d;
      best = g.id;
    }
  }
  return best;
}
