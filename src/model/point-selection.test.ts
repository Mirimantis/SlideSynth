import { describe, it, expect } from 'vitest';
import {
  NO_POINTS, pointSelectionOf, pointCount, hasPoint, pointRefs, onlyPoint,
  addPoints, togglePoint, withoutCurves,
} from './point-selection';

const a0 = { curveId: 'a', index: 0 };
const a2 = { curveId: 'a', index: 2 };
const b1 = { curveId: 'b', index: 1 };

describe('PointSelection (BACKLOG 15.2)', () => {
  it('groups points by curve and collapses duplicates', () => {
    const sel = pointSelectionOf([a0, a2, b1, a0]);
    expect(pointCount(sel)).toBe(3);
    expect(sel.size).toBe(2);
    expect([...sel.get('a')!]).toEqual([0, 2]);
    expect(pointRefs(sel)).toEqual([a0, a2, b1]);
  });

  it('answers membership without string parsing — curve ids may contain colons', () => {
    const odd = { curveId: 'c:1:x', index: 3 };
    const sel = pointSelectionOf([odd]);
    expect(hasPoint(sel, odd)).toBe(true);
    expect(hasPoint(sel, { curveId: 'c:1', index: 3 })).toBe(false);
  });

  it('onlyPoint is the single selected point, else null', () => {
    expect(onlyPoint(NO_POINTS)).toBeNull();
    expect(onlyPoint(pointSelectionOf([b1]))).toEqual(b1);
    expect(onlyPoint(pointSelectionOf([a0, a2]))).toBeNull();
    expect(onlyPoint(pointSelectionOf([a0, b1]))).toBeNull();
  });

  it('toggle adds and removes, and never leaves an empty per-curve set', () => {
    let sel = togglePoint(NO_POINTS, a0);
    expect(hasPoint(sel, a0)).toBe(true);
    sel = togglePoint(sel, b1);
    sel = togglePoint(sel, a0);
    expect(hasPoint(sel, a0)).toBe(false);
    expect(sel.has('a')).toBe(false);
    expect(pointCount(sel)).toBe(1);
  });

  it('never mutates the selection it was given', () => {
    const before = pointSelectionOf([a0]);
    addPoints(before, [b1]);
    togglePoint(before, a0);
    expect(pointRefs(before)).toEqual([a0]);
  });

  it('withoutCurves prunes whole curves and returns the same object when nothing changes', () => {
    const sel = pointSelectionOf([a0, a2, b1]);
    expect(pointRefs(withoutCurves(sel, new Set(['a'])))).toEqual([b1]);
    expect(withoutCurves(sel, new Set(['z']))).toBe(sel);
  });
});
