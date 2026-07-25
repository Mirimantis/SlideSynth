import { describe, it, expect } from 'vitest';
import type { BezierCurve } from '../types';
import { createLane, createLanePoint } from '../model/lane';
import { computeVoiceAssignment, assignNewCurves } from './voice-allocation';

function curve(id: string, start: number, end: number): BezierCurve {
  const lane = createLane('pitch');
  lane.points = [createLanePoint(start, 6000), createLanePoint(end, 6000)];
  return { id, lanes: [lane] };
}

describe('computeVoiceAssignment', () => {
  it('returns zero voices for no curves', () => {
    const { assignment, voiceCount } = computeVoiceAssignment([]);
    expect(voiceCount).toBe(0);
    expect(assignment.size).toBe(0);
  });

  it('excludes curves with no time range (fewer than 2 pitch points)', () => {
    const degenerate: BezierCurve = { id: 'a', lanes: [createLane('pitch')] };
    const { assignment, voiceCount } = computeVoiceAssignment([degenerate]);
    expect(voiceCount).toBe(0);
    expect(assignment.has('a')).toBe(false);
  });

  it('reuses a single voice for sequential non-overlapping curves', () => {
    const curves = [curve('a', 0, 1), curve('b', 1, 2), curve('c', 2, 3)];
    const { assignment, voiceCount } = computeVoiceAssignment(curves);
    expect(voiceCount).toBe(1);
    expect(assignment.get('a')).toBe(0);
    expect(assignment.get('b')).toBe(0);
    expect(assignment.get('c')).toBe(0);
  });

  it('allocates one voice per curve when all curves fully overlap', () => {
    const curves = [curve('a', 0, 5), curve('b', 0, 5), curve('c', 0, 5)];
    const { assignment, voiceCount } = computeVoiceAssignment(curves);
    expect(voiceCount).toBe(3);
    const voices = new Set(['a', 'b', 'c'].map(id => assignment.get(id)));
    expect(voices.size).toBe(3);
  });

  it('sizes the pool to the max concurrent overlap for staggered curves', () => {
    // a: 0-3, b: 1-4, c: 2-5 — all three overlap at beat 2-3, needs 3 voices.
    // d: 5-6 starts after all three end, should reuse a freed voice.
    const curves = [curve('a', 0, 3), curve('b', 1, 4), curve('c', 2, 5), curve('d', 5, 6)];
    const { assignment, voiceCount } = computeVoiceAssignment(curves);
    expect(voiceCount).toBe(3);
    const used = new Set(['a', 'b', 'c'].map(id => assignment.get(id)));
    expect(used.size).toBe(3);
    expect(used.has(assignment.get('d'))).toBe(true);
  });
});

describe('assignNewCurves', () => {
  it('leaves existing assignments untouched', () => {
    // A curve sounding right now must not be moved to another voice mid-note.
    const curves = [curve('a', 0, 4), curve('b', 1, 2)];
    const existing = new Map([['a', 0]]);
    const { assignment } = assignNewCurves(curves, existing, 1);
    expect(assignment.get('a')).toBe(0);
    expect(assignment.get('b')).toBe(1); // overlaps 'a', so needs its own slot
  });

  it('reuses a free slot when the new curve does not overlap', () => {
    const curves = [curve('a', 0, 1), curve('b', 2, 3)];
    const existing = new Map([['a', 0]]);
    const { assignment, voiceCount } = assignNewCurves(curves, existing, 1);
    expect(assignment.get('b')).toBe(0);
    expect(voiceCount).toBe(1);
  });

  it('grows the pool only when every slot is busy', () => {
    const curves = [curve('a', 0, 4), curve('b', 0, 4), curve('c', 1, 2)];
    const existing = new Map([['a', 0], ['b', 1]]);
    const { assignment, voiceCount } = assignNewCurves(curves, existing, 2);
    expect(assignment.get('c')).toBe(2);
    expect(voiceCount).toBe(3);
  });

  it('is a no-op when nothing is new', () => {
    const curves = [curve('a', 0, 1), curve('b', 2, 3)];
    const existing = new Map([['a', 0], ['b', 0]]);
    const { assignment, voiceCount } = assignNewCurves(curves, existing, 1);
    expect([...assignment]).toEqual([['a', 0], ['b', 0]]);
    expect(voiceCount).toBe(1);
  });

  it('treats touching endpoints as non-overlapping', () => {
    const curves = [curve('a', 0, 1), curve('b', 1, 2)];
    const { assignment, voiceCount } = assignNewCurves(curves, new Map([['a', 0]]), 1);
    expect(assignment.get('b')).toBe(0);
    expect(voiceCount).toBe(1);
  });

  it('places several new curves without conflicting with each other', () => {
    const curves = [curve('a', 0, 4), curve('b', 1, 3), curve('c', 2, 5)];
    const { assignment, voiceCount } = assignNewCurves(curves, new Map([['a', 0]]), 1);
    const slots = new Set([assignment.get('a'), assignment.get('b'), assignment.get('c')]);
    expect(slots.size).toBe(3); // all three overlap pairwise
    expect(voiceCount).toBe(3);
  });

  it('ignores curves with no time range', () => {
    const degenerate: BezierCurve = { id: 'x', lanes: [createLane('pitch')] };
    const { assignment } = assignNewCurves([degenerate], new Map(), 0);
    expect(assignment.has('x')).toBe(false);
  });
});
