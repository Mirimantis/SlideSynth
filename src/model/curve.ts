import type { BezierCurve, ControlPoint, Vec2, BoundingBox, TransformHandle } from '../types';
import { generateId } from './tone';

/** Create a new empty curve. */
export function createCurve(): BezierCurve {
  return { id: generateId('curve'), points: [] };
}

/** Create a control point. */
export function createControlPoint(
  x: number,
  y: number,
  volume: number = 0.8,
): ControlPoint {
  return {
    position: { x, y },
    handleIn: null,
    handleOut: null,
    volume,
  };
}

/**
 * Add a point to a curve, maintaining left-to-right (increasing X) order.
 * Returns the index where the point was inserted.
 */
export function addPointToCurve(curve: BezierCurve, point: ControlPoint): number {
  // Find insertion index
  let idx = curve.points.length;
  for (let i = 0; i < curve.points.length; i++) {
    if (point.position.x < curve.points[i]!.position.x) {
      idx = i;
      break;
    }
  }
  curve.points.splice(idx, 0, point);
  return idx;
}

/** Remove a point by index. */
export function removePointFromCurve(curve: BezierCurve, index: number): void {
  curve.points.splice(index, 1);
}

/** Move a control point's anchor, clamping X to maintain monotonic order. */
export function movePoint(curve: BezierCurve, index: number, newPos: Vec2): void {
  const point = curve.points[index];
  if (!point) return;

  // Clamp X between neighbors to maintain ordering
  const prevX = index > 0 ? curve.points[index - 1]!.position.x + 0.001 : 0;
  const nextX = index < curve.points.length - 1
    ? curve.points[index + 1]!.position.x - 0.001
    : Infinity;

  point.position.x = Math.max(prevX, Math.min(nextX, newPos.x));
  point.position.y = newPos.y;
}

/** Set a control handle (relative to anchor). */
export function setHandle(
  curve: BezierCurve,
  index: number,
  which: 'in' | 'out',
  handle: Vec2 | null,
): void {
  const point = curve.points[index];
  if (!point) return;

  if (which === 'in') {
    point.handleIn = handle;
  } else {
    point.handleOut = handle;
  }
}

/** Set volume at a control point. */
export function setPointVolume(curve: BezierCurve, index: number, volume: number): void {
  const point = curve.points[index];
  if (!point) return;
  point.volume = Math.max(0, Math.min(1, volume));
}

/**
 * Get the four Bezier control points for a segment between points[i] and points[i+1].
 * Returns absolute coordinates.
 */
export function getSegmentControlPoints(
  curve: BezierCurve,
  segmentIndex: number,
): { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 } | null {
  const a = curve.points[segmentIndex];
  const b = curve.points[segmentIndex + 1];
  if (!a || !b) return null;

  const p0 = a.position;
  const p3 = b.position;

  const p1: Vec2 = a.handleOut
    ? { x: a.position.x + a.handleOut.x, y: a.position.y + a.handleOut.y }
    : p0;

  const p2: Vec2 = b.handleIn
    ? { x: b.position.x + b.handleIn.x, y: b.position.y + b.handleIn.y }
    : p3;

  return { p0, p1, p2, p3 };
}

// ── Transform Box helpers ──────────────────────────────────────

const BBOX_PAD_X = 0.15; // beats
const BBOX_PAD_Y = 0.3;  // semitones

/** Compute axis-aligned bounding box from anchor positions. */
export function computeCurveBBox(curve: BezierCurve): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of curve.points) {
    if (pt.position.x < minX) minX = pt.position.x;
    if (pt.position.y < minY) minY = pt.position.y;
    if (pt.position.x > maxX) maxX = pt.position.x;
    if (pt.position.y > maxY) maxY = pt.position.y;
  }
  return {
    minX: minX - BBOX_PAD_X,
    minY: minY - BBOX_PAD_Y,
    maxX: maxX + BBOX_PAD_X,
    maxY: maxY + BBOX_PAD_Y,
  };
}

/** Compute axis-aligned bounding box across multiple curves. */
export function computeMultiCurveBBox(curves: BezierCurve[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const curve of curves) {
    for (const pt of curve.points) {
      if (pt.position.x < minX) minX = pt.position.x;
      if (pt.position.y < minY) minY = pt.position.y;
      if (pt.position.x > maxX) maxX = pt.position.x;
      if (pt.position.y > maxY) maxY = pt.position.y;
    }
  }
  return {
    minX: minX - BBOX_PAD_X,
    minY: minY - BBOX_PAD_Y,
    maxX: maxX + BBOX_PAD_X,
    maxY: maxY + BBOX_PAD_Y,
  };
}

/** Deep copy an array of control points. */
export function deepCopyPoints(points: ControlPoint[]): ControlPoint[] {
  return points.map(pt => ({
    position: { ...pt.position },
    handleIn: pt.handleIn ? { ...pt.handleIn } : null,
    handleOut: pt.handleOut ? { ...pt.handleOut } : null,
    volume: pt.volume,
  }));
}

/**
 * Apply a transform to all curve points based on the original snapshot.
 * Mutates curve.points in place.
 */
export function applyTransformToCurve(
  curve: BezierCurve,
  originalPoints: ControlPoint[],
  bbox: BoundingBox,
  handle: TransformHandle,
  dragStart: Vec2,
  dragCurrent: Vec2,
): void {
  const dx = dragCurrent.x - dragStart.x;
  const dy = dragCurrent.y - dragStart.y;

  if (handle === 'translate') {
    for (let i = 0; i < curve.points.length; i++) {
      const orig = originalPoints[i]!;
      const pt = curve.points[i]!;
      pt.position.x = orig.position.x + dx;
      pt.position.y = orig.position.y + dy;
      // Handles are relative — unchanged during translation
    }
    return;
  }

  // Compute scale factors based on which handle is being dragged
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  let scaleX = 1;
  let scaleY = 1;
  let anchorX = bbox.minX;
  let anchorY = bbox.minY;

  // X scaling
  if (handle === 'right' || handle === 'topRight' || handle === 'bottomRight') {
    anchorX = bbox.minX;
    scaleX = bw > 0.001 ? (bw + dx) / bw : 1;
  } else if (handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft') {
    anchorX = bbox.maxX;
    scaleX = bw > 0.001 ? (bw - dx) / bw : 1;
  }

  // Y scaling
  if (handle === 'top' || handle === 'topLeft' || handle === 'topRight') {
    anchorY = bbox.minY;
    scaleY = bh > 0.001 ? (bh + dy) / bh : 1;
  } else if (handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight') {
    anchorY = bbox.maxY;
    scaleY = bh > 0.001 ? (bh - dy) / bh : 1;
  }

  for (let i = 0; i < curve.points.length; i++) {
    const orig = originalPoints[i]!;
    const pt = curve.points[i]!;
    pt.position.x = anchorX + (orig.position.x - anchorX) * scaleX;
    pt.position.y = anchorY + (orig.position.y - anchorY) * scaleY;
    if (orig.handleIn) {
      pt.handleIn = { x: orig.handleIn.x * scaleX, y: orig.handleIn.y * scaleY };
    }
    if (orig.handleOut) {
      pt.handleOut = { x: orig.handleOut.x * scaleX, y: orig.handleOut.y * scaleY };
    }
  }
}
