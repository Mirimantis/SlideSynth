import type { GuideDefinition } from '../types';
import type { Viewport } from './viewport';
import { themeColor } from '../theme/theme';
import { fretLines } from '../model/frets';
import { worldDashOffset } from './dash';

/** An unselected guide's dashes. */
const GUIDE_DASH = [4, 4];

const LABEL_FONT = '11px monospace';
/** How far past the edge to draw the label so it sits in the ruler/staff strip. */
const LABEL_PADDING = 4;

/** Render every guide as a thin dashed line with optional inline label.
 *  `fretName` names an unlabelled fret's pitch (by the current tuning);
 *  `period` is the tuning's repeat, where an octave fret draws its lines. */
export function renderGuides(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  guides: readonly GuideDefinition[],
  canvasWidth: number,
  canvasHeight: number,
  selectedGuideId: string | null,
  fretName: (cents: number) => string,
  period: number,
): void {
  if (guides.length === 0) return;
  ctx.save();
  // The dashes move with the canvas when it scrolls or pans: frets (drawn
  // across) are pinned to beat 0, beat guides (drawn down) to pitch 0.
  const origin = vp.worldToScreen(0, 0);
  for (const g of guides) {
    const isSelected = g.id === selectedGuideId;
    const color = isSelected ? themeColor('guide-selected') : themeColor('guide');
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.6 : 1;
    ctx.setLineDash(isSelected ? [] : GUIDE_DASH);
    ctx.lineDashOffset = worldDashOffset(g.orientation === 'x' ? origin.sy : origin.sx, GUIDE_DASH);
    ctx.beginPath();
    if (g.orientation === 'x') {
      const sx = vp.worldToScreen(g.position, 0).sx;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvasHeight);
      ctx.stroke();
      drawLabel(ctx, g.label || defaultLabel(g, fretName), sx, LABEL_PADDING + 14, color, 'left');
    } else {
      // Every line of an octave fret, each named by its own pitch.
      for (const line of fretLines(g, period)) {
        const sy = vp.worldToScreen(0, line.cents).sy;
        if (sy < -8 || sy > canvasHeight + 8) continue;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(canvasWidth, sy);
        ctx.stroke();
        drawLabel(ctx, g.label || fretName(line.cents), LABEL_PADDING + 32, sy - 4, color, 'left');
      }
    }
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign,
): void {
  if (!text) return;
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = themeColor('guide-label-bg');
  ctx.fillRect(x - 2, y - 8, w + 4, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The guide handle at the ruler's left end (13.17): a small tab with a beat
 *  guide's vertical line over a fret's horizontal one. Drag it down for a
 *  fret, right for a beat guide. Dimmed while guides are locked. */
export function renderGuideHandle(ctx: CanvasRenderingContext2D, width: number, height: number, locked: boolean): void {
  ctx.save();
  ctx.fillStyle = themeColor('guide-handle-bg');
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = themeColor('ruler-border');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width - 0.5, 0);
  ctx.lineTo(width - 0.5, height);
  ctx.stroke();

  ctx.globalAlpha = locked ? 0.35 : 1;
  ctx.strokeStyle = themeColor('guide');
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 2]);
  const mid = Math.round(width / 2) - 0.5;
  ctx.beginPath();
  ctx.moveTo(mid, 5);                 // a beat guide
  ctx.lineTo(mid, height / 2 - 2);
  ctx.moveTo(3, height * 0.72);       // a fret
  ctx.lineTo(width - 4, height * 0.72);
  ctx.stroke();
  ctx.restore();
}

/** Default label so an unnamed beat guide still has something useful to read. */
function defaultLabel(g: GuideDefinition, fretName: (cents: number) => string): string {
  return g.orientation === 'x' ? `b${g.position.toFixed(2)}` : fretName(g.position);
}

/**
 * Returns the closest guide whose line is within `hitRadiusPx` of (sx, sy),
 * and which of an octave fret's lines was hit (`k`, 0 otherwise).
 * X-guides hit on horizontal distance; Y-guides on vertical distance.
 */
export function hitTestGuides(
  vp: Viewport,
  sx: number,
  sy: number,
  guides: readonly GuideDefinition[],
  period: number,
  hitRadiusPx: number = 6,
): { id: string; k: number } | null {
  let best: { id: string; k: number } | null = null;
  let bestDist = hitRadiusPx;
  for (const g of guides) {
    if (g.orientation === 'x') {
      const d = Math.abs(sx - vp.worldToScreen(g.position, 0).sx);
      if (d <= bestDist) { bestDist = d; best = { id: g.id, k: 0 }; }
    } else {
      for (const line of fretLines(g, period)) {
        const d = Math.abs(sy - vp.worldToScreen(0, line.cents).sy);
        if (d <= bestDist) { bestDist = d; best = { id: g.id, k: line.k }; }
      }
    }
  }
  return best;
}
