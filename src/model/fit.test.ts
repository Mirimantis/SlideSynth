import { describe, it, expect } from 'vitest';
import type { Lane } from '../types';
import {
  fitSamples, knotsToLanePoints, hermite, simplifyLane, simplifyCurve, clampRecordAccuracy, findHolds, findTurns,
  FIT_SLACK_BEATS, RECORD_ACCURACY_DEFAULT, PITCH_HOLD_BAND_CENTS, MIN_ADD_GAP_BEATS, type FitKnot,
} from './fit';
import { curveFromRecording, type RecordedSample } from './curve';
import { createLane, createLanePoint, evaluateLaneAtBeat, getLane, pitchLane } from './lane';

// 120 bpm at 60 fps: 30 samples a beat.
const SPB = 30;
function take(beats: number, f: (b: number) => number): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= beats * SPB; i++) { xs.push(i / SPB); ys.push(f(i / SPB)); }
  return { xs, ys };
}

const GESTURES: Record<string, { xs: number[]; ys: number[] }> = {
  'straight octave glide': take(2, b => 6000 + 600 * b),
  'slow S glide': take(4, b => 6000 + 700 * (0.5 - 0.5 * Math.cos(Math.PI * b / 4))),
  'leap a fourth, then hold': take(3, b => 6000 + 500 / (1 + Math.exp(-(b - 1) * 40))),
  'vibrato ±25¢': take(4, b => 6000 + 25 * Math.sin(2 * Math.PI * 2.5 * b)),
  'wobble ±12¢ on a glide': take(4, b => 6000 + 150 * b + 12 * Math.sin(2 * Math.PI * 3 * b)),
};

/** The fit at x, from knots. */
function at(knots: FitKnot[], x: number): { value: number; slope: number } {
  let j = 0;
  while (j < knots.length - 2 && x > knots[j + 1]!.x) j++;
  return hermite(knots[j]!, knots[j + 1]!, x);
}

/** A lane holding these points, for evaluating through the app's own path. */
function laneOf(knots: FitKnot[]): Lane {
  const lane = createLane('pitch');
  lane.points = knotsToLanePoints(knots);
  return lane;
}

describe('fitSamples', () => {
  for (const [name, g] of Object.entries(GESTURES)) {
    for (const tol of [2, 8, 40]) {
      it(`${name} at ${tol}¢: every sample within Accuracy (less timing slack on steep parts)`, () => {
        const knots = fitSamples(g.xs, g.ys, { tolerance: tol });
        g.xs.forEach((x, i) => {
          const { value, slope } = at(knots, x);
          expect(Math.abs(value - g.ys[i]!) - Math.abs(slope) * FIT_SLACK_BEATS).toBeLessThanOrEqual(tol + 1e-6);
        });
      });
    }
  }

  it('fits a straight glide exactly with its two ends (the old fit was 133¢ off)', () => {
    const g = GESTURES['straight octave glide']!;
    const knots = fitSamples(g.xs, g.ys, { tolerance: 2 });
    expect(knots).toHaveLength(2);
    const lane = laneOf(knots);
    for (const [i, x] of g.xs.entries()) expect(evaluateLaneAtBeat(lane, x)).toBeCloseTo(g.ys[i]!, 3);
  });

  it('does not scoop past a leap into a held note', () => {
    const g = GESTURES['leap a fourth, then hold']!;
    for (const tol of [2, 8, 15, 40]) {
      const lane = laneOf(fitSamples(g.xs, g.ys, { tolerance: tol }));
      for (let b = 0; b <= 3; b += 0.002) {
        const v = evaluateLaneAtBeat(lane, b);
        expect(v).toBeLessThanOrEqual(6500 + 0.5);
        expect(v).toBeGreaterThanOrEqual(6000 - 0.5);
      }
    }
  });

  it('keeps vibrato when tight and irons it out when loose', () => {
    const g = GESTURES['vibrato ±25¢']!;
    const tight = fitSamples(g.xs, g.ys, { tolerance: 2 });
    const loose = fitSamples(g.xs, g.ys, { tolerance: 40, holdBand: PITCH_HOLD_BAND_CENTS });
    // Ten cycles: about a point per peak and trough.
    expect(tight.length).toBeGreaterThanOrEqual(20);
    expect(tight.length).toBeLessThanOrEqual(26);
    expect(loose).toHaveLength(2);
  });

  it('starts and ends where the take was played', () => {
    const g = GESTURES['wobble ±12¢ on a glide']!;
    const knots = fitSamples(g.xs, g.ys, { tolerance: 8 });
    expect(knots[0]!.x).toBe(g.xs[0]);
    expect(knots[0]!.y).toBeCloseTo(g.ys[0]!, 3);
    expect(knots[knots.length - 1]!.x).toBe(g.xs[g.xs.length - 1]);
    expect(knots[knots.length - 1]!.y).toBeCloseTo(g.ys[g.ys.length - 1]!, 3);
  });

  it('holds pinned slopes', () => {
    const g = GESTURES['slow S glide']!;
    const knots = fitSamples(g.xs, g.ys, { tolerance: 8, pinStart: { y: 6000, slope: 50 }, pinEnd: { y: 6700, slope: -20 } });
    expect(knots[0]!.slope).toBeCloseTo(50, 3);
    expect(knots[knots.length - 1]!.slope).toBeCloseTo(-20, 3);
  });

  it('handles two samples, and one', () => {
    const two = fitSamples([0, 1], [6000, 6100], { tolerance: 8 });
    expect(two.map(k => k.x)).toEqual([0, 1]);
    expect(two[0]!.y).toBeCloseTo(6000, 3);
    expect(two[1]!.y).toBeCloseTo(6100, 3);
    expect(two[0]!.slope).toBeCloseTo(100, 3);
    expect(fitSamples([0], [6000], { tolerance: 8 })).toEqual([{ x: 0, y: 6000, slope: 0 }]);
  });
});

describe('the shape pass', () => {
  const pitchOpts = (tolerance: number) => ({ tolerance, holdBand: Math.min(tolerance, PITCH_HOLD_BAND_CENTS) });

  it('puts a vibrato\'s points on its peaks and troughs, with level handles', () => {
    const g = GESTURES['vibrato ±25¢']!;
    const knots = fitSamples(g.xs, g.ys, pitchOpts(8));
    const inner = knots.slice(1, -1);
    // Ten cycles: a peak and a trough each.
    expect(inner).toHaveLength(20);
    for (const k of inner) {
      expect(k.slope).toBe(0);
      expect(Math.abs(Math.abs(k.y - 6000) - 25)).toBeLessThan(1.5);
    }
  });

  it('makes a held note exactly flat', () => {
    const g = take(3, b => (b < 1 ? 6000 + 2 * Math.sin(b * 17) : 6500 + 3 * Math.sin(b * 11)));
    const lane = laneOf(fitSamples(g.xs, g.ys, pitchOpts(8)));
    const values = [];
    for (let b = 1.3; b <= 3; b += 0.01) values.push(evaluateLaneAtBeat(lane, b));
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(1e-9);
  });

  it('does not make a slow glide into steps', () => {
    const g = take(4, b => 6000 + 20 * b);
    expect(findHolds(g.xs, g.ys, 8)).toHaveLength(0);
    expect(fitSamples(g.xs, g.ys, pitchOpts(8))).toHaveLength(2);
  });

  it('caps the hold band, so a loose Accuracy irons a vibrato out instead of stepping it', () => {
    const g = GESTURES['vibrato ±25¢']!;
    expect(fitSamples(g.xs, g.ys, pitchOpts(40))).toHaveLength(2);
  });

  it('keeps sloped points spaced out from their neighbours', () => {
    // A lopsided vibrato on a glide, with a little noise: its peaks are
    // sharper than level handles make them, which used to put a sloped point
    // on the very next sample.
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const g = take(6, b => {
      const p = 2 * Math.PI * 2.2 * b;
      return 6000 + 60 * b + 22 * Math.sin(p) + 8 * Math.sin(2 * p + 1) + 2 * noise();
    });
    for (const tol of [4, 8]) {
      const knots = fitSamples(g.xs, g.ys, pitchOpts(tol));
      knots.forEach((k, j) => {
        if (k.slope === 0 || j === 0 || j === knots.length - 1) return;
        expect(k.x - knots[j - 1]!.x).toBeGreaterThanOrEqual(MIN_ADD_GAP_BEATS);
        expect(knots[j + 1]!.x - k.x).toBeGreaterThanOrEqual(MIN_ADD_GAP_BEATS);
      });
    }
  });

  it('finds turns only where the samples come back by the reversal', () => {
    const ys = [0, 5, 10, 4, 12, 30, 20, 25, 0];
    expect(findTurns(ys, 8)).toEqual([5]);
    expect(findTurns(ys, 5)).toEqual([2, 3, 5, 6, 7]);
  });
});

describe('knotsToLanePoints', () => {
  it('puts handles at a third of each segment, along the slope', () => {
    const pts = knotsToLanePoints([{ x: 0, y: 0, slope: 3 }, { x: 3, y: 10, slope: -1 }, { x: 9, y: 0, slope: 0 }]);
    expect(pts[0]!.handleIn).toBeNull();
    expect(pts[0]!.handleOut).toEqual({ x: 1, y: 3 });
    expect(pts[1]!.handleIn).toEqual({ x: -1, y: 1 });
    expect(pts[1]!.handleOut).toEqual({ x: 2, y: -2 });
    expect(pts[2]!.handleOut).toBeNull();
  });
});

describe('curveFromRecording (13.11)', () => {
  const samples = (f: (b: number) => number): RecordedSample[] =>
    take(4, f).xs.map((beat, i, xs) => ({ beat, note: f(xs[i]!), volume: 0.8 }));

  it('uses the Accuracy it is given', () => {
    const s = samples(b => 6000 + 25 * Math.sin(2 * Math.PI * 2.5 * b));
    const tight = pitchLane(curveFromRecording(s, { accuracyCents: 2 })!).points.length;
    const loose = pitchLane(curveFromRecording(s, { accuracyCents: 40 })!).points.length;
    expect(tight).toBeGreaterThan(loose);
    expect(loose).toBe(2);
  });

  it('defaults to the default Accuracy', () => {
    expect(clampRecordAccuracy(Number.NaN)).toBe(RECORD_ACCURACY_DEFAULT);
    expect(clampRecordAccuracy(7)).toBe(6);
    expect(clampRecordAccuracy(100)).toBe(40);
  });
});

describe('simplifyLane', () => {
  /** A dense lane: every sample of a take a point, with flat handles. */
  function denseLane(f: (b: number) => number, beats = 4): Lane {
    const lane = createLane('pitch');
    const g = take(beats, f);
    lane.points = g.xs.map((x, i) => createLanePoint(x, g.ys[i]!));
    return lane;
  }

  it('thins a dense curve and keeps its ends', () => {
    const lane = denseLane(b => 6000 + 150 * b + 12 * Math.sin(2 * Math.PI * 3 * b));
    const before = lane.points.length;
    expect(simplifyLane(lane, { tolerance: 15 })).toBe(true);
    expect(lane.points.length).toBeLessThan(before / 5);
    expect(lane.points[0]!.position).toEqual({ x: 0, y: 6000 });
    expect(lane.points[lane.points.length - 1]!.position.x).toBe(4);
  });

  it('with a span, leaves the points outside it untouched and keeps the slope at its ends', () => {
    const lane = denseLane(b => 6000 + 100 * Math.sin(b * 2));
    const before = lane.points.map(p => ({ ...p.position }));
    const from = lane.points[30]!.position.x;
    const to = lane.points[90]!.position.x;
    const slopeAtStart = (evaluateLaneAtBeat(lane, from + 1e-4) - evaluateLaneAtBeat(lane, from)) / 1e-4;
    expect(simplifyLane(lane, { tolerance: 4 }, { from, to })).toBe(true);
    const after = lane.points;
    for (let i = 0; i <= 30; i++) expect(after[i]!.position).toEqual(before[i]);
    const tail = after.length - 1;
    for (let k = 0; k <= 120 - 90; k++) expect(after[tail - k]!.position).toEqual(before[120 - k]);
    expect(after.length).toBeLessThan(before.length);
    const slopeAfter = (evaluateLaneAtBeat(lane, from + 1e-4) - evaluateLaneAtBeat(lane, from)) / 1e-4;
    expect(slopeAfter).toBeCloseTo(slopeAtStart, 0);
  });

  it('changes nothing when it cannot use fewer points', () => {
    const lane = createLane('pitch');
    lane.points = knotsToLanePoints([{ x: 0, y: 6000, slope: 0 }, { x: 1, y: 6100, slope: 0 }, { x: 2, y: 6000, slope: 0 }]);
    const before = JSON.stringify(lane.points);
    expect(simplifyLane(lane, { tolerance: 2 })).toBe(false);
    expect(JSON.stringify(lane.points)).toBe(before);
  });
});

describe('simplifyCurve', () => {
  it('refits the volume lane too, at its own tolerance', () => {
    const s: RecordedSample[] = take(4, b => b).xs.map(beat => ({
      beat, note: 6000 + 150 * beat + 12 * Math.sin(2 * Math.PI * 3 * beat), volume: 0.5 + 0.3 * Math.sin(beat * 3),
    }));
    const curve = curveFromRecording(s, { accuracyCents: 2 })!;
    const pitchBefore = pitchLane(curve).points.length;
    const volumeBefore = getLane(curve, 'volume')!.points.length;
    // Volume was fitted at its tolerance already; pitch thins.
    expect(simplifyCurve(curve, 20)).toBe(true);
    expect(pitchLane(curve).points.length).toBeLessThan(pitchBefore);
    expect(getLane(curve, 'volume')!.points.length).toBeLessThanOrEqual(volumeBefore);
  });
});
