import type { BezierCurve, ParamCurve, ParamPoint, Vec2 } from '../types';
import { evaluateCubic, findTForX } from '../utils/bezier-math';

/** Default parameter value for a flat volume lane — matches the historical
 *  per-point default so migrated/new curves sound identical. */
export const DEFAULT_VOLUME = 0.8;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Create a parameter control point. Y is clamped to [0,1]. */
export function createParamPoint(x: number, y: number): ParamPoint {
  return { position: { x, y: clamp01(y) }, handleIn: null, handleOut: null };
}

/** A single-point flat curve holding a constant value across all time. */
export function createFlatParamCurve(beat: number, value: number): ParamCurve {
  return { points: [createParamPoint(beat, value)] };
}

/**
 * A two-point flat volume lane spanning [startBeat, endBeat] at a constant
 * value (straight segment, null handles → linear/flat sampling).
 */
export function createDefaultVolumeCurve(
  startBeat: number,
  endBeat: number,
  value: number = DEFAULT_VOLUME,
): ParamCurve {
  const v = clamp01(value);
  if (endBeat <= startBeat) return createFlatParamCurve(startBeat, v);
  return { points: [createParamPoint(startBeat, v), createParamPoint(endBeat, v)] };
}

/**
 * Get the four absolute Bezier control points for the segment between
 * points[i] and points[i+1] of a parameter curve.
 */
export function getParamSegmentControlPoints(
  curve: ParamCurve,
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

/**
 * Insert a point maintaining increasing-X order. Returns the insertion index.
 */
export function addParamPoint(curve: ParamCurve, point: ParamPoint): number {
  let idx = curve.points.length;
  for (let i = 0; i < curve.points.length; i++) {
    if (point.position.x < curve.points[i]!.position.x) { idx = i; break; }
  }
  curve.points.splice(idx, 0, point);
  return idx;
}

/** Remove a point by index. Callers must keep at least one point. */
export function removeParamPoint(curve: ParamCurve, index: number): void {
  if (curve.points.length <= 1) return;
  curve.points.splice(index, 1);
}

/** Move a point's anchor, clamping X between neighbors and Y to [0,1]. */
export function moveParamPoint(curve: ParamCurve, index: number, newPos: Vec2): void {
  const point = curve.points[index];
  if (!point) return;
  const prevX = index > 0 ? curve.points[index - 1]!.position.x + 0.001 : 0;
  const nextX = index < curve.points.length - 1
    ? curve.points[index + 1]!.position.x - 0.001
    : Infinity;
  point.position.x = Math.max(prevX, Math.min(nextX, newPos.x));
  point.position.y = clamp01(newPos.y);
}

/**
 * Set a control handle (relative to anchor), clamping its X so the cubic
 * segment stays monotonic in time (mirrors curve.ts setHandle). Y is left as-is;
 * evaluateParamAtBeat clamps the sampled value to [0,1].
 */
export function setParamHandle(
  curve: ParamCurve,
  index: number,
  which: 'in' | 'out',
  handle: Vec2 | null,
): void {
  const point = curve.points[index];
  if (!point) return;
  if (handle) {
    if (which === 'out') {
      const next = curve.points[index + 1];
      const maxX = next ? next.position.x - point.position.x : Infinity;
      handle = { x: Math.max(0, Math.min(maxX, handle.x)), y: handle.y };
    } else {
      const prev = curve.points[index - 1];
      const minX = prev ? prev.position.x - point.position.x : -Infinity;
      handle = { x: Math.min(0, Math.max(minX, handle.x)), y: handle.y };
    }
  }
  if (which === 'in') point.handleIn = handle;
  else point.handleOut = handle;
}

/**
 * Re-clamp all handles affected by the point at `index` changing position
 * (inserted or moved): the point's own in/out handles against its neighbors,
 * the previous point's handleOut, and the next point's handleIn. Re-running
 * setParamHandle trims any handle that now overshoots a neighbor anchor (which
 * would otherwise produce a backwards-flowing segment). Mirrors curve.ts
 * reclampHandlesAround. Null handles stay null.
 */
export function reclampParamHandlesAround(curve: ParamCurve, index: number): void {
  const pt = curve.points[index];
  if (!pt) return;
  if (pt.handleIn) setParamHandle(curve, index, 'in', pt.handleIn);
  if (pt.handleOut) setParamHandle(curve, index, 'out', pt.handleOut);
  const prev = curve.points[index - 1];
  if (prev?.handleOut) setParamHandle(curve, index - 1, 'out', prev.handleOut);
  const next = curve.points[index + 1];
  if (next?.handleIn) setParamHandle(curve, index + 1, 'in', next.handleIn);
}

/**
 * Apply horizontal auto-smooth handles at a point, sized at `ratio` of the
 * neighbor segment X lengths (mirrors curve.ts applyAutoSmoothHandles). Gives a
 * smooth curve through the point.
 */
export function applyAutoSmoothParamHandles(curve: ParamCurve, index: number, ratio: number): void {
  const pt = curve.points[index];
  if (!pt) return;
  const prev = curve.points[index - 1];
  const next = curve.points[index + 1];
  if (prev) {
    const lenBack = pt.position.x - prev.position.x;
    if (lenBack > 0) setParamHandle(curve, index, 'in', { x: -ratio * lenBack, y: 0 });
  }
  if (next) {
    const lenFwd = next.position.x - pt.position.x;
    if (lenFwd > 0) setParamHandle(curve, index, 'out', { x: ratio * lenFwd, y: 0 });
  }
}

/**
 * Evaluate the parameter value at a given beat.
 * - Before the first point or after the last: constant-hold (extrapolate flat).
 * - Single-point curve: returns that point's value everywhere.
 * - Otherwise: find the spanning segment and solve t for X via binary search.
 */
export function evaluateParamAtBeat(curve: ParamCurve, beat: number): number {
  const pts = curve.points;
  if (pts.length === 0) return DEFAULT_VOLUME;
  const first = pts[0]!;
  if (pts.length === 1 || beat <= first.position.x) return first.position.y;
  const last = pts[pts.length - 1]!;
  if (beat >= last.position.x) return last.position.y;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (beat < a.position.x || beat > b.position.x) continue;
    const seg = getParamSegmentControlPoints(curve, i);
    if (!seg) continue;
    const t = findTForX(seg.p0, seg.p1, seg.p2, seg.p3, beat);
    return clamp01(evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, t).y);
  }
  return last.position.y;
}

/** Deep copy a parameter curve. */
export function deepCopyParamCurve(curve: ParamCurve): ParamCurve {
  return {
    points: curve.points.map(pt => ({
      position: { ...pt.position },
      handleIn: pt.handleIn ? { ...pt.handleIn } : null,
      handleOut: pt.handleOut ? { ...pt.handleOut } : null,
    })),
  };
}

/** Deep copy a full CurveParameters bag (or undefined). */
export function deepCopyParameters(
  params: { volume?: ParamCurve } | undefined,
): { volume?: ParamCurve } | undefined {
  if (!params) return undefined;
  const out: { volume?: ParamCurve } = {};
  if (params.volume) out.volume = deepCopyParamCurve(params.volume);
  return out;
}

/**
 * Shift every lane point's X (beat) by `dx`, in place. Used when a curve is
 * moved in time (paste/duplicate/continue/alt-drag) so its parameter envelope
 * stays aligned with the pitch curve. Parameter VALUE (Y) is unaffected.
 */
export function offsetParametersX(
  params: { volume?: ParamCurve } | undefined,
  dx: number,
): void {
  if (!params?.volume || dx === 0) return;
  for (const p of params.volume.points) p.position.x += dx;
}

/**
 * Ensure a curve has a default volume lane once it spans a real time range
 * (>= 2 points). No-op if a volume lane already exists or the curve is too
 * short to have a span.
 */
export function ensureVolumeParam(curve: BezierCurve, value: number = DEFAULT_VOLUME): void {
  if (curve.points.length < 2) return;
  if (curve.parameters?.volume) return;
  const start = curve.points[0]!.position.x;
  const end = curve.points[curve.points.length - 1]!.position.x;
  curve.parameters = { ...curve.parameters, volume: createDefaultVolumeCurve(start, end, value) };
}

/**
 * Split a curve's parameter lanes at a beat. Returns the left/right CurveParameters
 * (or undefined when the source has no parameters). Each side keeps its in-range
 * points plus a synthesized boundary point at the split beat (value held from the
 * source lane), so the audible envelope is unchanged across the cut.
 */
export function splitParametersAtBeat(
  params: { volume?: ParamCurve } | undefined,
  splitBeat: number,
): { left?: { volume?: ParamCurve }; right?: { volume?: ParamCurve } } {
  if (!params) return {};
  const splitLane = (lane: ParamCurve): { left: ParamCurve; right: ParamCurve } => {
    const boundaryValue = evaluateParamAtBeat(lane, splitBeat);
    const leftPts: ParamPoint[] = [];
    const rightPts: ParamPoint[] = [];
    for (const pt of lane.points) {
      if (pt.position.x < splitBeat - 1e-9) {
        leftPts.push({ position: { ...pt.position }, handleIn: pt.handleIn ? { ...pt.handleIn } : null, handleOut: null });
      } else if (pt.position.x > splitBeat + 1e-9) {
        rightPts.push({ position: { ...pt.position }, handleIn: null, handleOut: pt.handleOut ? { ...pt.handleOut } : null });
      }
    }
    leftPts.push(createParamPoint(splitBeat, boundaryValue));
    rightPts.unshift(createParamPoint(splitBeat, boundaryValue));
    return { left: { points: leftPts }, right: { points: rightPts } };
  };

  const left: { volume?: ParamCurve } = {};
  const right: { volume?: ParamCurve } = {};
  if (params.volume) {
    const s = splitLane(params.volume);
    left.volume = s.left;
    right.volume = s.right;
  }
  return { left, right };
}

/**
 * Concatenate two parameter bags in time order (used when joining curves).
 * Coincident-X boundary points are averaged. Missing lanes are filled by holding
 * the other side's nearest value so the merged lane stays continuous.
 */
export function concatParameters(
  a: { volume?: ParamCurve } | undefined,
  b: { volume?: ParamCurve } | undefined,
): { volume?: ParamCurve } | undefined {
  if (!a && !b) return undefined;
  const mergeLane = (la?: ParamCurve, lb?: ParamCurve): ParamCurve | undefined => {
    if (!la && !lb) return undefined;
    if (!la) return deepCopyParamCurve(lb!);
    if (!lb) return deepCopyParamCurve(la!);
    const pts: ParamPoint[] = la.points.map(p => ({
      position: { ...p.position },
      handleIn: p.handleIn ? { ...p.handleIn } : null,
      handleOut: p.handleOut ? { ...p.handleOut } : null,
    }));
    for (const p of lb.points) {
      const tail = pts[pts.length - 1];
      if (tail && Math.abs(tail.position.x - p.position.x) < 1e-6) {
        tail.position.y = clamp01((tail.position.y + p.position.y) / 2);
        tail.handleOut = p.handleOut ? { ...p.handleOut } : null;
      } else if (!tail || p.position.x > tail.position.x) {
        pts.push({
          position: { ...p.position },
          handleIn: p.handleIn ? { ...p.handleIn } : null,
          handleOut: p.handleOut ? { ...p.handleOut } : null,
        });
      }
    }
    return { points: pts };
  };
  const out: { volume?: ParamCurve } = {};
  const vol = mergeLane(a?.volume, b?.volume);
  if (vol) out.volume = vol;
  return out;
}
