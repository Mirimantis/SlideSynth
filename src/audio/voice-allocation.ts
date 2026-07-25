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

/** Do two time ranges overlap? Touching endpoints don't count as overlap. */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Place curves that have no slot yet WITHOUT disturbing existing assignments.
 *
 * Used when curves appear mid-playback (a recorded take, a retrospective keep,
 * a curve drawn while the transport runs). Re-running computeVoiceAssignment
 * would be wrong here: it reassigns from scratch, so a curve that is currently
 * sounding could be moved to a different pool voice mid-note, cutting its
 * scheduled automation and glitching. Existing entries are therefore copied
 * through untouched, and each new curve takes the first slot whose already-
 * assigned curves don't overlap it, growing the pool only when none is free.
 */
export function assignNewCurves(
  curves: BezierCurve[],
  existing: Map<string, number>,
  existingVoiceCount: number,
): VoiceAssignment {
  const assignment = new Map(existing);
  const slots: Array<Array<{ start: number; end: number }>> = [];
  for (let i = 0; i < existingVoiceCount; i++) slots.push([]);

  const pending: Array<{ curve: BezierCurve; range: { start: number; end: number } }> = [];
  for (const curve of curves) {
    const range = getCurveTimeRange(curve);
    if (!range) continue;
    const slot = assignment.get(curve.id);
    if (slot === undefined) {
      pending.push({ curve, range });
    } else {
      while (slots.length <= slot) slots.push([]);
      slots[slot]!.push(range);
    }
  }

  pending.sort((a, b) => a.range.start - b.range.start);
  for (const { curve, range } of pending) {
    let placed = slots.findIndex(occupied => !occupied.some(o => overlaps(o, range)));
    if (placed === -1) {
      placed = slots.length;
      slots.push([]);
    }
    slots[placed]!.push(range);
    assignment.set(curve.id, placed);
  }

  return { assignment, voiceCount: slots.length };
}
