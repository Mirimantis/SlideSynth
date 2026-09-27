import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInteraction, moveSelectionByInterval } from './interaction';
import { createViewport } from './viewport';
import { store } from '../state/store';
import { history } from '../state/history';
import { createComposition } from '../model/composition';
import { createCurve, createControlPoint, addPointToCurve, pitchPoints, shiftCurvesByInterval } from '../model/curve';
import { moveIntervalCents, moveIntervalName, resolveTuning, TWELVE_EDO, type TuningRef } from '../tuning/tuning';
import { pointSelectionOf } from '../model/point-selection';
import { MAX_PITCH_CENTS } from '../constants';

/** Moving by an interval (BACKLOG 13.24). */

const WERCK: TuningRef = { kind: 'table', id: 'werckmeister-3' };
const werck = resolveTuning(WERCK);
const EDO19: TuningRef = { kind: 'edo', divisions: 19, equave: 'octave' };
const BP: TuningRef = { kind: 'edo', divisions: 13, equave: 'tritave' };
const cents = (tuning: TuningRef, base: number, interval: number, dir: 1 | -1 = 1) =>
  moveIntervalCents({ tuning, tunedFrom: 0 }, base, interval, dir);

function curveAt(...pts: Array<[number, number]>) {
  const c = createCurve();
  for (const [x, y] of pts) addPointToCurve(c, createControlPoint(x, y));
  return c;
}

describe('the interval in the tuning', () => {
  it('12-EDO: semitones, the octave, and one step is a semitone', () => {
    expect(cents(TWELVE_EDO, 6400, 7)).toBe(700);
    expect(cents(TWELVE_EDO, 6400, 7, -1)).toBe(-700);
    expect(cents(TWELVE_EDO, 6400, 12)).toBe(1200);
    expect(cents(TWELVE_EDO, 6400, 0)).toBe(100);
  });

  it('an unequal table counts from the curve’s own note', () => {
    expect(cents(WERCK, 6000 + werck.degrees[4]!, 4)).toBeCloseTo(werck.degrees[8]! - werck.degrees[4]!, 6);   // E → G#
    expect(cents(WERCK, 6000, 4)).toBeCloseTo(werck.degrees[4]!, 6);                                             // C → E
    // Down a fifth from E is the A below it.
    expect(cents(WERCK, 6000 + werck.degrees[4]!, 7, -1)).toBeCloseTo(werck.degrees[9]! - 1200 - werck.degrees[4]!, 6);
    // Between notes: the nearest note’s interval, so the offset from it is kept.
    expect(cents(WERCK, 6000 + werck.degrees[4]! + 17, 4)).toBe(cents(WERCK, 6000 + werck.degrees[4]!, 4));
  });

  it('other tunings take the nearest step; one step is one step', () => {
    expect(cents(EDO19, 6000, 7)).toBeCloseTo(11 * 1200 / 19, 6);
    expect(cents(EDO19, 6000, 0)).toBeCloseTo(1200 / 19, 6);
    expect(cents(EDO19, 6000, 0, -1)).toBeCloseTo(-1200 / 19, 6);
  });

  it('the octave is the tuning’s period', () => {
    const period = resolveTuning(BP).period;
    expect(cents(BP, 6000, 12)).toBeCloseTo(period, 6);
    expect(moveIntervalName(12, BP)).toBe('Period (3/1)');
    expect(moveIntervalName(7, BP)).toBe('Perfect 5th');
  });
});

describe('moving curves', () => {
  it('each curve moves by the interval from its own first note', () => {
    const c = curveAt([0, 6000], [2, 6200]);
    const e = curveAt([0, 6000 + werck.degrees[4]!], [2, 6500]);
    shiftCurvesByInterval([c, e], null, base => cents(WERCK, base, 4));
    expect(pitchPoints(c)[1]!.position.y).toBeCloseTo(6200 + werck.degrees[4]!, 6);
    expect(pitchPoints(e)[1]!.position.y).toBeCloseTo(6500 + werck.degrees[8]! - werck.degrees[4]!, 6);
  });

  it('a point selection moves only its points, from the first of them', () => {
    const c = curveAt([0, 6000], [1, 6400], [2, 6700]);
    shiftCurvesByInterval([c], pointSelectionOf([{ curveId: c.id, index: 2 }, { curveId: c.id, index: 1 }]), () => 1200);
    expect(pitchPoints(c).map(p => p.position.y)).toEqual([6000, 7600, 7900]);
  });

  it('stays in the pitch range', () => {
    const c = curveAt([0, MAX_PITCH_CENTS - 100], [1, MAX_PITCH_CENTS - 200]);
    shiftCurvesByInterval([c], null, () => 1200);
    expect(pitchPoints(c).every(p => p.position.y <= MAX_PITCH_CENTS)).toBe(true);
  });
});

describe('the arrows and commands', () => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' }, title: '' } as unknown as HTMLCanvasElement;
  const interaction = createInteraction(canvas, createViewport(), { isPerformInputActive: () => false });
  const curves = () => store.getState().composition.tracks[0]!.curves;

  beforeEach(() => {
    store.loadComposition(createComposition());
    store.setTool('select');
    const c = curveAt([0, 6000], [2, 6400]);
    store.mutate(comp => { comp.tracks[0]!.curves.push(c); });
    store.setSelectedTrack(store.getState().composition.tracks[0]!.id);
    store.setSelectedCurves([c.id]);
    store.setMoveInterval(7);
    history.clear();
  });

  it('moves the selection by the Move by interval, as one undo step', () => {
    expect(moveSelectionByInterval(interaction, 1)).toBe(true);
    expect(pitchPoints(curves()[0]!).map(p => p.position.y)).toEqual([6700, 7100]);
    history.undo();
    expect(pitchPoints(curves()[0]!).map(p => p.position.y)).toEqual([6000, 6400]);
  });

  it('with duplicate, moves a copy and keeps the original, as one undo step', () => {
    moveSelectionByInterval(interaction, -1, true);
    expect(curves()).toHaveLength(2);
    expect(pitchPoints(curves()[0]!).map(p => p.position.y)).toEqual([6000, 6400]);
    expect(pitchPoints(curves()[1]!).map(p => p.position.y)).toEqual([5300, 5700]);
    expect([...store.getState().selectedCurveIds]).toEqual([curves()[1]!.id]);
    history.undo();
    expect(curves()).toHaveLength(1);
  });
});
