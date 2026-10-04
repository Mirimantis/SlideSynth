import { describe, it, expect } from 'vitest';
import {
  evaluateCubic, subdivideCubic, nearestPointOnCubic, nearestPointOnCubicScaled, findTForX, distToPoint,
} from './bezier-math';
import type { Vec2 } from '../types';

// Kernel tests (BACKLOG 15.8): curve evaluation every runtime must match.

const v = (x: number, y: number): Vec2 => ({ x, y });
/** A glide: 0 → 4 beats, 6000 → 6400 cents, eased at both ends. */
const S = [v(0, 6000), v(1.5, 6000), v(2.5, 6400), v(4, 6400)] as const;
const at = (t: number) => evaluateCubic(S[0], S[1], S[2], S[3], t);

describe('evaluateCubic', () => {
  it('starts and ends on the end points', () => {
    expect(at(0)).toEqual(v(0, 6000));
    expect(at(1)).toEqual(v(4, 6400));
  });

  it('is symmetric about the middle for a symmetric glide', () => {
    const mid = at(0.5);
    expect(mid.x).toBeCloseTo(2);
    expect(mid.y).toBeCloseTo(6200);
    expect(at(0.25).y - 6000).toBeCloseTo(6400 - at(0.75).y);
  });

  it('is a straight line when the handles sit on the end points', () => {
    for (const t of [0.1, 0.3, 0.7]) {
      const p = evaluateCubic(v(0, 6000), v(0, 6000), v(2, 6200), v(2, 6200), t);
      expect(p.y - 6000).toBeCloseTo((p.x / 2) * 200);
    }
  });
});

describe('subdivideCubic', () => {
  it('splits into two halves that trace the same curve', () => {
    const [a0, a1, a2, a3, b0, b1, b2, b3] = subdivideCubic(S[0], S[1], S[2], S[3], 0.3);
    expect(a3).toEqual(b0);
    for (const u of [0, 0.25, 0.5, 1]) {
      const left = evaluateCubic(a0, a1, a2, a3, u);
      const whole = at(0.3 * u);
      expect(left.x).toBeCloseTo(whole.x);
      expect(left.y).toBeCloseTo(whole.y);
      const right = evaluateCubic(b0, b1, b2, b3, u);
      const whole2 = at(0.3 + 0.7 * u);
      expect(right.x).toBeCloseTo(whole2.x);
      expect(right.y).toBeCloseTo(whole2.y);
    }
  });
});

describe('nearest point', () => {
  it('finds a point that is on the curve, at its parameter', () => {
    const target = at(0.62);
    const hit = nearestPointOnCubic(S[0], S[1], S[2], S[3], target);
    expect(hit.t).toBeCloseTo(0.62, 3);
    expect(hit.dist).toBeCloseTo(0, 3);
  });

  it('measures the distance from a point off the curve', () => {
    // Above the flat start of a straight horizontal line.
    const hit = nearestPointOnCubic(v(0, 0), v(1, 0), v(2, 0), v(3, 0), v(1.5, 2));
    expect(hit.point.x).toBeCloseTo(1.5, 3);
    expect(hit.dist).toBeCloseTo(2, 3);
  });

  it('measures in screen pixels with the scaled version', () => {
    // 1 beat = 50 px, 1 cent = 0.2 px: 100 cents above the line is 20 px.
    const hit = nearestPointOnCubicScaled(v(0, 6000), v(1, 6000), v(2, 6000), v(3, 6000), v(1.5, 6100), 50, 0.2);
    expect(hit.dist).toBeCloseTo(20, 2);
    expect(hit.point.x).toBeCloseTo(1.5, 3);
  });
});

describe('findTForX', () => {
  it('finds the parameter where a time-monotonic segment reaches a beat', () => {
    for (const x of [0.5, 2, 3.7]) expect(at(findTForX(S[0], S[1], S[2], S[3], x)).x).toBeCloseTo(x, 6);
  });
});

describe('distToPoint', () => {
  it('is the straight-line distance', () => {
    expect(distToPoint(v(0, 0), v(3, 4))).toBe(5);
  });
});
