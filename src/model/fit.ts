import type { BezierCurve, Lane, LanePoint } from '../types';
import { clampToRange, evaluateLaneAtBeat, pitchLane } from './lane';

/**
 * The recording fitter (BACKLOG 13.11; spec in DESIGN.md › Recording fit spec).
 *
 * Fits samples of a value over time (pitch in cents, or volume) with a smooth
 * curve whose handles sit at ⅓ of each segment's width. That makes time run
 * evenly along a segment, so the segment is a plain cubic in time (a cubic
 * Hermite piece) and the fit is linear: each point's value and slope, by least
 * squares. Points are added where the error is worst until every sample is
 * within the tolerance. Pure.
 */

/** A fitted point: where it is, and the curve's slope there (value per beat). */
export interface FitKnot {
  x: number;
  y: number;
  slope: number;
}

/** A point the fit must keep: its value, and its slope when given. */
export interface FitPin {
  y: number;
  slope?: number;
}

export interface FitOptions {
  /** The most any sample may be off, in the samples' own units. */
  tolerance: number;
  /** Timing slack on steep parts, in beats: a sample counts as within
   *  tolerance if the curve passes that close in time. */
  slackBeats?: number;
  /** Keep the first / last point at these values (and slopes). By default
   *  the ends keep the first and last samples' values: a take starts and ends
   *  where it was played. */
  pinStart?: FitPin;
  pinEnd?: FitPin;
  /** Stop adding points here (a safety net, not a density setting). */
  maxPoints?: number;
}

/** Accuracy choices, in cents: the most any sample of a take may be off. */
export const RECORD_ACCURACY_STEPS: readonly number[] = [2, 3, 4, 6, 8, 10, 15, 20, 30, 40];
export const RECORD_ACCURACY_DEFAULT = 8;
/** Volume's own tolerance (0–1), whatever the Accuracy. */
export const VOLUME_FIT_TOLERANCE = 0.04;

/** The nearest Accuracy choice. */
export function clampRecordAccuracy(cents: number): number {
  if (!Number.isFinite(cents)) return RECORD_ACCURACY_DEFAULT;
  return RECORD_ACCURACY_STEPS.reduce((best, s) => Math.abs(s - cents) < Math.abs(best - cents) ? s : best);
}

/** A lane's tolerance at this Accuracy. */
export function laneTolerance(lane: Lane, accuracyCents: number): number {
  return lane.type === 'pitch' ? accuracyCents : VOLUME_FIT_TOLERANCE;
}

export const FIT_SLACK_BEATS = 0.01;
const FIT_MAX_POINTS = 2000;
const FIT_MAX_ROUNDS = 60;
/** Weight of the rows that pin a point, against 1 per sample. */
const PIN_WEIGHT = 1e6;
/** Weight of the faint pull toward the samples' own shape, which only matters
 *  where a segment has too few samples to settle its ends. */
const PRIOR_WEIGHT = 1e-3;

/**
 * Fit samples (`xs` strictly increasing, in beats) with the fewest points that
 * keep every sample within `tolerance`. Returns at least the two ends.
 */
export function fitSamples(xs: readonly number[], ys: readonly number[], opts: FitOptions): FitKnot[] {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return [];
  if (n === 1) return [{ x: xs[0]!, y: opts.pinStart?.y ?? ys[0]!, slope: 0 }];
  const slack = opts.slackBeats ?? FIT_SLACK_BEATS;
  const maxPoints = Math.max(2, opts.maxPoints ?? FIT_MAX_POINTS);
  opts = { ...opts, pinStart: opts.pinStart ?? { y: ys[0]! }, pinEnd: opts.pinEnd ?? { y: ys[n - 1]! } };

  let knots = [0, n - 1];
  let fit = solve(xs, ys, knots, opts);
  for (let round = 0; round < FIT_MAX_ROUNDS && knots.length < maxPoints; round++) {
    const added = new Set<number>();
    for (let j = 0; j < knots.length - 1; j++) {
      const a = knots[j]!;
      const b = knots[j + 1]!;
      if (b - a < 2) continue; // no sample between to add
      let worst = -1;
      let worstErr = opts.tolerance;
      // The ends count too: a knot's own sample can be off (its value is a
      // compromise with its neighbours), and then the sample beside it is
      // the one to add.
      for (let i = a; i <= b; i++) {
        const e = sampleError(fit, j, xs[i]!, ys[i]!, slack);
        if (e > worstErr) { worstErr = e; worst = i; }
      }
      if (worst >= 0) added.add(Math.min(b - 1, Math.max(a + 1, worst)));
    }
    if (added.size === 0) break;
    knots = [...knots, ...[...added].slice(0, maxPoints - knots.length)].sort((p, q) => p - q);
    fit = solve(xs, ys, knots, opts);
  }
  return prune(xs, ys, knots, fit, opts.tolerance, slack);
}

/** Knots each side of a removed one that are refitted with it gone. */
const PRUNE_REACH = 2;

/**
 * Adding points where the error is worst isn't economical (a vibrato gets
 * points beside its peaks as well as on them). So try taking each point out,
 * refitting the few segments round it with their outer ends held (value and
 * slope), and keep the removal if every sample there is still within tolerance.
 */
function prune(xs: readonly number[], ys: readonly number[], knots: number[], fit: FitKnot[], tolerance: number, slack: number): FitKnot[] {
  let j = 1;
  while (j < knots.length - 1) {
    const lo = Math.max(0, j - PRUNE_REACH);
    const hi = Math.min(knots.length - 1, j + PRUNE_REACH);
    const base = knots[lo]!;
    const local = knots.slice(lo, hi + 1).filter((_, q) => q !== j - lo).map(i => i - base);
    const wx = xs.slice(base, knots[hi]! + 1);
    const wy = ys.slice(base, knots[hi]! + 1);
    const trial = solve(wx, wy, local, {
      tolerance,
      pinStart: { y: fit[lo]!.y, slope: fit[lo]!.slope },
      pinEnd: { y: fit[hi]!.y, slope: fit[hi]!.slope },
    });
    let ok = true;
    for (let s = 0, i = 0; i < wx.length && ok; i++) {
      while (s < local.length - 2 && i > local[s + 1]!) s++;
      if (sampleError(trial, s, wx[i]!, wy[i]!, slack) > tolerance) ok = false;
    }
    if (ok) {
      knots.splice(j, 1);
      fit.splice(lo, hi - lo + 1, ...trial.map(t => ({ ...t })));
    } else {
      j++;
    }
  }
  return fit;
}

/** How far a sample is from the fit, less the timing slack on steep parts. */
function sampleError(fit: FitKnot[], seg: number, x: number, y: number, slack: number): number {
  const { value, slope } = hermite(fit[seg]!, fit[seg + 1]!, x);
  return Math.max(0, Math.abs(value - y) - Math.abs(slope) * slack);
}

/** The curve's value and slope at `x` within the segment from `a` to `b`. */
export function hermite(a: FitKnot, b: FitKnot, x: number): { value: number; slope: number } {
  const h = b.x - a.x;
  if (h <= 0) return { value: a.y, slope: 0 };
  const t = (x - a.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * a.slope
    + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * b.slope;
  const slope = ((6 * t2 - 6 * t) * a.y + (-6 * t2 + 6 * t) * b.y) / h
    + (3 * t2 - 4 * t + 1) * a.slope + (3 * t2 - 2 * t) * b.slope;
  return { value, slope };
}

/**
 * Least squares for each knot's value and slope, then the overshoot guard;
 * when the guard changes slopes, the values are refitted with those slopes
 * held, so the points settle where the limited curve fits best.
 * Unknowns are [y0, s0, y1, s1, …] where s is the slope times a scale (the
 * knot's mean segment width), which keeps the numbers alike. The normal
 * matrix is banded (a knot only meets its neighbours), solved by a banded
 * Cholesky.
 */
function solve(xs: readonly number[], ys: readonly number[], knots: readonly number[], opts: FitOptions): FitKnot[] {
  const fit = leastSquares(xs, ys, knots, opts, new Map());
  const held = guardOvershoot(fit, ys, knots, opts);
  if (held.size === 0) return fit;
  const refit = leastSquares(xs, ys, knots, opts, held);
  guardOvershoot(refit, ys, knots, opts);
  return refit;
}

function leastSquares(
  xs: readonly number[], ys: readonly number[], knots: readonly number[], opts: FitOptions,
  /** Knots whose slope is held, by knot index. */
  heldSlopes: ReadonlyMap<number, number>,
): FitKnot[] {
  const k = knots.length;
  const size = 2 * k;
  const BW = 4; // band: an unknown meets at most the next 3
  const band = new Float64Array(size * BW);
  const rhs = new Float64Array(size);
  const kx = knots.map(i => xs[i]!);
  const scale = kx.map((x, j) => {
    const back = j > 0 ? x - kx[j - 1]! : 0;
    const fwd = j < k - 1 ? kx[j + 1]! - x : 0;
    return (back + fwd) / (j > 0 && j < k - 1 ? 2 : 1) || 1;
  });

  const addRow = (cols: number[], coefs: number[], target: number, w: number) => {
    for (let p = 0; p < cols.length; p++) {
      const cp = cols[p]!;
      rhs[cp] = rhs[cp]! + w * coefs[p]! * target;
      for (let q = 0; q < cols.length; q++) {
        const cq = cols[q]!;
        if (cq < cp) continue;
        const at = cp * BW + (cq - cp);
        band[at] = band[at]! + w * coefs[p]! * coefs[q]!;
      }
    }
  };

  for (let j = 0; j < k - 1; j++) {
    const x0 = kx[j]!;
    const h = kx[j + 1]! - x0;
    const last = j === k - 2;
    const cols = [2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 3];
    for (let i = knots[j]!; i < knots[j + 1]! + (last ? 1 : 0); i++) {
      const t = (xs[i]! - x0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      addRow(cols, [
        2 * t3 - 3 * t2 + 1,
        (t3 - 2 * t2 + t) * h / scale[j]!,
        -2 * t3 + 3 * t2,
        (t3 - t2) * h / scale[j + 1]!,
      ], ys[i]!, 1);
    }
  }
  // The faint prior: each knot near its sample, its slope near the samples'.
  for (let j = 0; j < k; j++) {
    const i = knots[j]!;
    const lo = Math.max(0, i - 1);
    const hi = Math.min(xs.length - 1, i + 1);
    const est = hi > lo ? (ys[hi]! - ys[lo]!) / (xs[hi]! - xs[lo]!) : 0;
    addRow([2 * j], [1], ys[i]!, PRIOR_WEIGHT);
    addRow([2 * j + 1], [1], est * scale[j]!, PRIOR_WEIGHT);
  }
  const pin = (j: number, p: FitPin | undefined) => {
    if (!p) return;
    addRow([2 * j], [1], p.y, PIN_WEIGHT);
    if (p.slope !== undefined) addRow([2 * j + 1], [1], p.slope * scale[j]!, PIN_WEIGHT);
  };
  pin(0, opts.pinStart);
  pin(k - 1, opts.pinEnd);
  for (const [j, slope] of heldSlopes) addRow([2 * j + 1], [1], slope * scale[j]!, PIN_WEIGHT);

  const u = bandedCholeskySolve(band, rhs, size, BW);
  return kx.map((x, j) => ({ x, y: u[2 * j]!, slope: u[2 * j + 1]! / scale[j]! }));
}

/** Solve N u = rhs for a symmetric positive-definite N in upper band storage
 *  (`band[i * bw + d]` = N[i][i + d]). */
function bandedCholeskySolve(band: Float64Array, rhs: Float64Array, n: number, bw: number): Float64Array {
  // In place: band becomes U with N = Uᵀ U.
  for (let i = 0; i < n; i++) {
    for (let d = 1; d < bw && i - d >= 0; d++) {
      // Subtract contributions of row i-d to row i.
      const r = i - d;
      const uri = band[r * bw + d]!;
      if (uri === 0) continue;
      for (let e = 0; e + d < bw; e++) band[i * bw + e] = band[i * bw + e]! - uri * band[r * bw + d + e]!;
    }
    const diag = Math.sqrt(Math.max(band[i * bw]!, 1e-300));
    band[i * bw] = diag;
    for (let d = 1; d < bw; d++) band[i * bw + d] = band[i * bw + d]! / diag;
  }
  // Uᵀ z = rhs
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = rhs[i]!;
    for (let d = 1; d < bw && i - d >= 0; d++) s -= band[(i - d) * bw + d]! * z[i - d]!;
    z[i] = s / band[i * bw]!;
  }
  // U u = z
  const u = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let d = 1; d < bw && i + d < n; d++) s -= band[i * bw + d]! * u[i + d]!;
    u[i] = s / band[i * bw]!;
  }
  return u;
}

/**
 * No overshoot: where the samples of a segment only rise (or only fall, or
 * hold), its end slopes are limited so the cubic stays monotone and can't
 * scoop past them (Fritsch–Carlson). A leap into a held note ends flat. Pinned
 * slopes are left alone. Returns the slopes it changed, by knot index.
 */
function guardOvershoot(fit: FitKnot[], ys: readonly number[], knots: readonly number[], opts: FitOptions): Map<number, number> {
  const k = fit.length;
  const changed = new Map<number, number>();
  const fixed = (j: number) => (j === 0 && opts.pinStart?.slope !== undefined) || (j === k - 1 && opts.pinEnd?.slope !== undefined);
  const set = (j: number, slope: number) => {
    if (fixed(j) || slope === fit[j]!.slope) return;
    fit[j]!.slope = slope;
    changed.set(j, slope);
  };
  const give = opts.tolerance / 2;
  for (let j = 0; j < k - 1; j++) {
    const a = fit[j]!;
    const b = fit[j + 1]!;
    // Which way the samples go, not the fitted values (a fit can lean the
    // wrong way across a near-hold).
    const dir = Math.sign(ys[knots[j + 1]!]! - ys[knots[j]!]!);
    // Monotone samples: none goes back against the segment's direction by more
    // than half the tolerance (a hold counts, whichever way it drifts).
    let monotone = true;
    let run = ys[knots[j]!]!;
    for (let i = knots[j]! + 1; i <= knots[j + 1]! && monotone; i++) {
      const y = ys[i]!;
      if (dir >= 0 ? y < run - give : y > run + give) monotone = false;
      run = dir >= 0 ? Math.max(run, y) : Math.min(run, y);
    }
    if (!monotone) continue;
    const h = b.x - a.x;
    const delta = (b.y - a.y) / h;
    if (Math.abs(b.y - a.y) <= give || Math.sign(b.y - a.y) !== dir) {
      // A hold, or a fit leaning against the samples: flat at both ends.
      set(j, 0);
      set(j + 1, 0);
      continue;
    }
    let alpha = a.slope / delta;
    let beta = b.slope / delta;
    if (alpha < 0) { alpha = 0; set(j, 0); }
    if (beta < 0) { beta = 0; set(j + 1, 0); }
    const r = alpha * alpha + beta * beta;
    if (r > 9) {
      const tau = 3 / Math.sqrt(r);
      set(j, tau * alpha * delta);
      set(j + 1, tau * beta * delta);
    }
  }
  return changed;
}

/** Lane points for fitted knots: handles at ⅓ of each segment, along the slope. */
export function knotsToLanePoints(knots: readonly FitKnot[]): LanePoint[] {
  return knots.map((kn, j) => {
    const prev = knots[j - 1];
    const next = knots[j + 1];
    const back = prev ? (kn.x - prev.x) / 3 : 0;
    const fwd = next ? (next.x - kn.x) / 3 : 0;
    return {
      position: { x: kn.x, y: kn.y },
      handleIn: prev ? { x: -back, y: -back * kn.slope } : null,
      handleOut: next ? { x: fwd, y: fwd * kn.slope } : null,
    };
  });
}

/** Lane points for fitted knots, each value kept inside the lane's range. */
export function fittedLanePoints(lane: Lane, knots: readonly FitKnot[]): LanePoint[] {
  return knotsToLanePoints(knots.map(k => ({ ...k, y: clampToRange(lane, k.y) })));
}

/** How densely Simplify samples a curve's own shape. */
const SIMPLIFY_SAMPLES_PER_BEAT = 64;
const SIMPLIFY_MIN_SAMPLES_PER_SEGMENT = 8;

/**
 * Simplify (13.11): refit a lane from its own shape, sampled densely. With a
 * beat span, only the points strictly inside the smallest run of points
 * covering it are refitted, the run's end points kept with their values and
 * slopes, so the rest of the lane is untouched. The lane's ends always stay
 * put. Changes nothing unless the refit has fewer points. Returns whether it
 * changed the lane.
 */
export function simplifyLane(lane: Lane, tolerance: number, span?: { from: number; to: number }): boolean {
  const pts = lane.points;
  if (pts.length < 3) return false;
  let i0 = 0;
  let i1 = pts.length - 1;
  if (span) {
    for (let i = 0; i < pts.length; i++) if (pts[i]!.position.x <= span.from + 1e-9) i0 = i;
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i]!.position.x >= span.to - 1e-9) i1 = i;
  }
  if (i1 - i0 < 2) return false;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = i0; i < i1; i++) {
    const a = pts[i]!.position.x;
    const b = pts[i + 1]!.position.x;
    const n = Math.max(SIMPLIFY_MIN_SAMPLES_PER_SEGMENT, Math.ceil((b - a) * SIMPLIFY_SAMPLES_PER_BEAT));
    for (let s = 0; s < n; s++) {
      const x = a + (b - a) * (s / n);
      xs.push(x);
      ys.push(s === 0 ? pts[i]!.position.y : evaluateLaneAtBeat(lane, x));
    }
  }
  xs.push(pts[i1]!.position.x);
  ys.push(pts[i1]!.position.y);

  const inner = span && (i0 > 0 || i1 < pts.length - 1);
  const knots = fitSamples(xs, ys, {
    tolerance,
    pinStart: { y: pts[i0]!.position.y, ...(inner && i0 > 0 ? { slope: slopeAt(lane, i0, 'out') } : {}) },
    pinEnd: { y: pts[i1]!.position.y, ...(inner && i1 < pts.length - 1 ? { slope: slopeAt(lane, i1, 'in') } : {}) },
  });
  if (knots.length >= i1 - i0 + 1) return false;

  const fresh = fittedLanePoints(lane, knots);
  // The run's end points are the originals, so their values stay exact; each
  // keeps its outer handle.
  const first = fresh[0]!;
  const last = fresh[fresh.length - 1]!;
  const start = pts[i0]!;
  const end = pts[i1]!;
  first.position = { ...start.position };
  last.position = { ...end.position };
  first.handleIn = start.handleIn ? { ...start.handleIn } : null;
  last.handleOut = end.handleOut ? { ...end.handleOut } : null;
  pts.splice(i0, i1 - i0 + 1, ...fresh);
  return true;
}

/** The lane's slope just after (out) or before (in) a point. */
function slopeAt(lane: Lane, i: number, side: 'in' | 'out'): number {
  const pts = lane.points;
  const p = pts[i]!.position;
  const other = pts[side === 'out' ? i + 1 : i - 1]!.position;
  const eps = Math.abs(other.x - p.x) * 1e-3;
  if (eps <= 0) return 0;
  return side === 'out'
    ? (evaluateLaneAtBeat(lane, p.x + eps) - p.y) / eps
    : (p.y - evaluateLaneAtBeat(lane, p.x - eps)) / eps;
}

/**
 * Simplify a curve (13.11): its pitch lane at the Accuracy, and its other
 * lanes at their own tolerances. With a span of pitch point indices, only
 * that stretch of each lane. Returns whether anything changed.
 */
export function simplifyCurve(curve: BezierCurve, accuracyCents: number, pointSpan?: { first: number; last: number }): boolean {
  const pitch = pitchLane(curve).points;
  let span: { from: number; to: number } | undefined;
  if (pointSpan) {
    const a = pitch[pointSpan.first];
    const b = pitch[pointSpan.last];
    if (!a || !b || pointSpan.last - pointSpan.first < 2) return false;
    span = { from: a.position.x, to: b.position.x };
  }
  let changed = false;
  for (const lane of curve.lanes) {
    if (simplifyLane(lane, laneTolerance(lane, accuracyCents), span)) changed = true;
  }
  return changed;
}
