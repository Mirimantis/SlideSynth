import type { Vec2 } from '../types';

/** Evaluate cubic Bezier at parameter t ∈ [0,1] using De Casteljau. */
export function evaluateCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

/** Subdivide a cubic Bezier at t, returning two sets of 4 control points. */
export function subdivideCubic(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number,
): [Vec2, Vec2, Vec2, Vec2, Vec2, Vec2, Vec2, Vec2] {
  const a = lerp2(p0, p1, t);
  const b = lerp2(p1, p2, t);
  const c = lerp2(p2, p3, t);
  const d = lerp2(a, b, t);
  const e = lerp2(b, c, t);
  const f = lerp2(d, e, t);
  return [p0, a, d, f, f, e, c, p3];
}

/** Find the nearest point on a cubic Bezier to a test point. Returns { t, dist, point }. */
export function nearestPointOnCubic(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2,
  test: Vec2,
  steps: number = 50,
): { t: number; dist: number; point: Vec2 } {
  let bestT = 0;
  let bestDist = Infinity;
  let bestPoint = p0;

  // Coarse search
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = evaluateCubic(p0, p1, p2, p3, t);
    const d = dist2(pt, test);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
      bestPoint = pt;
    }
  }

  // Refine with binary-search style narrowing
  let lo = Math.max(0, bestT - 1 / steps);
  let hi = Math.min(1, bestT + 1 / steps);
  for (let iter = 0; iter < 20; iter++) {
    const t1 = (2 * lo + hi) / 3;
    const t2 = (lo + 2 * hi) / 3;
    const d1 = dist2(evaluateCubic(p0, p1, p2, p3, t1), test);
    const d2 = dist2(evaluateCubic(p0, p1, p2, p3, t2), test);
    if (d1 < d2) {
      hi = t2;
    } else {
      lo = t1;
    }
  }

  const finalT = (lo + hi) / 2;
  const finalPt = evaluateCubic(p0, p1, p2, p3, finalT);
  const finalDist = Math.sqrt(dist2(finalPt, test));

  if (finalDist < Math.sqrt(bestDist)) {
    return { t: finalT, dist: finalDist, point: finalPt };
  }
  return { t: bestT, dist: Math.sqrt(bestDist), point: bestPoint };
}

/**
 * Find the nearest point on a cubic Bezier using screen-space (scaled) distance.
 * scaleX/scaleY convert world → pixels (typically zoomX/zoomY).
 * Returned dist is in pixels; returned point is in world coords.
 */
export function nearestPointOnCubicScaled(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2,
  test: Vec2,
  scaleX: number,
  scaleY: number,
  steps: number = 50,
): { t: number; dist: number; point: Vec2 } {
  const sd2 = (a: Vec2, b: Vec2) => {
    const dx = (a.x - b.x) * scaleX;
    const dy = (a.y - b.y) * scaleY;
    return dx * dx + dy * dy;
  };

  let bestT = 0;
  let bestDist2 = Infinity;
  let bestPoint = p0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = evaluateCubic(p0, p1, p2, p3, t);
    const d = sd2(pt, test);
    if (d < bestDist2) { bestDist2 = d; bestT = t; bestPoint = pt; }
  }

  let lo = Math.max(0, bestT - 1 / steps);
  let hi = Math.min(1, bestT + 1 / steps);
  for (let iter = 0; iter < 20; iter++) {
    const t1 = (2 * lo + hi) / 3;
    const t2 = (lo + 2 * hi) / 3;
    if (sd2(evaluateCubic(p0, p1, p2, p3, t1), test) < sd2(evaluateCubic(p0, p1, p2, p3, t2), test)) {
      hi = t2;
    } else {
      lo = t1;
    }
  }

  const finalT = (lo + hi) / 2;
  const finalPt = evaluateCubic(p0, p1, p2, p3, finalT);
  const finalDist2 = sd2(finalPt, test);

  if (finalDist2 < bestDist2) {
    return { t: finalT, dist: Math.sqrt(finalDist2), point: finalPt };
  }
  return { t: bestT, dist: Math.sqrt(bestDist2), point: bestPoint };
}

/**
 * Find the parameter t where a monotonic cubic Bezier reaches a target X.
 * Returns t ∈ [0,1] via binary search.
 */
export function findTForX(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, targetX: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (evaluateCubic(p0, p1, p2, p3, mid).x < targetX) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Distance from a point to a control point anchor (for click hit-testing). */
export function distToPoint(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

// ── Helpers ─────────────────────────────────────────────────────

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export { lerp2 as lerp };
