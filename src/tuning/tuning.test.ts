import { describe, it, expect } from 'vitest';
import {
  ALL_NOTES, TWELVE_EDO, clampDivisions, degreeName, nearestDegree, nearestNote, pitchSetFor, resolveTuning, rootCents, scalesFor,
  type PitchSettings, type TuningRef,
} from './tuning';
import { migrateSnapSettings } from '../export/json-export';
import { snapToGrid, findAdaptiveSnap, type SnapConfig } from '../utils/snap';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';

const settings = (over: Partial<PitchSettings> = {}): PitchSettings => ({
  tuning: TWELVE_EDO, root: 0, scaleId: ALL_NOTES, tunedFrom: 0, hidePitchLines: false, ...over,
});
const notes = (over: Partial<PitchSettings> = {}) => pitchSetFor(settings(over))!.notes;
/** Pitch classes (cents within the octave) of a note list. */
const classes = (ns: readonly number[]) =>
  [...new Set(ns.map(n => Math.round((((n % 1200) + 1200) % 1200) * 100) / 100))].sort((a, b) => a - b);

describe('pitch sets (BACKLOG 13.8)', () => {
  it('12-EDO with every note is the plain chromatic grid', () => {
    const set = pitchSetFor(settings())!;
    expect(set.plainChromatic).toBe(true);
    expect(set.notes[0]).toBe(MIN_PITCH_CENTS);
    expect(set.notes[set.notes.length - 1]).toBe(MAX_PITCH_CENTS);
    expect(set.notes.every(n => n % 100 === 0)).toBe(true);
  });

  it('a scale counts from the root', () => {
    expect(classes(notes({ root: 2, scaleId: 'major' }))).toEqual([100, 200, 400, 600, 700, 900, 1100]);
    expect(pitchSetFor(settings({ scaleId: 'major' }))!.plainChromatic).toBe(false);
  });

  it('in an unequal tuning, the root moves over a fixed table', () => {
    const werck: TuningRef = { kind: 'table', id: 'werckmeister-3' };
    const cMajor = classes(notes({ tuning: werck, scaleId: 'major' }));
    const dMajor = classes(notes({ tuning: werck, root: 2, scaleId: 'major' }));
    // D major isn't C major moved up a tone: the keys differ in colour.
    expect(dMajor).not.toEqual(classes(cMajor.map(c => c + 200)));
    expect(dMajor).toContain(192.18);   // its D
  });

  it('Tuned from moves degree 0', () => {
    expect(classes(notes({ tuning: { kind: 'edo', divisions: 7, equave: 'octave' }, tunedFrom: 2 }))[0])
      .toBeCloseTo(200 - 1200 / 7, 2);
  });

  it('hidden pitch lines leave no grid', () => {
    expect(pitchSetFor(settings({ hidePitchLines: true }))).toBeNull();
  });

  it('a scale that doesn’t fit the tuning plays as every note', () => {
    expect(notes({ tuning: { kind: 'edo', divisions: 19, equave: 'octave' }, scaleId: 'major' }))
      .toEqual(notes({ tuning: { kind: 'edo', divisions: 19, equave: 'octave' } }));
  });

  it('offers the scales that fit', () => {
    expect(scalesFor(resolveTuning(TWELVE_EDO)).map(s => s.id)).toContain('dorian');
    expect(scalesFor(resolveTuning({ kind: 'table', id: 'kirnberger-3' })).map(s => s.id)).toContain('dorian');
    expect(scalesFor(resolveTuning({ kind: 'edo', divisions: 24, equave: 'octave' })).map(s => s.id))
      .toEqual(['maqam-rast', 'maqam-bayati']);
  });

  it('divides the 3:1 twelfth for Bohlen–Pierce', () => {
    const bp = resolveTuning({ kind: 'edo', divisions: 13, equave: 'tritave' });
    expect(bp.period).toBeCloseTo(1901.955, 2);
    expect(bp.degrees).toHaveLength(13);
  });

  it('changing tuning keeps the root on the nearest pitch', () => {
    const edo24 = resolveTuning({ kind: 'edo', divisions: 24, equave: 'octave' });
    expect(nearestDegree(edo24, 0, rootCents({ tuning: TWELVE_EDO, root: 2, tunedFrom: 0 }))).toBe(4);
    // 19-EDO's nearest to D (200 ¢) is degree 3 (189.5 ¢).
    const edo19 = resolveTuning({ kind: 'edo', divisions: 19, equave: 'octave' });
    expect(nearestDegree(edo19, 0, 200)).toBe(3);
    // B wraps to degree 0 of a tuning with nothing near it but the octave.
    expect(nearestDegree(resolveTuning({ kind: 'table', id: 'slendro' }), 0, 1190)).toBe(0);
  });

  it('clamps equal divisions to 5–72', () => {
    expect(clampDivisions(2)).toBe(5);
    expect(clampDivisions(300)).toBe(72);
    expect(clampDivisions(Number.NaN)).toBe(12);
  });
});

describe('degree names (BACKLOG 13.8)', () => {
  const name = (ref: TuningRef, d: number, from = 0) => degreeName(resolveTuning(ref), from, d);

  it('12-note tunings use letters, from where they’re tuned', () => {
    expect(name(TWELVE_EDO, 1)).toBe('C#');
    expect(name({ kind: 'table', id: 'werckmeister-3' }, 0, 2)).toBe('D');
    expect(name({ kind: 'table', id: 'ji-5-limit' }, 4)).toBe('E (5/4)');
  });

  it('meantone EDOs spell sharps and flats apart', () => {
    const edo19: TuningRef = { kind: 'edo', divisions: 19, equave: 'octave' };
    expect([0, 1, 2, 3].map(d => name(edo19, d))).toEqual(['C', 'C#', 'Db', 'D']);
    const edo31: TuningRef = { kind: 'edo', divisions: 31, equave: 'octave' };
    const names31 = Array.from({ length: 31 }, (_, d) => name(edo31, d));
    expect(new Set(names31).size).toBe(31);
    expect(names31.every(n => /^[A-G]/.test(n))).toBe(true);
  });

  it('other tunings number their degrees, or give ratios', () => {
    expect(name({ kind: 'edo', divisions: 22, equave: 'octave' }, 5)).toBe('6');
    expect(name({ kind: 'table', id: 'ji-harmonics-8-16' }, 1)).toBe('9/8');
  });
});

describe('snapping to the pitch grid (BACKLOG 13.8)', () => {
  const cfg = (over: Partial<SnapConfig> = {}): SnapConfig => ({
    enabled: true, subdivisionsPerBeat: 4, pitchTargets: notes({ scaleId: 'major' }), ...over,
  });

  it('snaps Y to the nearest note, a tie going up', () => {
    expect(snapToGrid(0, 6140, cfg()).wy).toBe(6200);
    expect(nearestNote([6000, 6100], 6050)).toBe(6100);
  });

  it('floats free with no grid, unless a fret is near', () => {
    expect(snapToGrid(0, 6140, cfg({ pitchTargets: null })).wy).toBe(6140);
    expect(snapToGrid(0, 6140, cfg({ pitchTargets: null, guideYTargets: [6120] })).wy).toBe(6120);
    expect(findAdaptiveSnap(6140, cfg({ pitchTargets: null })).target).toBeNull();
  });

  it('a fret closer than the nearest note wins', () => {
    expect(snapToGrid(0, 6185, cfg({ guideYTargets: [6180] })).wy).toBe(6180);
    expect(snapToGrid(0, 6195, cfg({ guideYTargets: [6180] })).wy).toBe(6200);
  });
});

describe('migrating Key + Scale (BACKLOG 13.8)', () => {
  /** The old model's notes: root (0–11) plus the scale's semitone steps. */
  const OLD_INTERVALS: Record<string, number[]> = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'maqam-rast': [0, 2, 3.5, 5, 7, 9, 10.5],
    'maqam-bayati': [0, 1.5, 3, 5, 7, 8, 10],
    'slendro': [0, 2.4, 4.8, 7.2, 9.6],
    'pelog': [0, 1.6, 3.2, 5.2, 7.2, 8.4, 10.8],
    'thai-7tet': [0, 12 / 7, 24 / 7, 36 / 7, 48 / 7, 60 / 7, 72 / 7],
    '24tet': Array.from({ length: 24 }, (_, i) => i / 2),
  };
  const oldClasses = (root: number, id: string) => classes(OLD_INTERVALS[id]!.map(iv => (root + iv) * 100));

  it('every old scale, on every root, keeps its notes', () => {
    for (const id of Object.keys(OLD_INTERVALS)) {
      for (const root of [0, 2, 7, 11]) {
        const snap = migrateSnapSettings({ enabled: true, scaleRoot: root, scaleId: id, hidePitchLines: false });
        expect(classes(pitchSetFor(snap)!.notes), `${id} on ${root}`).toEqual(oldClasses(root, id));
      }
    }
  });

  it('Chromatic and None become 12-EDO, None with the lines hidden', () => {
    const chromatic = migrateSnapSettings({ enabled: true, scaleRoot: null, scaleId: null, hidePitchLines: false });
    expect(chromatic).toMatchObject({ tuning: TWELVE_EDO, root: 0, scaleId: ALL_NOTES, hidePitchLines: false });
    expect(chromatic).not.toHaveProperty('scaleRoot');
    expect(migrateSnapSettings({ scaleRoot: null, scaleId: null, hidePitchLines: true }).hidePitchLines).toBe(true);
  });

  it('the old tunings-as-scales become tunings', () => {
    expect(migrateSnapSettings({ scaleRoot: 2, scaleId: 'maqam-rast' }))
      .toMatchObject({ tuning: { kind: 'edo', divisions: 24 }, root: 4, scaleId: 'maqam-rast' });
    expect(migrateSnapSettings({ scaleRoot: 3, scaleId: 'pelog' }))
      .toMatchObject({ tuning: { kind: 'table', id: 'pelog' }, root: 0, tunedFrom: 3, scaleId: ALL_NOTES });
  });

  it('keeps current settings and the Gravity feel as they are', () => {
    const current = migrateSnapSettings({ tuning: { kind: 'edo', divisions: 31, equave: 'octave' }, root: 5, scaleId: ALL_NOTES, tunedFrom: 0, hidePitchLines: false, magneticStrength: 0.3 });
    expect(current).toMatchObject({ tuning: { divisions: 31 }, root: 5, magneticStrength: 0.3 });
    expect(migrateSnapSettings({ scaleRoot: 0, scaleId: 'major', magneticStrength: 0.4 }).magneticStrength).toBe(0.4);
    expect(migrateSnapSettings(undefined).tuning).toEqual(TWELVE_EDO);
  });
});

describe('the store keeps the root’s pitch (BACKLOG 13.8)', () => {
  it('across a tuning change and a Tuned from change', async () => {
    const { store } = await import('../state/store');
    const { createComposition } = await import('../model/composition');
    store.loadComposition(createComposition());
    store.setRoot(2);                                             // D
    store.setTuning({ kind: 'table', id: 'werckmeister-3' });
    expect(store.getState().root).toBe(2);
    store.setTunedFrom(2);                                        // the table on D
    expect(store.getState().root).toBe(0);                        // still D
    store.setTuning({ kind: 'edo', divisions: 12, equave: 'octave' });
    expect(store.getState()).toMatchObject({ root: 2, tunedFrom: 0 });
  });
});
