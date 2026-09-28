import type { BezierCurve, LanePoint } from '../types';
import { pitchLane, setLaneHandle } from './lane';
import { reclampHandlesAround } from './curve';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';

/**
 * The Area Nudge brush (BACKLOG 13.26; spec in DESIGN.md › Area Nudge spec).
 *
 * The brush reaches along time on one curve: a point `d` beats from the
 * brush's centre has weight `nudgeWeight(d / radius)`, 1 at the centre to 0
 * at the edge. Push moves points (and handle tips) by weight × the drag; Smooth
 * relaxes points toward their neighbours. Pure: the interaction owns the drag.
 */

/** Which way the brush moves points. */
export type NudgeAxes = 'pitch' | 'time' | 'both';
export type NudgeMode = 'push' | 'smooth';

export const NUDGE_AXES: readonly NudgeAxes[] = ['pitch', 'time', 'both'];
export const NUDGE_MODES: readonly NudgeMode[] = ['push', 'smooth'];
/** Brush size (the reach each side of the cursor), in screen pixels. */
export const NUDGE_SIZE_MIN = 8;
export const NUDGE_SIZE_MAX = 600;
export const NUDGE_SIZE_DEFAULT = 60;
export const NUDGE_STRENGTH_DEFAULT = 0.5;

/** Closest two points may come in time, in beats: they never pass or meet. */
const MIN_GAP_BEATS = 0.001;

/** Raised-cosine falloff: 1 at the centre, 0 at and beyond the edge. `t` is
 *  distance / radius. */
export function nudgeWeight(t: number): number {
  const a = Math.abs(t);
  return a >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * a));
}

const clampPitch = (y: number) => Math.max(MIN_PITCH_CENTS, Math.min(MAX_PITCH_CENTS, y));

/**
 * Push: set the curve's points from `orig` (the points when the drag began)
 * moved by weight × (dx, dy) around `centerX`, with `radius` in beats. Handle
 * tips move by their own weight, so the curve bends smoothly. Absolute from
 * `orig`, so the drag can go back and forth. In time, points keep their order:
 * on the side the drag heads, each stops just short of the next (which moves
 * less), piling up at the brush's edge rather than passing. Points out of
 * reach never move. Returns whether anything moved.
 */
export function pushCurve(
  curve: BezierCurve,
  orig: readonly LanePoint[],
  centerX: number,
  radius: number,
  dx: number,
  dy: number,
): boolean {
  const lane = pitchLane(curve);
  const pts = lane.points;
  if (pts.length !== orig.length || radius <= 0) return false;
  const w = (x: number) => nudgeWeight((x - centerX) / radius);
  const affected: number[] = [];
  for (let i = 0; i < orig.length; i++) {
    const o = orig[i]!;
    const wp = w(o.position.x);
    const p = pts[i]!;
    p.position = { x: o.position.x + wp * dx, y: clampPitch(o.position.y + wp * dy) };
    // Each handle tip moves by the field at its own place.
    const tip = (h: { x: number; y: number } | null) => {
      if (!h) return null;
      const tx = o.position.x + h.x;
      const wt = w(tx);
      return { x: tx + wt * dx - p.position.x, y: o.position.y + h.y + wt * dy - p.position.y };
    };
    p.handleIn = tip(o.handleIn);
    p.handleOut = tip(o.handleOut);
    if (wp > 0 || (o.handleIn && w(o.position.x + o.handleIn.x) > 0) || (o.handleOut && w(o.position.x + o.handleOut.x) > 0)) {
      affected.push(i);
    }
  }
  if (affected.length === 0) return false;
  if (dx !== 0) keepTimeOrder(pts, dx);
  for (const i of affected) reclampHandlesAround(curve, i);
  return true;
}

/** Points never pass each other in time: sweep from the side the drag heads
 *  toward, stopping each point just short of the one ahead. Points that
 *  didn't move are never moved by this (the one ahead of them moved less, so
 *  the order already held). The curve can't start before beat 0. */
function keepTimeOrder(pts: LanePoint[], dx: number): void {
  if (dx > 0) {
    for (let i = pts.length - 2; i >= 0; i--) {
      const limit = pts[i + 1]!.position.x - MIN_GAP_BEATS;
      if (pts[i]!.position.x > limit) pts[i]!.position = { ...pts[i]!.position, x: limit };
    }
  } else {
    if (pts[0] && pts[0].position.x < 0) pts[0].position = { ...pts[0].position, x: 0 };
    for (let i = 1; i < pts.length; i++) {
      const limit = pts[i - 1]!.position.x + MIN_GAP_BEATS;
      if (pts[i]!.position.x < limit) pts[i]!.position = { ...pts[i]!.position, x: limit };
    }
  }
}

/**
 * Smooth: one stroke step. Each point in reach (not the curve's ends) moves
 * toward its neighbours by weight × `strength`: in pitch toward their average,
 * in time toward their midpoint (so order holds by itself). The handles of
 * the points it moves, and their neighbours', follow the new slope through
 * each point (their old shapes belonged to the wobble), at `handleRatio` of
 * each segment. Returns whether anything moved.
 */
export function smoothCurve(
  curve: BezierCurve,
  centerX: number,
  radius: number,
  strength: number,
  axes: NudgeAxes,
  handleRatio: number,
): boolean {
  const lane = pitchLane(curve);
  const pts = lane.points;
  if (pts.length < 3 || radius <= 0 || strength <= 0) return false;
  const before = pts.map(p => ({ ...p.position }));
  const moved = new Set<number>();
  for (let i = 1; i < pts.length - 1; i++) {
    const k = nudgeWeight((before[i]!.x - centerX) / radius) * strength;
    if (k <= 0) continue;
    const prev = before[i - 1]!;
    const next = before[i + 1]!;
    let { x, y } = before[i]!;
    if (axes !== 'time') y = clampPitch(y + k * ((prev.y + next.y) / 2 - y));
    if (axes !== 'pitch') x = x + k * ((prev.x + next.x) / 2 - x);
    if (x !== before[i]!.x || y !== before[i]!.y) {
      pts[i]!.position = { x, y };
      moved.add(i);
    }
  }
  if (moved.size === 0) return false;
  const reshape = new Set<number>();
  for (const i of moved) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < pts.length) reshape.add(j);
  for (const i of reshape) slopeHandles(curve, i, handleRatio);
  return true;
}

/** Handles along the slope through a point's neighbours (Catmull-Rom style),
 *  sized at `ratio` of each segment. A curve's ends take their one segment's
 *  slope. */
function slopeHandles(curve: BezierCurve, i: number, ratio: number): void {
  const lane = pitchLane(curve);
  const pts = lane.points;
  const p = pts[i]!.position;
  const prev = pts[i - 1]?.position;
  const next = pts[i + 1]?.position;
  const a = prev ?? p;
  const b = next ?? p;
  if (b.x - a.x <= 0) return;
  const slope = (b.y - a.y) / (b.x - a.x);
  if (prev) {
    const len = ratio * (p.x - prev.x);
    setLaneHandle(lane, i, 'in', { x: -len, y: -len * slope });
  }
  if (next) {
    const len = ratio * (next.x - p.x);
    setLaneHandle(lane, i, 'out', { x: len, y: len * slope });
  }
}

/** The points of a curve within a brush, with their weights, for drawing the
 *  brush's highlight. */
export function pointsInReach(curve: BezierCurve, centerX: number, radius: number): { index: number; weight: number }[] {
  if (radius <= 0) return [];
  const out: { index: number; weight: number }[] = [];
  pitchLane(curve).points.forEach((p, index) => {
    const weight = nudgeWeight((p.position.x - centerX) / radius);
    if (weight > 0) out.push({ index, weight });
  });
  return out;
}
