import type { BezierCurve } from '../types';
import { getCurveTimeRange } from './curve-sampler';

export interface VoiceAssignment {
  /** curve id -> pool voice index */
  assignment: Map<string, number>;
  /** minimum number of voices needed to cover the busiest overlap */
  voiceCount: number;
}

/**
 * Assign each curve to a voice-pool slot so overlapping curves never share a
 * slot, using as few slots as possible. Greedy "minimum meeting rooms":
 * processing curves in start order and reusing the earliest-freed slot is
 * optimal — concurrent slots in use at any instant equal the current overlap,
 * which is bounded by the true max overlap, so this never over-allocates.
 */
export function computeVoiceAssignment(curves: BezierCurve[]): VoiceAssignment {
  const withRange = curves
    .map(curve => ({ curve, range: getCurveTimeRange(curve) }))
    .filter((x): x is { curve: BezierCurve; range: { start: number; end: number } } => x.range !== null)
    .sort((a, b) => a.range.start - b.range.start);

  const voiceFreeAt: number[] = [];
  const assignment = new Map<string, number>();

  for (const { curve, range } of withRange) {
    let voice = voiceFreeAt.findIndex(freeAt => freeAt <= range.start);
    if (voice === -1) {
      voice = voiceFreeAt.length;
      voiceFreeAt.push(range.end);
    } else {
      voiceFreeAt[voice] = range.end;
    }
    assignment.set(curve.id, voice);
  }

  return { assignment, voiceCount: voiceFreeAt.length };
}
