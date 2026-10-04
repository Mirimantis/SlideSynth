import { describe, it, expect } from 'vitest';
import { sampleCurve, evaluateCurveAtBeat, getCurveTimeRange } from './curve-sampler';
import { audioTimeToBeat, beatToAudioTime, curveEventsInWindow, CURVE_EDGE_FADE_S, type PlayClock } from './schedule-math';
import { createCurve, addPointToCurve, createControlPoint } from '../model/curve';
import { createDefaultLane } from '../model/lane';
import { centsToFrequency, CURVE_SAMPLE_RATE } from '../constants';
import type { BezierCurve } from '../types';

/** The last element (the project's lib predates Array.prototype.at). */
const last = <T>(a: readonly T[]): T | undefined => a[a.length - 1];

// Kernel tests (BACKLOG 15.8): what playback plays, and when.

/** A straight glide (no handles) through the given [beat, cents] points. */
function glide(...pts: Array<[number, number]>): BezierCurve {
  const curve = createCurve();
  for (const [x, y] of pts) addPointToCurve(curve, createControlPoint(x, y));
  return curve;
}

describe('evaluateCurveAtBeat', () => {
  it('reads the pitch along a straight glide, and nothing outside it', () => {
    const c = glide([1, 6000], [3, 6200], [4, 6200]);
    expect(evaluateCurveAtBeat(c, 1)!.noteNumber).toBeCloseTo(6000);
    expect(evaluateCurveAtBeat(c, 2)!.noteNumber).toBeCloseTo(6100, 3);
    expect(evaluateCurveAtBeat(c, 3.5)!.noteNumber).toBeCloseTo(6200);
    expect(evaluateCurveAtBeat(c, 0.99)).toBeNull();
    expect(evaluateCurveAtBeat(c, 4.01)).toBeNull();
  });

  it('reads the volume lane, or the default without one', () => {
    const c = glide([0, 6000], [2, 6000]);
    const def = evaluateCurveAtBeat(c, 1)!.volume;
    expect(def).toBeGreaterThan(0);
    c.lanes.push(createDefaultLane('volume', 0, 2, 0.3));
    expect(evaluateCurveAtBeat(c, 1)!.volume).toBeCloseTo(0.3);
  });

  it('has nothing to say about a curve of fewer than two points', () => {
    expect(evaluateCurveAtBeat(glide([0, 6000]), 0)).toBeNull();
  });
});

describe('sampleCurve', () => {
  it('samples at the playback rate, in seconds at the tempo, as frequencies', () => {
    const c = glide([0, 6900], [2, 6900]);       // A4 for two beats
    const samples = sampleCurve(c, 120);          // = one second
    expect(samples.length).toBeGreaterThanOrEqual(CURVE_SAMPLE_RATE);
    expect(samples[0]!.timeSeconds).toBeCloseTo(0);
    expect(last(samples)!.timeSeconds).toBeCloseTo(1);
    for (const s of samples) expect(s.frequency).toBeCloseTo(440, 6);
  });

  it('keeps only samples in the requested beat range', () => {
    const samples = sampleCurve(glide([0, 6000], [4, 6400]), 60, 1, 2);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(s.timeSeconds).toBeGreaterThanOrEqual(1);
      expect(s.timeSeconds).toBeLessThanOrEqual(2);
    }
  });

  it('follows the pitch with the frequency', () => {
    const samples = sampleCurve(glide([0, 6000], [1, 7200]), 60);
    expect(samples[0]!.frequency).toBeCloseTo(centsToFrequency(6000), 6);
    expect(last(samples)!.frequency).toBeCloseTo(centsToFrequency(7200), 6);
  });
});

describe('getCurveTimeRange', () => {
  it('spans the first to the last point', () => {
    expect(getCurveTimeRange(glide([1.5, 6000], [3, 6100], [6, 6000]))).toEqual({ start: 1.5, end: 6 });
    expect(getCurveTimeRange(createCurve())).toBeNull();
  });
});

describe('scheduler timing (schedule-math)', () => {
  // Playback started at beat 2, audio clock 10 s, 120 bpm (half a second a beat).
  const clock: PlayClock = { startAudioTime: 10, startBeat: 2, bpm: 120 };

  it('maps beats to the audio clock and back', () => {
    expect(beatToAudioTime(clock, 2)).toBe(10);
    expect(beatToAudioTime(clock, 4)).toBe(11);
    expect(beatToAudioTime(clock, 1)).toBe(9.5);
    for (const t of [9, 10.25, 13.7]) expect(beatToAudioTime(clock, audioTimeToBeat(clock, t))).toBeCloseTo(t, 9);
  });

  it('schedules a curve’s samples between its fades, at their audio times', () => {
    const c = glide([3, 6900], [4, 6900]);       // audio 10.5 → 11
    const events = curveEventsInWindow(c, clock, 10, 12);
    const fades = events.filter(e => e.frequency === null);
    expect(fades.map(e => e.time)).toEqual([10.5 - CURVE_EDGE_FADE_S, 11 + CURVE_EDGE_FADE_S]);
    for (const f of fades) expect(f.volume).toBe(0);
    const notes = events.filter(e => e.frequency !== null);
    expect(notes[0]!.time).toBeCloseTo(10.5);
    expect(last(notes)!.time).toBeCloseTo(11);
    for (const n of notes) expect(n.frequency).toBeCloseTo(440, 6);
  });

  it('schedules each sample once across back-to-back windows', () => {
    const c = glide([2, 6000], [3, 6700], [5, 6200]);
    const all = curveEventsInWindow(c, clock, 9.9, 12).map(e => e.time);
    const windows = [9.9, 10.1, 10.2, 10.65, 11, 11.4, 12];
    const pieces: number[] = [];
    for (let i = 0; i < windows.length - 1; i++) {
      pieces.push(...curveEventsInWindow(c, clock, windows[i]!, windows[i + 1]!).map(e => e.time));
    }
    const sort = (a: number[]) => [...a].sort((x, y) => x - y);
    expect(sort(pieces)).toEqual(sort(all));
  });

  it('skips what’s already past: the window is open at its start', () => {
    const c = glide([1, 6000], [3, 6000]);       // audio 9.5 → 10.5, already sounding at 10
    const events = curveEventsInWindow(c, clock, 10, 10.1);
    expect(events.every(e => e.time > 10 && e.time <= 10.1)).toBe(true);
    expect(events.some(e => e.frequency === null)).toBe(false);
    expect(curveEventsInWindow(c, clock, 11, 12)).toEqual([]);
  });
});
