import type { BoundingBox, TransformHandle } from '../types';
import type { Viewport } from './viewport';

const HANDLE_SIZE = 8; // px, full width/height of handle square
const HALF = HANDLE_SIZE / 2;
const ARROW_SIZE = 14; // px, size of octave arrow buttons
const ARROW_GAP = 10;  // px, gap between box edge and arrow

/**
 * Render a transform bounding box with 8 drag handles.
 */
export function renderTransformBox(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  bbox: BoundingBox,
  activeHandle: TransformHandle | null,
): void {
  // Convert bbox corners to screen space
  // Note: in world coords, maxY = higher pitch = lower screen Y
  const tl = vp.worldToScreen(bbox.minX, bbox.maxY); // top-left on screen
  const tr = vp.worldToScreen(bbox.maxX, bbox.maxY);
  const bl = vp.worldToScreen(bbox.minX, bbox.minY); // bottom-left on screen

  const left = tl.sx;
  const right = tr.sx;
  const top = tl.sy;
  const bottom = bl.sy;
  const w = right - left;
  const h = bottom - top;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  // Semi-transparent fill
  ctx.fillStyle = 'rgba(100, 180, 255, 0.06)';
  ctx.fillRect(left, top, w, h);

  // Dashed outline
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw 8 handles
  const handles: { x: number; y: number; id: TransformHandle }[] = [
    { x: left, y: top, id: 'topLeft' },
    { x: right, y: top, id: 'topRight' },
    { x: left, y: bottom, id: 'bottomLeft' },
    { x: right, y: bottom, id: 'bottomRight' },
    { x: midX, y: top, id: 'top' },
    { x: midX, y: bottom, id: 'bottom' },
    { x: left, y: midY, id: 'left' },
    { x: right, y: midY, id: 'right' },
  ];

  for (const handle of handles) {
    const isActive = handle.id === activeHandle;
    ctx.fillStyle = isActive ? '#fff' : 'rgba(100, 180, 255, 0.9)';
    ctx.strokeStyle = 'rgba(40, 80, 120, 0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(handle.x - HALF, handle.y - HALF, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(handle.x - HALF, handle.y - HALF, HANDLE_SIZE, HANDLE_SIZE);
  }

  // Octave arrow buttons (up arrow above box, down arrow below)
  const arrowX = midX;
  const upY = top - ARROW_GAP - ARROW_SIZE / 2;
  const downY = bottom + ARROW_GAP + ARROW_SIZE / 2;

  drawArrow(ctx, arrowX, upY, ARROW_SIZE, 'up');
  drawArrow(ctx, arrowX, downY, ARROW_SIZE, 'down');
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number,
  direction: 'up' | 'down',
): void {
  const half = size / 2;
  const tip = direction === 'up' ? cy - half : cy + half;
  const base = direction === 'up' ? cy + half : cy - half;

  ctx.beginPath();
  ctx.moveTo(cx, tip);
  ctx.lineTo(cx - half, base);
  ctx.lineTo(cx + half, base);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 180, 255, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 80, 120, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Hit-test the transform box. Returns the handle hit, 'translate' for interior, or null for outside. */
export function hitTestTransformBox(
  screenX: number,
  screenY: number,
  bbox: BoundingBox,
  vp: Viewport,
): TransformHandle | null {
  const tl = vp.worldToScreen(bbox.minX, bbox.maxY);
  const br = vp.worldToScreen(bbox.maxX, bbox.minY);

  const left = tl.sx;
  const right = br.sx;
  const top = tl.sy;
  const bottom = br.sy;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  const handles: { x: number; y: number; id: TransformHandle }[] = [
    { x: left, y: top, id: 'topLeft' },
    { x: right, y: top, id: 'topRight' },
    { x: left, y: bottom, id: 'bottomLeft' },
    { x: right, y: bottom, id: 'bottomRight' },
    { x: midX, y: top, id: 'top' },
    { x: midX, y: bottom, id: 'bottom' },
    { x: left, y: midY, id: 'left' },
    { x: right, y: midY, id: 'right' },
  ];

  // Check octave arrows first
  const arrowX = midX;
  const upY = top - ARROW_GAP - ARROW_SIZE / 2;
  const downY = bottom + ARROW_GAP + ARROW_SIZE / 2;
  const arrowHalf = ARROW_SIZE / 2;

  if (Math.abs(screenX - arrowX) <= arrowHalf && Math.abs(screenY - upY) <= arrowHalf) {
    return 'octaveUp';
  }
  if (Math.abs(screenX - arrowX) <= arrowHalf && Math.abs(screenY - downY) <= arrowHalf) {
    return 'octaveDown';
  }

  // Check handles (corners before edges for priority)
  for (const handle of handles) {
    if (Math.abs(screenX - handle.x) <= HALF + 2 && Math.abs(screenY - handle.y) <= HALF + 2) {
      return handle.id;
    }
  }

  // Check interior
  if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
    return 'translate';
  }

  return null;
}

/** Get the CSS cursor for a transform handle. */
export function getTransformCursor(handle: TransformHandle | null): string {
  switch (handle) {
    case 'translate': return 'move';
    case 'left': case 'right': return 'ew-resize';
    case 'top': case 'bottom': return 'ns-resize';
    case 'topLeft': case 'bottomRight': return 'nwse-resize';
    case 'topRight': case 'bottomLeft': return 'nesw-resize';
    case 'octaveUp': case 'octaveDown': return 'pointer';
    default: return 'default';
  }
}
