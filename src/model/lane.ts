import type { BezierCurve, Lane, LanePoint, LaneType, Vec2 } from '../types';
import { evaluateCubic, findTForX } from '../utils/bezier-math';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';

/** Default volume for a flat volume lane — matches the historical per-point
 *  default so migrated/new curves sound identical. */
export const DEFAULT_VOLUME = 0.8;

/** Code-side registry of lane domains (not persisted — the persisted Lane
 *  carries its own unit/range so files stay self-describing). */
export const LANE_SPECS: Record<LaneType, {
  unit: Lane['unit'];
  range: [number, number];
  minPoints: number;
  /** Sampled value when a lane has no points (pitch lanes can't be empty by invariant). */
  emptyValue: number;
}> = {
  pitch:  { unit: 'cents',      range: [MIN_PITCH_CENTS, MAX_PITCH_CENTS], minPoints: 2, emptyValue: MIN_PITCH_CENTS },
  volume: { unit: 'normalized', range: [0, 1],                             minPoints: 1, emptyValue: DEFAULT_VOLUME },
};

/** Create an empty lane of the given type with its registry domain. */
export function createLane(type: LaneType): Lane {
  const spec = LANE_SPECS[type];
  return { type, unit: spec.unit, range: [spec.range[0], spec.range[1]], points: [] };
}

// ── Curve-level lane accessors ─────────────────────────────────

/** The mandatory pitch lane (lanes[0] by invariant). */
export function pitchLane(curve: BezierCurve): Lane {
  const lane = curve.lanes[0];
  if (!lane || lane.type !== 'pitch') {
    throw new Error(`BezierCurve ${curve.id}: lanes[0] is not the pitch lane`);
  }
  return lane;
}

/** Shorthand for the pitch lane's points — the canvas's working array. */
export function pitchPoints(curve: BezierCurve): LanePoint[] {
  return pitchLane(curve).points;
}

/** Find a lane by type, or undefined. */
export function getLane(curve: BezierCurve, type: LaneType): Lane | undefined {
  return curve.lanes.find(l => l.type === type);
}

/**
 * Ensure a curve has a lane of the given type once its pitch lane spans a real
 * time range (>= 2 points), seeding a flat default across that span. No-op if
 * the lane already exists. Returns the lane (or undefined if the curve is too
 * short to have a span).
 */
export function ensureLane(curve: BezierCurve, type: LaneType, value?: number): Lane | undefined {
  const existing = getLane(curve, type);
  if (existing) return existing;
  const pts = pitchPoints(curve);
  if (pts.length < 2) return undefined;
  const start = pts[0]!.position.x;
  const end = pts[pts.length - 1]!.position.x;
  const lane = createDefaultLane(type, start, end, value);
  curve.lanes.push(lane);
  return lane;
}

/**
 * A lane spanning [startBeat, endBeat] at a constant value (straight segment,
 * null handles → flat sampling). Collapses to a single point when the span is
 * empty. Default value: DEFAULT_VOLUME for volume, range floor otherwise.
 */
export function createDefaultLane(
  type: LaneType,
  startBeat: number,
  endBeat: number,
  value?: number,
): Lane {
  const lane = createLane(type);
  const v = clampToRange(lane, value ?? LANE_SPECS[type].emptyValue);
  lane.points = endBeat <= startBeat
    ? [createLanePoint(startBeat, v)]
    : [createLanePoint(startBeat, v), createLanePoint(endBeat, v)];
  return lane;
}

// ── Point primitives ───────────────────────────────────────────

/** Create a lane point (no domain clamp — see clampToRange / moveLanePoint). */
export function createLanePoint(x: number, y: number): LanePoint {
  return { position: { x, y }, handleIn: null, handleOut: null };
}

/** Clamp a Y value to the lane's value-domain. */
export function clampToRange(lane: Lane, y: number): number {
  return Math.max(lane.range[0], Math.min(lane.range[1], y));
}

/** Insert a point maintaining increasing-X order. Returns the insertion index. */
export function addLanePoint(lane: Lane, point: LanePoint): number {
  let idx = lane.points.length;
  for (let i = 0; i < lane.points.length; i++) {
    if (point.position.x < lane.points[i]!.position.x) { idx = i; break; }
  }
  lane.points.splice(idx, 0, point);
  return idx;
}

/** Remove a point by index, respecting the lane type's minimum point count. */
export function removeLanePoint(lane: Lane, index: number): void {
  if (lane.points.length <= LANE_SPECS[lane.type].minPoints) return;
  lane.points.splice(index, 1);
}

/** Move a point's anchor, clamping X between neighbors and Y to the lane range. */
export function moveLanePoint(lane: Lane, index: number, newPos: Vec2): void {
  const point = lane.points[index];
  if (!point) return;
  const prevX = index > 0 ? lane.points[index - 1]!.position.x + 0.001 : 0;
  const nextX = index < lane.points.length - 1
    ? lane.points[index + 1]!.position.x - 0.001
    : Infinity;
  point.position.x = Math.max(prevX, Math.min(nextX, newPos.x));
  point.position.y = clampToRange(lane, newPos.y);
}

/**
 * Set a control handle (relative to anchor), clamping its X so the cubic
 * segment stays monotonic in time. Y is left as-is; sampling clamps values.
 *
 * - handleOut.x is clamped to [0, nextPoint.x - point.x]
 * - handleIn.x  is clamped to [prevPoint.x - point.x, 0]
 */
export function setLaneHandle(
  lane: Lane,
  index: number,
  which: 'in' | 'out',
  handle: Vec2 | null,
): void {
  const point = lane.points[index];
  if (!point) return;
  if (handle) {
    if (which === 'out') {
      const next = lane.points[index + 1];
      const maxX = next ? next.position.x - point.position.x : Infinity;
      handle = { x: Math.max(0, Math.min(maxX, handle.x)), y: handle.y };
    } else {
      const prev = lane.points[index - 1];
      const minX = prev ? prev.position.x - point.position.x : -Infinity;
      handle = { x: Math.min(0, Math.max(minX, handle.x)), y: handle.y };
    }
  }
  if (which === 'in') point.handleIn = handle;
  else point.handleOut = handle;
}

/**
 * Re-clamp all handles affected by the point at `index` changing position
 * (inserted, moved, etc.): the point's own in/out handles against its
 * neighbors, the previous point's handleOut, and the next point's handleIn.
 * Null handles stay null.
 */
export function reclampLaneHandlesAround(lane: Lane, index: number): void {
  const pt = lane.points[index];
  if (!pt) return;
  if (pt.handleIn) setLaneHandle(lane, index, 'in', pt.handleIn);
  if (pt.handleOut) setLaneHandle(lane, index, 'out', pt.handleOut);
  const prev = lane.points[index - 1];
  if (prev?.handleOut) setLaneHandle(lane, index - 1, 'out', prev.handleOut);
  const next = lane.points[index + 1];
  if (next?.handleIn) setLaneHandle(lane, index + 1, 'in', next.handleIn);
}

/**
 * Apply horizontal auto-smooth handles at a point, sized at `ratio` of the
 * neighbor segment X lengths. Sets handleIn from the previous segment and
 * handleOut from the next; when only one neighbor exists, only that side is
 * smoothed (curve-level helpers add their own first/last-point conventions).
 */
export function applyAutoSmoothLaneHandles(lane: Lane, index: number, ratio: number): void {
  const pt = lane.points[index];
  if (!pt) return;
  const prev = lane.points[index - 1];
  const next = lane.points[index + 1];
  if (prev) {
    const lenBack = pt.position.x - prev.position.x;
    if (lenBack > 0) setLaneHandle(lane, index, 'in', { x: -ratio * lenBack, y: 0 });
  }
  if (next) {
    const lenFwd = next.position.x - pt.position.x;
    if (lenFwd > 0) setLaneHandle(lane, index, 'out', { x: ratio * lenFwd, y: 0 });
  }
}

/**
 * Get the four absolute Bezier control points for the segment between
 * points[i] and points[i+1]. Null handles collapse to the anchors (straight
 * segment).
 */
export function getLaneSegmentControlPoints(
  lane: Lane,
  segmentIndex: number,
): { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 } | null {
  return segmentControlPointsOf(lane.points, segmentIndex);
}

/** Segment control points from a raw point array (shared by curve-level code
 *  that operates on snapshots rather than live lanes). */
export function segmentControlPointsOf(
  points: LanePoint[],
  segmentIndex: number,
): { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 } | null {
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
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
 * Evaluate the lane's value at a given beat.
 * - Before the first point or after the last: constant-hold.
 * - Single-point lane: that point's value everywhere.
 * - Otherwise: solve the spanning segment's t for X and clamp the sampled
 *   value to the lane range.
 */
export function evaluateLaneAtBeat(lane: Lane, beat: number): number {
  const pts = lane.points;
  if (pts.length === 0) return LANE_SPECS[lane.type].emptyValue;
  const first = pts[0]!;
  if (pts.length === 1 || beat <= first.position.x) return first.position.y;
  const last = pts[pts.length - 1]!;
  if (beat >= last.position.x) return last.position.y;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (beat < a.position.x || beat > b.position.x) continue;
    const seg = getLaneSegmentControlPoints(lane, i);
    if (!seg) continue;
    const t = findTForX(seg.p0, seg.p1, seg.p2, seg.p3, beat);
    return clampToRange(lane, evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, t).y);
  }
  return last.position.y;
}

/** Smooth every point of a lane with horizontal auto-smooth handles at `ratio`.
 *  First point gets only a handleOut; last point's handleOut falls back to the
 *  back-segment length (matching the historical Smooth Curve action). */
export function smoothLaneHandles(lane: Lane, ratio: number): void {
  const pts = lane.points;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]!;
    if (i === 0) {
      pt.handleIn = null;
      const next = pts[i + 1];
      const lenFwd = next ? next.position.x - pt.position.x : 0;
      if (lenFwd > 0) setLaneHandle(lane, i, 'out', { x: ratio * lenFwd, y: 0 });
      else pt.handleOut = null;
    } else if (i === pts.length - 1) {
      const prev = pts[i - 1]!;
      const lenBack = pt.position.x - prev.position.x;
      if (lenBack > 0) {
        setLaneHandle(lane, i, 'in', { x: -ratio * lenBack, y: 0 });
        setLaneHandle(lane, i, 'out', { x: ratio * lenBack, y: 0 });
      }
    } else {
      applyAutoSmoothLaneHandles(lane, i, ratio);
    }
  }
}

/** Clear all handles on every point, making every point sharp. */
export function sharpenLaneHandles(lane: Lane): void {
  for (const pt of lane.points) {
    pt.handleIn = null;
    pt.handleOut = null;
  }
}

// ── Copy / offset helpers ──────────────────────────────────────

/** Deep copy a point array. */
export function deepCopyLanePoints(points: LanePoint[]): LanePoint[] {
  return points.map(pt => ({
    position: { ...pt.position },
    handleIn: pt.handleIn ? { ...pt.handleIn } : null,
    handleOut: pt.handleOut ? { ...pt.handleOut } : null,
  }));
}

/** Deep copy a lane (gravity blob is copied by reference-free JSON clone). */
export function deepCopyLane(lane: Lane): Lane {
  const copy: Lane = {
    type: lane.type,
    unit: lane.unit,
    range: [lane.range[0], lane.range[1]],
    points: deepCopyLanePoints(lane.points),
  };
  if (lane.gravity !== undefined) copy.gravity = JSON.parse(JSON.stringify(lane.gravity));
  return copy;
}

/** Deep copy every lane of a curve. */
export function deepCopyLanes(lanes: Lane[]): Lane[] {
  return lanes.map(deepCopyLane);
}

/** Shift every point's X (beat) by `dx`, in place. */
export function offsetLaneX(lane: Lane, dx: number): void {
  if (dx === 0) return;
  for (const p of lane.points) p.position.x += dx;
}

/** Shift every lane of a curve in time (paste/duplicate/alt-drag). */
export function offsetLanesX(curve: BezierCurve, dx: number): void {
  for (const lane of curve.lanes) offsetLaneX(lane, dx);
}

// ── Split / concat (non-pitch lanes; pitch subdivision lives in curve.ts) ──

/**
 * Split every non-pitch lane at a beat onto left/right lane arrays. Each side
 * keeps its in-range points plus a synthesized boundary point at the split
 * beat (value held from the source), so the audible envelope is unchanged
 * across the cut.
 */
export function splitLanesAtBeat(
  lanes: Lane[],
  splitBeat: number,
): { left: Lane[]; right: Lane[] } {
  const left: Lane[] = [];
  const right: Lane[] = [];
  for (const lane of lanes) {
    if (lane.type === 'pitch') continue;
    const boundaryValue = evaluateLaneAtBeat(lane, splitBeat);
    const leftPts: LanePoint[] = [];
    const rightPts: LanePoint[] = [];
    for (const pt of lane.points) {
      if (pt.position.x < splitBeat - 1e-9) {
        leftPts.push({ position: { ...pt.position }, handleIn: pt.handleIn ? { ...pt.handleIn } : null, handleOut: null });
      } else if (pt.position.x > splitBeat + 1e-9) {
        rightPts.push({ position: { ...pt.position }, handleIn: null, handleOut: pt.handleOut ? { ...pt.handleOut } : null });
      }
    }
    leftPts.push(createLanePoint(splitBeat, boundaryValue));
    rightPts.unshift(createLanePoint(splitBeat, boundaryValue));
    left.push({ ...deepCopyLane(lane), points: leftPts });
    right.push({ ...deepCopyLane(lane), points: rightPts });
  }
  return { left, right };
}

/**
 * Concatenate two same-type lanes in time order (used when joining curves).
 * Coincident-X boundary points are averaged. Either side may be undefined.
 */
export function concatLanes(a: Lane | undefined, b: Lane | undefined): Lane | undefined {
  if (!a && !b) return undefined;
  if (!a) return deepCopyLane(b!);
  if (!b) return deepCopyLane(a);
  const merged = deepCopyLane(a);
  for (const p of b.points) {
    const tail = merged.points[merged.points.length - 1];
    if (tail && Math.abs(tail.position.x - p.position.x) < 1e-6) {
      tail.position.y = clampToRange(merged, (tail.position.y + p.position.y) / 2);
      tail.handleOut = p.handleOut ? { ...p.handleOut } : null;
    } else if (!tail || p.position.x > tail.position.x) {
      merged.points.push({
        position: { ...p.position },
        handleIn: p.handleIn ? { ...p.handleIn } : null,
        handleOut: p.handleOut ? { ...p.handleOut } : null,
      });
    }
  }
  return merged;
}

/**
 * Merge the non-pitch lanes of two curves' lane arrays in time order, pairing
 * lanes by type (used when joining curves; pitch merging lives in curve.ts).
 */
export function concatNonPitchLanes(a: Lane[], b: Lane[]): Lane[] {
  const types = new Set<LaneType>();
  for (const l of a) if (l.type !== 'pitch') types.add(l.type);
  for (const l of b) if (l.type !== 'pitch') types.add(l.type);
  const out: Lane[] = [];
  for (const type of types) {
    const merged = concatLanes(a.find(l => l.type === type), b.find(l => l.type === type));
    if (merged) out.push(merged);
  }
  return out;
}
