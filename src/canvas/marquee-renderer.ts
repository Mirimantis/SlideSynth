import type { Vec2 } from '../types';
import type { Viewport } from './viewport';

/** Render a drag-marquee rubber-band rectangle in screen space (BACKLOG 8.3).
 *  Light fill so points behind it stay visible, dashed border so it reads as
 *  a transient overlay rather than a fixed shape. */
export function renderMarquee(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  startWorld: Vec2,
  currentWorld: Vec2,
): void {
  const a = vp.worldToScreen(startWorld.x, startWorld.y);
  const b = vp.worldToScreen(currentWorld.x, currentWorld.y);
  const x = Math.min(a.sx, b.sx);
  const y = Math.min(a.sy, b.sy);
  const w = Math.abs(b.sx - a.sx);
  const h = Math.abs(b.sy - a.sy);

  ctx.save();
  ctx.fillStyle = 'rgba(120, 180, 255, 0.10)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(180, 210, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}
