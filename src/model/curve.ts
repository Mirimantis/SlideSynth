import type { BezierCurve, LanePoint, Lane, Vec2, BoundingBox, TransformHandle } from '../types';
import { generateId } from './tone';
import { subdivideCubic, distToPoint } from '../utils/bezier-math';
import {
  createLane, createLanePoint, pitchLane, pitchPoints, getLane,
  setLaneHandle, addLanePoint, segmentControlPointsOf,
  deepCopyLanePoints, deepCopyLanes, splitLanesAtBeat, concatNonPitchLanes,
  smoothLaneHandles, sharpenLaneHandles,
} from './lane';
import { AUTO_SMOOTH_X_RATIO } from '../constants';

// The functions here are the PITCH-LANE view of a curve: the main canvas edits
// the mandatory pitch lane (lanes[0]) through these curve-level wrappers, while
// generic per-lane point math lives in lane.ts. Cross-lane operations (split,
// join, transform) coordinate the pitch lane with the rest.

/** Create a new curve with an empty pitch lane. */
export function createCurve(): BezierCurve {
  return { id: generateId('curve'), lanes: [createLane('pitch')] };
}

/** Create a control point (pitch-lane point). */
export function createControlPoint(x: number, y: number): LanePoint {
  return createLanePoint(x, y);
}

/**
 * Add a point to the curve's pitch lane, maintaining left-to-right
 * (increasing X) order. Returns the index where the point was inserted.
 */
export function addPointToCurve(curve: BezierCurve, point: LanePoint): number {
  return addLanePoint(pitchLane(curve), point);
}

/** Remove a pitch point by index. (Raw splice — the canvas owns the "curve
 *  with < 2 points gets deleted" policy, so no minPoints guard here.) */
export function removePointFromCurve(curve: BezierCurve, index: number): void {
  pitchPoints(curve).splice(index, 1);
}

/** Move a pitch point's anchor, clamping X to maintain monotonic order. */
export function movePoint(curve: BezierCurve, index: number, newPos: Vec2): void {
  const points = pitchPoints(curve);
  const point = points[index];
  if (!point) return;

  // Clamp X between neighbors to maintain ordering
  const prevX = index > 0 ? points[index - 1]!.position.x + 0.001 : 0;
  const nextX = index < points.length - 1
    ? points[index + 1]!.position.x - 0.001
    : Infinity;

  point.position.x = Math.max(prevX, Math.min(nextX, newPos.x));
  point.position.y = newPos.y;
}

/**
 * Set a pitch-point control handle (relative to anchor), clamping X so the
 * cubic Bezier segment stays monotonic in time.
 */
export function setHandle(
  curve: BezierCurve,
  index: number,
  which: 'in' | 'out',
  handle: Vec2 | null,
): void {
  setLaneHandle(pitchLane(curve), index, which, handle);
}

/**
 * Re-clamp all handles affected by a point at `index` changing position:
 * the point's own in/out handles against its neighbors, the previous point's
 * handleOut, and the next point's handleIn. Null handles stay null.
 */
export function reclampHandlesAround(curve: BezierCurve, index: number): void {
  const lane = pitchLane(curve);
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
 * Apply horizontal auto-smooth handles at a pitch point, sized at `ratio` of
 * neighbor segment X lengths (default AUTO_SMOOTH_X_RATIO). Does nothing for
 * the first point (no previous segment). handleOut falls back to the same
 * length as handleIn when no next point exists.
 */
export function applyAutoSmoothHandles(curve: BezierCurve, index: number, ratio: number = AUTO_SMOOTH_X_RATIO): void {
  const lane = pitchLane(curve);
  const pt = lane.points[index];
  if (!pt || index === 0) return;
  const prev = lane.points[index - 1];
  if (!prev) return;

  const segmentLenBack = pt.position.x - prev.position.x;
  if (segmentLenBack <= 0) return;

  setLaneHandle(lane, index, 'in', { x: -ratio * segmentLenBack, y: 0 });

  const next = lane.points[index + 1];
  const segmentLenForward = next ? next.position.x - pt.position.x : segmentLenBack;
  if (segmentLenForward > 0) {
    setLaneHandle(lane, index, 'out', { x: ratio * segmentLenForward, y: 0 });
  }
}

/**
 * Smooth every point of a curve's pitch lane by re-applying auto-smooth
 * handles at the given `ratio` (default AUTO_SMOOTH_X_RATIO). Used by the
 * Smooth Curve action.
 */
export function smoothCurveHandles(curve: BezierCurve, ratio: number = AUTO_SMOOTH_X_RATIO): void {
  smoothLaneHandles(pitchLane(curve), ratio);
}

/**
 * Clear all Bezier handles on every pitch point, making every point sharp.
 * Used by the Sharpen Curve action.
 */
export function sharpenCurveHandles(curve: BezierCurve): void {
  sharpenLaneHandles(pitchLane(curve));
}

/**
 * Get the four Bezier control points for a pitch segment between
 * points[i] and points[i+1]. Returns absolute coordinates.
 */
export function getSegmentControlPoints(
  curve: BezierCurve,
  segmentIndex: number,
): { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 } | null {
  return segmentControlPointsOf(pitchPoints(curve), segmentIndex);
}

/**
 * Split a curve into two at a given pitch segment and parameter t.
 * Returns two new curves whose visual shape is identical to the original.
 * Non-pitch lanes are split at the same beat so each half keeps its envelope.
 */
export function splitCurveAtSegment(
  curve: BezierCurve,
  segmentIndex: number,
  t: number,
): { left: BezierCurve; right: BezierCurve } {
  const points = pitchPoints(curve);
  const seg = getSegmentControlPoints(curve, segmentIndex)!;
  const [L0, L1, L2, L3, _R0, R1, R2, R3] = subdivideCubic(seg.p0, seg.p1, seg.p2, seg.p3, t);

  // Left curve: points[0..segmentIndex] + split point
  const left = createCurve();
  pitchLane(left).points = deepCopyLanePoints(points.slice(0, segmentIndex + 1));
  // Adjust the last copied point's handleOut to match the subdivision
  const leftPts = pitchPoints(left);
  const lastLeft = leftPts[leftPts.length - 1]!;
  lastLeft.handleOut = { x: L1.x - L0.x, y: L1.y - L0.y };
  // Append the split point
  leftPts.push({
    position: { x: L3.x, y: L3.y },
    handleIn: { x: L2.x - L3.x, y: L2.y - L3.y },
    handleOut: null,
  });

  // Right curve: split point + points[segmentIndex+1..end]
  const right = createCurve();
  pitchLane(right).points = [
    {
      position: { x: L3.x, y: L3.y }, // same split point, fresh copy
      handleIn: null,
      handleOut: { x: R1.x - L3.x, y: R1.y - L3.y },
    },
    ...deepCopyLanePoints(points.slice(segmentIndex + 1)),
  ];
  // Adjust the first original point's handleIn to match the subdivision
  pitchPoints(right)[1]!.handleIn = { x: R2.x - R3.x, y: R2.y - R3.y };

  // Split the non-pitch lanes at the split beat so each half keeps its envelope.
  applyLaneSplit(curve, left, right, L3.x);
  inheritGrouping(curve, left, right);

  return { left, right };
}

/**
 * Split a curve at an existing pitch control point, duplicating the point
 * so it becomes the end of the left curve and the start of the right.
 * The point keeps its handleIn on the left side and handleOut on the right.
 */
export function splitCurveAtPoint(
  curve: BezierCurve,
  pointIndex: number,
): { left: BezierCurve; right: BezierCurve } {
  const points = pitchPoints(curve);

  const left = createCurve();
  pitchLane(left).points = deepCopyLanePoints(points.slice(0, pointIndex + 1));
  const leftPts = pitchPoints(left);
  leftPts[leftPts.length - 1]!.handleOut = null;

  const right = createCurve();
  pitchLane(right).points = deepCopyLanePoints(points.slice(pointIndex));
  pitchPoints(right)[0]!.handleIn = null;

  applyLaneSplit(curve, left, right, points[pointIndex]!.position.x);
  inheritGrouping(curve, left, right);

  return { left, right };
}

/** Split the source curve's non-pitch lanes at `splitBeat` onto left/right halves. */
function applyLaneSplit(
  source: BezierCurve, left: BezierCurve, right: BezierCurve, splitBeat: number,
): void {
  const { left: ll, right: rl } = splitLanesAtBeat(source.lanes, splitBeat);
  left.lanes.push(...ll);
  right.lanes.push(...rl);
}

/** Group inheritance: both halves inherit the parent's groupId/voiceIndex so a
 *  chord-cluster member that's been split keeps its cluster membership. */
function inheritGrouping(source: BezierCurve, left: BezierCurve, right: BezierCurve): void {
  if (source.groupId) {
    left.groupId = source.groupId;
    right.groupId = source.groupId;
  }
  if (source.voiceIndex !== undefined) {
    left.voiceIndex = source.voiceIndex;
    right.voiceIndex = source.voiceIndex;
  }
}

/**
 * Join multiple curves into one, sorted by time (first pitch point x).
 * Adjacent endpoints within `threshold` merge into a single point;
 * otherwise a new straight segment bridges the gap.
 */
export function joinCurves(
  curves: BezierCurve[],
  threshold: number,
): { merged: BezierCurve; consumedIds: Set<string> } {
  // Sort curves left-to-right by their first pitch point
  const sorted = [...curves].sort(
    (a, b) => pitchPoints(a)[0]!.position.x - pitchPoints(b)[0]!.position.x,
  );

  const merged = createCurve();
  pitchLane(merged).points = deepCopyLanePoints(pitchPoints(sorted[0]!));
  let mergedNonPitch: Lane[] = deepCopyLanes(sorted[0]!.lanes.filter(l => l.type !== 'pitch'));
  const consumedIds = new Set<string>([sorted[0]!.id]);

  for (let c = 1; c < sorted.length; c++) {
    const incoming = deepCopyLanePoints(pitchPoints(sorted[c]!));
    const mergedPts = pitchPoints(merged);
    const tail = mergedPts[mergedPts.length - 1]!;
    const head = incoming[0]!;

    // Skip curves whose start is behind the current end — would create backwards segments
    if (head.position.x < tail.position.x) continue;

    consumedIds.add(sorted[c]!.id);

    if (distToPoint(tail.position, head.position) <= threshold) {
      // Merge: average position, keep tail's handleIn, take head's handleOut
      tail.position.x = (tail.position.x + head.position.x) / 2;
      tail.position.y = (tail.position.y + head.position.y) / 2;
      tail.handleOut = head.handleOut;
      // Append remaining points (skip the merged head)
      for (let i = 1; i < incoming.length; i++) {
        mergedPts.push(incoming[i]!);
      }
    } else {
      // Gap: append all points — existing null handles create a straight segment
      for (const pt of incoming) {
        mergedPts.push(pt);
      }
    }
    mergedNonPitch = concatNonPitchLanes(mergedNonPitch, sorted[c]!.lanes.filter(l => l.type !== 'pitch'));
  }

  merged.lanes.push(...mergedNonPitch);
  return { merged, consumedIds };
}

// ── Transform Box helpers ──────────────────────────────────────

const BBOX_PAD_X = 0.15; // beats
const BBOX_PAD_Y = 30;   // cents

/** Compute axis-aligned bounding box from pitch anchor positions. */
export function computeCurveBBox(curve: BezierCurve): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of pitchPoints(curve)) {
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
    for (const pt of pitchPoints(curve)) {
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

/** Bounding box from a subset of pitch points within curves (multi-point
 *  Transform Box). Falls back to `computeMultiCurveBBox` if the subset maps
 *  to no valid points. */
export function computePointSubsetBBox(
  curves: BezierCurve[],
  pointIndicesPerCurve: Map<string, Set<number>>,
): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const curve of curves) {
    const indices = pointIndicesPerCurve.get(curve.id);
    if (!indices) continue;
    const points = pitchPoints(curve);
    for (const idx of indices) {
      const pt = points[idx];
      if (!pt) continue;
      any = true;
      if (pt.position.x < minX) minX = pt.position.x;
      if (pt.position.y < minY) minY = pt.position.y;
      if (pt.position.x > maxX) maxX = pt.position.x;
      if (pt.position.y > maxY) maxY = pt.position.y;
    }
  }
  if (!any) return computeMultiCurveBBox(curves);
  return {
    minX: minX - BBOX_PAD_X,
    minY: minY - BBOX_PAD_Y,
    maxX: maxX + BBOX_PAD_X,
    maxY: maxY + BBOX_PAD_Y,
  };
}

/** Sample captured during a glissandograph recording. `note` is pitch cents. */
export interface RecordedSample {
  beat: number;
  note: number;
  volume: number;
}

/** Perpendicular distance from p to line a-b, measured in anisotropic tolerance units. */
function anisotropicPerpDist(
  p: RecordedSample, a: RecordedSample, b: RecordedSample,
  tx: number, ty: number,
): number {
  const ax = a.beat / tx, ay = a.note / ty;
  const bx = b.beat / tx, by = b.note / ty;
  const px = p.beat / tx, py = p.note / ty;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
  const cross = dx * (py - ay) - dy * (px - ax);
  return Math.abs(cross) / Math.sqrt(lenSq);
}

/** Ramer-Douglas-Peucker simplification with anisotropic X/Y tolerances. */
function rdpSimplify(
  samples: RecordedSample[], toleranceBeats: number, toleranceCents: number,
): RecordedSample[] {
  if (samples.length <= 2) return [...samples];
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    const d = anisotropicPerpDist(samples[i]!, first, last, toleranceBeats, toleranceCents);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > 1) {
    const left = rdpSimplify(samples.slice(0, maxIdx + 1), toleranceBeats, toleranceCents);
    const right = rdpSimplify(samples.slice(maxIdx), toleranceBeats, toleranceCents);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Build an editable BezierCurve from glissandograph recording samples.
 * Runs RDP simplification with separate beat/cents tolerances, enforces
 * monotonic X (>= 0.001 apart), applies horizontal auto-smooth handles.
 * Returns null if the gesture was too short (< 0.05 beats) or yielded < 2 points.
 */
export function curveFromRecording(
  samples: RecordedSample[],
  toleranceBeats: number = 0.03,
  toleranceCents: number = 15,
): BezierCurve | null {
  if (samples.length < 2) return null;
  const duration = samples[samples.length - 1]!.beat - samples[0]!.beat;
  if (duration < 0.05) return null;

  const simplified = rdpSimplify(samples, toleranceBeats, toleranceCents);

  // Enforce monotonic X (drop points too close to their predecessor)
  const cleaned: RecordedSample[] = [];
  for (const s of simplified) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || s.beat - prev.beat >= 0.001) cleaned.push(s);
  }
  if (cleaned.length < 2) return null;

  const curve = createCurve();
  const points = pitchPoints(curve);
  for (const s of cleaned) {
    points.push({
      position: { x: s.beat, y: s.note },
      handleIn: null,
      handleOut: null,
    });
  }
  // applyAutoSmoothHandles handles indices >= 1; index 0 keeps null handles.
  for (let i = 1; i < points.length; i++) {
    applyAutoSmoothHandles(curve, i);
  }
  // Capture recorded volume as a lane spanning the gesture's start/end — NOT
  // one point per pitch-simplification sample. Volume's point density is
  // independent of pitch's (per-lane retention, per the lanes model): mirroring
  // the pitch curve's density made even a flat/near-constant volume look as
  // busy as a fast glissando. A future continuous dynamics-bus capture would
  // want its own independent simplification pass here; today's capture is a
  // single value per sample, so start/end is all there is to show anyway.
  const volumeLane = createLane('volume');
  const startVolume = Math.max(0, Math.min(1, cleaned[0]!.volume));
  const endVolume = Math.max(0, Math.min(1, cleaned[cleaned.length - 1]!.volume));
  volumeLane.points = [
    createLanePoint(cleaned[0]!.beat, startVolume),
    createLanePoint(cleaned[cleaned.length - 1]!.beat, endVolume),
  ];
  curve.lanes.push(volumeLane);
  return curve;
}

/** Deep copy an array of control points. */
export function deepCopyPoints(points: LanePoint[]): LanePoint[] {
  return deepCopyLanePoints(points);
}

/**
 * Apply a transform to all pitch points based on the original snapshot.
 * Mutates the pitch lane in place. Non-pitch lanes are untouched (their X
 * alignment is the caller's concern, matching historical behavior).
 *
 * If `pointIndices` is provided, only points whose index is in the set are
 * transformed; the rest stay at their snapshot positions.
 */
export function applyTransformToCurve(
  curve: BezierCurve,
  originalPoints: LanePoint[],
  bbox: BoundingBox,
  handle: TransformHandle,
  dragStart: Vec2,
  dragCurrent: Vec2,
  pointIndices?: Set<number> | null,
): void {
  const points = pitchPoints(curve);
  const dx = dragCurrent.x - dragStart.x;
  const dy = dragCurrent.y - dragStart.y;
  const filtered = pointIndices && pointIndices.size > 0;

  if (handle === 'translate') {
    for (let i = 0; i < points.length; i++) {
      const orig = originalPoints[i]!;
      const pt = points[i]!;
      if (filtered && !pointIndices!.has(i)) {
        // Untouched point: snap back to its snapshot (in case a previous frame moved it).
        pt.position.x = orig.position.x;
        pt.position.y = orig.position.y;
        continue;
      }
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

  for (let i = 0; i < points.length; i++) {
    const orig = originalPoints[i]!;
    const pt = points[i]!;
    if (filtered && !pointIndices!.has(i)) {
      // Untouched point: snap back to its snapshot.
      pt.position.x = orig.position.x;
      pt.position.y = orig.position.y;
      pt.handleIn = orig.handleIn ? { ...orig.handleIn } : null;
      pt.handleOut = orig.handleOut ? { ...orig.handleOut } : null;
      continue;
    }
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

// getLane re-export spares consumers a second import for the common
// "read the volume lane of this curve" pattern next to pitch ops.
export { pitchLane, pitchPoints, getLane };
