import type { BezierCurve, CurveSample } from '../types';
import { getSegmentControlPoints } from '../model/curve';
import { evaluateCubic } from '../utils/bezier-math';
import { noteToFrequency, CURVE_SAMPLE_RATE } from '../constants';

/**
 * Sample a BezierCurve into an array of {timeSeconds, frequency, volume} tuples.
 * Used by the playback scheduler to drive AudioParam automation.
 */
export function sampleCurve(
  curve: BezierCurve,
  bpm: number,
  startBeat?: number,
  endBeat?: number,
): CurveSample[] {
  if (curve.points.length < 2) return [];

  const samples: CurveSample[] = [];
  const beatsToSeconds = 60 / bpm;

  for (let i = 0; i < curve.points.length - 1; i++) {
    const seg = getSegmentControlPoints(curve, i);
    if (!seg) continue;

    const ptA = curve.points[i]!;
    const ptB = curve.points[i + 1]!;

    // Segment time span
    const segStartBeat = seg.p0.x;
    const segEndBeat = seg.p3.x;
    const segDurationSec = (segEndBeat - segStartBeat) * beatsToSeconds;

    // Skip segments outside requested range
    if (startBeat !== undefined && segEndBeat < startBeat) continue;
    if (endBeat !== undefined && segStartBeat > endBeat) continue;

    // Number of samples for this segment
    const n = Math.max(2, Math.ceil(segDurationSec * CURVE_SAMPLE_RATE));

    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const pt = evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, t);

      // Volume: linear interpolation between endpoints
      const volume = ptA.volume + (ptB.volume - ptA.volume) * t;

      const timeBeat = pt.x;

      // Filter to requested range
      if (startBeat !== undefined && timeBeat < startBeat) continue;
      if (endBeat !== undefined && timeBeat > endBeat) continue;

      const timeSeconds = timeBeat * beatsToSeconds;
      const frequency = noteToFrequency(pt.y);

      samples.push({ timeSeconds, frequency, volume });
    }
  }

  return samples;
}

/**
 * Evaluate a BezierCurve at a specific beat position.
 * Returns the note number (Y) and interpolated volume, or null if the beat
 * falls outside the curve's range.
 */
export function evaluateCurveAtBeat(
  curve: BezierCurve,
  beat: number,
): { noteNumber: number; volume: number } | null {
  if (curve.points.length < 2) return null;

  const first = curve.points[0]!.position.x;
  const last = curve.points[curve.points.length - 1]!.position.x;
  if (beat < first || beat > last) return null;

  // Find the segment that spans this beat
  for (let i = 0; i < curve.points.length - 1; i++) {
    const ptA = curve.points[i]!;
    const ptB = curve.points[i + 1]!;
    if (beat < ptA.position.x || beat > ptB.position.x) continue;

    const seg = getSegmentControlPoints(curve, i);
    if (!seg) continue;

    // Binary search for parameter t where evaluateCubic(seg, t).x === beat
    let lo = 0;
    let hi = 1;
    for (let iter = 0; iter < 20; iter++) {
      const mid = (lo + hi) / 2;
      const pt = evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, mid);
      if (pt.x < beat) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const t = (lo + hi) / 2;
    const pt = evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, t);
    const volume = ptA.volume + (ptB.volume - ptA.volume) * t;
    return { noteNumber: pt.y, volume };
  }

  return null;
}

/**
 * Get the time range (in beats) of a curve.
 */
export function getCurveTimeRange(curve: BezierCurve): { start: number; end: number } | null {
  if (curve.points.length === 0) return null;
  return {
    start: curve.points[0]!.position.x,
    end: curve.points[curve.points.length - 1]!.position.x,
  };
}
