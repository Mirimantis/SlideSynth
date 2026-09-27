import { describe, it, expect, beforeEach } from 'vitest';
import { fretsToScale, scaleToFrets } from './frets-scale';
import { ALL_NOTES, TWELVE_EDO, pitchSetFor, type PitchSettings, type TuningRef } from './tuning';
import type { GuideDefinition } from '../types';
import { store } from '../state/store';
import { createComposition } from '../model/composition';

const settings = (over: Partial<PitchSettings> = {}): PitchSettings => ({
  tuning: TWELVE_EDO, root: 0, scaleId: ALL_NOTES, customScale: null, tunedFrom: 0, hidePitchLines: false, ...over,
});
const octaveFret = (position: number): GuideDefinition => ({ id: `f${position}`, orientation: 'y', position, label: '', repeat: 'octave' });
const singleFret = (position: number): GuideDefinition => ({ id: `s${position}`, orientation: 'y', position, label: '' });

describe('scale → frets (BACKLOG 13.8 (f))', () => {
  it('an octave fret on each note of the scale, near C4', () => {
    const frets = scaleToFrets(settings({ root: 2, scaleId: 'major' }), [])!;
    // Each in the octave from C4, so D major's C# is C#4.
    expect(frets.map(f => f.position).sort((a, b) => a - b)).toEqual([6100, 6200, 6400, 6600, 6700, 6900, 7100]);
    expect(frets.every(f => f.repeat === 'octave' && f.orientation === 'y')).toBe(true);
  });

  it('skips notes an octave fret already covers, in any octave', () => {
    const frets = scaleToFrets(settings({ scaleId: 'major' }), [octaveFret(8300), singleFret(6400)])!;
    expect(frets.map(f => f.position)).toEqual([6000, 6200, 6400, 6500, 6700, 6900]);   // no B: 8300 is B5
  });

  it('refuses a scale with more notes than frets can show', () => {
    expect(scaleToFrets(settings({ tuning: { kind: 'edo', divisions: 72, equave: 'octave' } }), [])).not.toBeNull();
    const big: TuningRef = {
      kind: 'imported', name: 'big', description: '', period: 1200, periodRatio: '2/1',
      degrees: Array.from({ length: 100 }, (_, i) => i * 12), ratios: Array.from({ length: 100 }, () => null),
    };
    expect(scaleToFrets(settings({ tuning: big }), [])).toBeNull();
  });
});

describe('frets → scale (BACKLOG 13.8 (f))', () => {
  it('a round trip gives the named scale back', () => {
    const s = settings({ root: 2, scaleId: 'major' });
    expect(fretsToScale(s, scaleToFrets(s, [])!)).toEqual({ kind: 'scale', root: 2, scaleId: 'major', customScale: null });
  });

  it('frets on the tuning’s notes make a Custom scale; single frets don’t count', () => {
    const frets = [6000, 6300, 6700, 7000].map(octaveFret);
    expect(fretsToScale(settings(), [...frets, singleFret(6100)])).toEqual({
      kind: 'scale', root: 0, scaleId: 'custom', customScale: { size: 12, steps: [0, 3, 7, 10] },
    });
  });

  it('the root moves to the nearest fret when no fret is on it', () => {
    const result = fretsToScale(settings({ root: 1 }), [6000, 6400, 6700].map(octaveFret));
    expect(result).toMatchObject({ kind: 'scale', root: 0 });
  });

  it('frets off the tuning’s notes make a tuning of their own, from the root fret', () => {
    // A microtonal pentatonic: D, E-14¢, G+2¢, A, B-12¢, root D.
    const frets = [6200, 6386, 6702, 6900, 7088].map(octaveFret);
    const result = fretsToScale(settings({ root: 2 }), frets)!;
    expect(result.kind).toBe('tuning');
    if (result.kind !== 'tuning') return;
    expect(result.tunedFrom).toBe(2);
    expect(result.tuning.degrees).toEqual([0, 186, 502, 700, 888]);
    expect(result.tuning.period).toBe(1200);
    // It plays exactly the frets' pitches.
    const notes = pitchSetFor({ ...settings(), tuning: result.tuning, tunedFrom: result.tunedFrom })!.notes;
    for (const f of frets) expect(notes).toContain(f.position);
  });

  it('a root fret between standard notes puts Tuned from between them', () => {
    const result = fretsToScale(settings(), [6017, 6400].map(octaveFret))!;
    expect(result).toMatchObject({ kind: 'tuning', tunedFrom: 0.17 });
  });

  it('no octave frets, nothing to make', () => {
    expect(fretsToScale(settings(), [singleFret(6000)])).toBeNull();
  });
});

describe('the store’s conversions (BACKLOG 13.8 (f))', () => {
  beforeEach(() => store.loadComposition(createComposition()));

  it('scale → frets turns pitch lines off; frets → scale uses the octave frets up and turns them back on', () => {
    store.setScaleId('major-penta');
    expect(store.addScaleFrets()).toBe(5);
    expect(store.getState().hidePitchLines).toBe(true);
    store.addGuide(singleFret(6150));
    store.updateGuide(store.getComposition().guides[1]!.id, { position: 6215 });   // nudge D up 15¢
    const result = store.applyFretsAsScale();
    expect(result?.kind).toBe('tuning');
    const st = store.getState();
    expect(st.hidePitchLines).toBe(false);
    expect(st.tuning).toMatchObject({ kind: 'imported', name: 'From frets' });
    expect(st.importedTuning).toEqual(st.tuning);
    expect(st.composition.guides.map(g => g.id)).toEqual(['s6150']);
    expect(pitchSetFor(st)!.notes).toContain(6215);
  });
});
