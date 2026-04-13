import type { Vec2 } from '../types';
import type { ChordDefinition } from '../utils/chords';
import type { Viewport } from './viewport';
import { noteNumberToName, MIN_NOTE, MAX_NOTE } from '../constants';

/**
 * Render chord overlay markers on the foreground canvas.
 * Shows diamond markers at each chord tone position relative to the root point,
 * with note name labels and a connecting dashed line.
 */
export function renderChordOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  rootPosition: Vec2,
  chord: ChordDefinition,
  toneColor: string,
): void {
  const notes = chord.intervals
    .map(iv => rootPosition.y + iv)
    .filter(n => n >= MIN_NOTE && n <= MAX_NOTE);

  if (notes.length === 0) return;

  const rootX = rootPosition.x;

  // Convert all to screen coords
  const screenPoints = notes.map(n => ({
    note: n,
    ...vp.worldToScreen(rootX, n),
  }));

  // Dashed vertical connecting line
  const minSy = Math.min(...screenPoints.map(p => p.sy));
  const maxSy = Math.max(...screenPoints.map(p => p.sy));
  if (screenPoints.length > 1) {
    ctx.beginPath();
    ctx.moveTo(screenPoints[0]!.sx, minSy);
    ctx.lineTo(screenPoints[0]!.sx, maxSy);
    ctx.strokeStyle = toneColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Draw markers for each chord tone
  for (let i = 0; i < screenPoints.length; i++) {
    const sp = screenPoints[i]!;
    const isRoot = i === 0;
    const size = isRoot ? 7 : 5;

    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(sp.sx, sp.sy - size);
    ctx.lineTo(sp.sx + size, sp.sy);
    ctx.lineTo(sp.sx, sp.sy + size);
    ctx.lineTo(sp.sx - size, sp.sy);
    ctx.closePath();

    if (isRoot) {
      ctx.fillStyle = toneColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = toneColor;
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = toneColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Note name label
    const noteName = noteNumberToName(Math.round(sp.note));
    ctx.font = 'bold 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = toneColor;
    ctx.globalAlpha = 0.9;
    ctx.fillText(noteName, sp.sx + size + 4, sp.sy);
    ctx.globalAlpha = 1;
  }
}
