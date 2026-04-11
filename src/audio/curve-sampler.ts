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
 * Get the time range (in beats) of a curve.
 */
export function getCurveTimeRange(curve: BezierCurve): { start: number; end: number } | null {
  if (curve.points.length === 0) return null;
  return {
    start: curve.points[0]!.position.x,
    end: curve.points[curve.points.length - 1]!.position.x,
  };
}
