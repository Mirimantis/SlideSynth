import type { BezierCurve, ControlPoint, Vec2 } from '../types';
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
