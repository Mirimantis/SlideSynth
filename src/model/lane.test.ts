import { describe, it, expect } from 'vitest';
import type { Lane } from '../types';
import {
  createLane, createLanePoint, createDefaultLane, clampToRange,
  addLanePoint, removeLanePoint, moveLanePoint, setLaneHandle,
  reclampLaneHandlesAround, applyAutoSmoothLaneHandles,
  evaluateLaneAtBeat, deepCopyLane, offsetLaneX,
  splitLanesAtBeat, concatLanes, getLane, ensureLane, pitchLane,
  DEFAULT_VOLUME, LANE_SPECS,
} from './lane';
import { createCurve, addPointToCurve, createControlPoint } from './curve';

function volumeLane(pts: Array<[number, number]>): Lane {
  const lane = createLane('volume');
  for (const [x, y] of pts) lane.points.push(createLanePoint(x, y));
  return lane;
}

describe('lane creation and domains', () => {
  it('createLane seeds unit/range from LANE_SPECS', () => {
    const v = createLane('volume');
    expect(v.unit).toBe('normalized');
    expect(v.range).toEqual([0, 1]);
    const p = createLane('pitch');
    expect(p.unit).toBe(LANE_SPECS.pitch.unit);
    expect(p.range).toEqual(LANE_SPECS.pitch.range);
  });

  it('createDefaultLane spans [start, end] at a flat clamped value', () => {
    const lane = createDefaultLane('volume', 1, 5, 1.7);
    expect(lane.points).toHaveLength(2);
    expect(lane.points.map(p => p.position.x)).toEqual([1, 5]);
    expect(lane.points.every(p => p.position.y === 1)).toBe(true); // clamped to range max
  });

  it('createDefaultLane collapses to a single point for an empty span', () => {
    const lane = createDefaultLane('volume', 2, 2);
    expect(lane.points).toHaveLength(1);
    expect(lane.points[0]!.position.y).toBe(DEFAULT_VOLUME);
  });

  it('clampToRange clamps to the lane range', () => {
    const lane = createLane('volume');
    expect(clampToRange(lane, -0.5)).toBe(0);
    expect(clampToRange(lane, 0.5)).toBe(0.5);
    expect(clampToRange(lane, 2)).toBe(1);
  });
});

describe('point insertion, removal, movement', () => {
  it('addLanePoint keeps increasing-X order and returns the index', () => {
    const lane = volumeLane([[0, 0.2], [4, 0.8]]);
    const idx = addLanePoint(lane, createLanePoint(2, 0.5));
    expect(idx).toBe(1);
    expect(lane.points.map(p => p.position.x)).toEqual([0, 2, 4]);
  });

  it('removeLanePoint respects the lane minimum point count', () => {
    const vol = volumeLane([[0, 0.5]]);
    removeLanePoint(vol, 0);           // volume minPoints = 1 → no-op
    expect(vol.points).toHaveLength(1);

    const vol2 = volumeLane([[0, 0.5], [2, 0.7]]);
    removeLanePoint(vol2, 1);
    expect(vol2.points).toHaveLength(1);
  });

  it('moveLanePoint clamps X between neighbors and Y to the range', () => {
    const lane = volumeLane([[0, 0.2], [2, 0.5], [4, 0.8]]);
    moveLanePoint(lane, 1, { x: 10, y: 3 });
    expect(lane.points[1]!.position.x).toBeCloseTo(4 - 0.001, 6);
    expect(lane.points[1]!.position.y).toBe(1);
    moveLanePoint(lane, 1, { x: -5, y: -1 });
    expect(lane.points[1]!.position.x).toBeCloseTo(0 + 0.001, 6);
    expect(lane.points[1]!.position.y).toBe(0);
  });
});

describe('handles', () => {
  it('setLaneHandle clamps handleOut X to [0, gap to next anchor]', () => {
    const lane = volumeLane([[0, 0.5], [2, 0.5]]);
    setLaneHandle(lane, 0, 'out', { x: 5, y: 0.1 });
    expect(lane.points[0]!.handleOut).toEqual({ x: 2, y: 0.1 });
    setLaneHandle(lane, 0, 'out', { x: -1, y: 0 });
    expect(lane.points[0]!.handleOut).toEqual({ x: 0, y: 0 });
  });

  it('setLaneHandle clamps handleIn X to [gap to prev anchor, 0]', () => {
    const lane = volumeLane([[0, 0.5], [2, 0.5]]);
    setLaneHandle(lane, 1, 'in', { x: -5, y: 0 });
    expect(lane.points[1]!.handleIn).toEqual({ x: -2, y: 0 });
    setLaneHandle(lane, 1, 'in', { x: 1, y: 0 });
    expect(lane.points[1]!.handleIn).toEqual({ x: 0, y: 0 });
  });

  it('reclampLaneHandlesAround trims neighbor handles that overshoot a new anchor', () => {
    const lane = volumeLane([[0, 0.5], [4, 0.5]]);
    setLaneHandle(lane, 0, 'out', { x: 3.5, y: 0 });
    const i = addLanePoint(lane, createLanePoint(2, 0.9));
    reclampLaneHandlesAround(lane, i);
    expect(lane.points[0]!.handleOut!.x).toBeLessThanOrEqual(2);
  });

  it('applyAutoSmoothLaneHandles sets horizontal handles from neighbor gaps', () => {
    const lane = volumeLane([[0, 0.2], [2, 0.8], [6, 0.4]]);
    applyAutoSmoothLaneHandles(lane, 1, 0.4);
    expect(lane.points[1]!.handleIn).toEqual({ x: -0.8, y: 0 });
    expect(lane.points[1]!.handleOut).toEqual({ x: 1.6, y: 0 });
  });
});

describe('evaluateLaneAtBeat', () => {
  it('constant-holds before the first and after the last point', () => {
    const lane = volumeLane([[1, 0.3], [3, 0.9]]);
    expect(evaluateLaneAtBeat(lane, 0)).toBe(0.3);
    expect(evaluateLaneAtBeat(lane, 10)).toBe(0.9);
  });

  it('single-point lane returns that value everywhere', () => {
    const lane = volumeLane([[2, 0.6]]);
    expect(evaluateLaneAtBeat(lane, 0)).toBe(0.6);
    expect(evaluateLaneAtBeat(lane, 5)).toBe(0.6);
  });

  it('interpolates linearly across a straight (null-handle) segment', () => {
    const lane = volumeLane([[0, 0], [4, 1]]);
    expect(evaluateLaneAtBeat(lane, 1)).toBeCloseTo(0.25, 4);
    expect(evaluateLaneAtBeat(lane, 2)).toBeCloseTo(0.5, 4);
    expect(evaluateLaneAtBeat(lane, 3)).toBeCloseTo(0.75, 4);
  });

  it('clamps sampled values to the lane range even when handles overshoot', () => {
    const lane = volumeLane([[0, 0.9], [2, 0.9]]);
    lane.points[0]!.handleOut = { x: 0.5, y: 0.9 };  // pushes cubic above 1
    lane.points[1]!.handleIn = { x: -0.5, y: 0.9 };
    expect(evaluateLaneAtBeat(lane, 1)).toBeLessThanOrEqual(1);
  });

  it('empty lane falls back to the lane-type default', () => {
    expect(evaluateLaneAtBeat(createLane('volume'), 0)).toBe(DEFAULT_VOLUME);
  });
});

describe('copy / offset', () => {
  it('deepCopyLane is a true deep copy', () => {
    const lane = volumeLane([[0, 0.5]]);
    setLaneHandle(lane, 0, 'out', { x: 0.5, y: 0 });
    const copy = deepCopyLane(lane);
    copy.points[0]!.position.y = 0.1;
    copy.points[0]!.handleOut!.x = 9;
    expect(lane.points[0]!.position.y).toBe(0.5);
    expect(lane.points[0]!.handleOut!.x).toBe(0.5);
  });

  it('offsetLaneX shifts X only', () => {
    const lane = volumeLane([[1, 0.5], [3, 0.7]]);
    offsetLaneX(lane, 2);
    expect(lane.points.map(p => p.position.x)).toEqual([3, 5]);
    expect(lane.points.map(p => p.position.y)).toEqual([0.5, 0.7]);
  });
});

describe('splitLanesAtBeat', () => {
  it('splits non-pitch lanes with a held boundary value on each side', () => {
    const lanes = [createLane('pitch'), volumeLane([[0, 0], [4, 1]])];
    const { left, right } = splitLanesAtBeat(lanes, 2);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    const l = left[0]!, r = right[0]!;
    expect(l.points[l.points.length - 1]!.position.x).toBe(2);
    expect(l.points[l.points.length - 1]!.position.y).toBeCloseTo(0.5, 4);
    expect(r.points[0]!.position.x).toBe(2);
    expect(r.points[0]!.position.y).toBeCloseTo(0.5, 4);
    // In-range originals preserved
    expect(l.points[0]!.position.x).toBe(0);
    expect(r.points[r.points.length - 1]!.position.x).toBe(4);
  });

  it('skips the pitch lane (curve.ts owns pitch subdivision)', () => {
    const pitch = createLane('pitch');
    pitch.points = [createLanePoint(0, 60), createLanePoint(4, 64)];
    const { left, right } = splitLanesAtBeat([pitch], 2);
    expect(left).toHaveLength(0);
    expect(right).toHaveLength(0);
  });
});

describe('concatLanes', () => {
  it('averages coincident boundary points and appends the rest', () => {
    const a = volumeLane([[0, 0.2], [2, 0.4]]);
    const b = volumeLane([[2, 0.8], [4, 1]]);
    const merged = concatLanes(a, b)!;
    expect(merged.points.map(p => p.position.x)).toEqual([0, 2, 4]);
    expect(merged.points[1]!.position.y).toBeCloseTo(0.6, 6);
  });

  it('returns a copy of the defined side when the other is missing', () => {
    const b = volumeLane([[2, 0.8]]);
    const merged = concatLanes(undefined, b)!;
    expect(merged.points).toHaveLength(1);
    merged.points[0]!.position.y = 0;
    expect(b.points[0]!.position.y).toBe(0.8);
    expect(concatLanes(undefined, undefined)).toBeUndefined();
  });
});

describe('curve-level lane accessors', () => {
  it('pitchLane returns lanes[0] and throws on a malformed curve', () => {
    const curve = createCurve();
    expect(pitchLane(curve).type).toBe('pitch');
    const broken = { id: 'x', lanes: [createLane('volume')] };
    expect(() => pitchLane(broken)).toThrow();
  });

  it('ensureLane seeds a flat default lane spanning the pitch extent', () => {
    const curve = createCurve();
    expect(ensureLane(curve, 'volume')).toBeUndefined(); // < 2 pitch points
    addPointToCurve(curve, createControlPoint(1, 60));
    addPointToCurve(curve, createControlPoint(5, 64));
    const lane = ensureLane(curve, 'volume')!;
    expect(lane.points.map(p => p.position.x)).toEqual([1, 5]);
    expect(lane.points.every(p => p.position.y === DEFAULT_VOLUME)).toBe(true);
    // Idempotent: second call returns the same lane
    expect(ensureLane(curve, 'volume')).toBe(lane);
    expect(getLane(curve, 'volume')).toBe(lane);
  });
});
