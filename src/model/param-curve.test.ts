import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOLUME,
  createParamPoint,
  createFlatParamCurve,
  createDefaultVolumeCurve,
  addParamPoint,
  removeParamPoint,
  moveParamPoint,
  evaluateParamAtBeat,
  splitParametersAtBeat,
  concatParameters,
  setParamHandle,
  reclampParamHandlesAround,
} from './param-curve';
import type { ParamCurve } from '../types';

describe('createParamPoint', () => {
  it('clamps Y to [0,1]', () => {
    expect(createParamPoint(0, 1.5).position.y).toBe(1);
    expect(createParamPoint(0, -0.2).position.y).toBe(0);
    expect(createParamPoint(3, 0.4).position).toEqual({ x: 3, y: 0.4 });
  });
});

describe('createDefaultVolumeCurve', () => {
  it('makes a two-point flat lane over a span', () => {
    const c = createDefaultVolumeCurve(2, 6);
    expect(c.points).toHaveLength(2);
    expect(c.points[0]!.position).toEqual({ x: 2, y: DEFAULT_VOLUME });
    expect(c.points[1]!.position).toEqual({ x: 6, y: DEFAULT_VOLUME });
  });
  it('collapses to a single point when span is empty', () => {
    expect(createDefaultVolumeCurve(4, 4).points).toHaveLength(1);
    expect(createDefaultVolumeCurve(5, 3).points).toHaveLength(1);
  });
});

describe('evaluateParamAtBeat', () => {
  it('single-point curve returns that value everywhere', () => {
    const c = createFlatParamCurve(3, 0.42);
    expect(evaluateParamAtBeat(c, -10)).toBeCloseTo(0.42);
    expect(evaluateParamAtBeat(c, 3)).toBeCloseTo(0.42);
    expect(evaluateParamAtBeat(c, 99)).toBeCloseTo(0.42);
  });
  it('constant-holds before first and after last point', () => {
    const c: ParamCurve = { points: [createParamPoint(2, 0.2), createParamPoint(6, 0.8)] };
    expect(evaluateParamAtBeat(c, 0)).toBeCloseTo(0.2);   // before first
    expect(evaluateParamAtBeat(c, 10)).toBeCloseTo(0.8);  // after last
  });
  it('linearly interpolates a straight segment (matches old per-point interp)', () => {
    const c: ParamCurve = { points: [createParamPoint(0, 0), createParamPoint(4, 1)] };
    expect(evaluateParamAtBeat(c, 1)).toBeCloseTo(0.25, 4);
    expect(evaluateParamAtBeat(c, 2)).toBeCloseTo(0.5, 4);
    expect(evaluateParamAtBeat(c, 3)).toBeCloseTo(0.75, 4);
  });
});

describe('addParamPoint / removeParamPoint', () => {
  it('inserts maintaining increasing-X order', () => {
    const c: ParamCurve = { points: [createParamPoint(0, 0.5), createParamPoint(4, 0.5)] };
    const idx = addParamPoint(c, createParamPoint(2, 0.9));
    expect(idx).toBe(1);
    expect(c.points.map(p => p.position.x)).toEqual([0, 2, 4]);
  });
  it('removeParamPoint keeps at least one point', () => {
    const c = createFlatParamCurve(0, 0.5);
    removeParamPoint(c, 0);
    expect(c.points).toHaveLength(1);
  });
});

describe('moveParamPoint', () => {
  it('clamps X between neighbors and Y to [0,1]', () => {
    const c: ParamCurve = {
      points: [createParamPoint(0, 0.5), createParamPoint(2, 0.5), createParamPoint(4, 0.5)],
    };
    moveParamPoint(c, 1, { x: 99, y: 2 });   // X past right neighbor, Y over 1
    expect(c.points[1]!.position.x).toBeLessThan(4);
    expect(c.points[1]!.position.x).toBeGreaterThan(0);
    expect(c.points[1]!.position.y).toBe(1);
  });
});

describe('splitParametersAtBeat', () => {
  it('each half keeps the boundary value and is continuous', () => {
    const params = { volume: { points: [createParamPoint(0, 0), createParamPoint(4, 1)] } };
    const { left, right } = splitParametersAtBeat(params, 2);
    // boundary value at beat 2 is 0.5 on both sides
    expect(left!.volume!.points[left!.volume!.points.length - 1]!.position).toMatchObject({ x: 2 });
    expect(evaluateParamAtBeat(left!.volume!, 2)).toBeCloseTo(0.5, 4);
    expect(evaluateParamAtBeat(right!.volume!, 2)).toBeCloseTo(0.5, 4);
  });
});

describe('setParamHandle', () => {
  it('clamps handleOut X to the gap to the next anchor (no overshoot)', () => {
    const c: ParamCurve = { points: [createParamPoint(0, 0.5), createParamPoint(2, 0.5)] };
    setParamHandle(c, 0, 'out', { x: 10, y: 0.2 }); // gap is only 2
    expect(c.points[0]!.handleOut!.x).toBe(2);       // trimmed to the anchor
    expect(c.points[0]!.handleOut!.x).toBeGreaterThanOrEqual(0); // can't point backwards
  });
  it('clamps handleIn X to the gap to the previous anchor', () => {
    const c: ParamCurve = { points: [createParamPoint(0, 0.5), createParamPoint(2, 0.5)] };
    setParamHandle(c, 1, 'in', { x: -10, y: 0 }); // gap is 2 going back
    expect(c.points[1]!.handleIn!.x).toBe(-2);
    expect(c.points[1]!.handleIn!.x).toBeLessThanOrEqual(0);
  });
});

describe('reclampParamHandlesAround', () => {
  it('trims a neighbor handle that overshoots a newly inserted point', () => {
    // Two points far apart; the left one has a long handleOut.
    const c: ParamCurve = { points: [createParamPoint(0, 0.5), createParamPoint(10, 0.5)] };
    setParamHandle(c, 0, 'out', { x: 8, y: 0 }); // valid for the 0→10 gap
    // Insert a point close after the left one.
    const i = addParamPoint(c, createParamPoint(1, 0.5));
    expect(i).toBe(1);
    reclampParamHandlesAround(c, i);
    // The left point's handleOut must now be trimmed to <= the new 0→1 gap.
    expect(c.points[0]!.handleOut!.x).toBeLessThanOrEqual(1);
  });
});

describe('concatParameters', () => {
  it('joins two lanes in time order', () => {
    const a = { volume: { points: [createParamPoint(0, 0.2), createParamPoint(2, 0.4)] } };
    const b = { volume: { points: [createParamPoint(2, 0.4), createParamPoint(4, 0.9)] } };
    const merged = concatParameters(a, b);
    const xs = merged!.volume!.points.map(p => p.position.x);
    // strictly increasing, spans 0..4
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(4);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });
});
