import { describe, it, expect } from 'vitest';
import { MAX_SCL_BYTES, SclError, parseScl, toScl } from './scl';
import {
  ALL_NOTES, MAX_IMPORTED_NOTES, TWELVE_EDO, pitchSetFor, resolveTuning, staffGridFor,
  type ImportedTuningRef, type PitchSettings,
} from './tuning';

const settings = (over: Partial<PitchSettings> = {}): PitchSettings => ({
  tuning: TWELVE_EDO, root: 0, scaleId: ALL_NOTES, customScale: null, tunedFrom: 0, hidePitchLines: false, ...over,
});

/** The example from the Scala format page. */
const MEANTONE = `! meanquar.scl
!
1/4-comma meantone scale. Pietro Aaron's temperament (1523)
 12
!
 76.04900
 193.15686
 310.26471
 5/4
 503.42157
 579.47057
 696.57843
 25/16
 889.73529
 1006.84314
 1082.89214
 2/1
`;

const scl = (lines: string[], description = 'test') => ['! t.scl', description, ` ${lines.length}`, ...lines.map(l => ` ${l}`)].join('\n');

describe('reading .scl files (BACKLOG 13.8 (d))', () => {
  it('reads the Scala example', () => {
    const t = parseScl(MEANTONE, 'meanquar.scl');
    expect(t).toMatchObject({ kind: 'imported', name: 'meanquar', periodRatio: '2/1' });
    expect(t.description).toBe('1/4-comma meantone scale. Pietro Aaron\'s temperament (1523)');
    expect(t.degrees).toHaveLength(12);
    expect(t.degrees[0]).toBe(0);
    expect(t.degrees[4]).toBeCloseTo(386.3137, 3);
    expect(t.period).toBeCloseTo(1200, 9);
    expect(t.ratios[4]).toBe('5/4');
    expect(t.ratios[1]).toBeNull();
    // 12 notes to the octave: letters, like the built-in tables.
    expect(resolveTuning(t).naming).toBe('letters');
  });

  it('ignores comments and text after a pitch, and reads "2" as 2/1', () => {
    const t = parseScl(['!', '', '! a comment', ' 2', '  3/2  the fifth', '!', ' 2   octave'].join('\r\n'), 'fifths.scl');
    expect(t.description).toBe('');
    expect(t.degrees.map(d => Math.round(d * 100) / 100)).toEqual([0, 701.96]);
    expect(t.periodRatio).toBe('2/1');
  });

  it('a cents-only file numbers its notes; 1/1 isn’t called a ratio', () => {
    const t = parseScl(scl(['100.0', '250.0', '1200.0']), 'x.scl');
    expect(t.ratios).toEqual([null, null, null]);
    expect(t.periodRatio).toBeNull();
    expect(staffGridFor({ ...settings({ tuning: t }) }).lines.find(l => l.degree === 2)?.label).toBe('3');
  });

  it('sorts, drops repeats and folds notes into the period', () => {
    const t = parseScl(scl(['300.0', '100.0', '100.0', '1500.0', '1200.0']), 'x.scl');
    expect(t.degrees).toEqual([0, 100, 300]);
  });

  it('reads non-octave tunings: Bohlen–Pierce as ratios', () => {
    const bp = ['27/25', '25/21', '9/7', '7/5', '75/49', '5/3', '9/5', '49/25', '15/7', '7/3', '63/25', '25/9', '3/1'];
    const t = parseScl(scl(bp, 'Bohlen-Pierce'), 'bp.scl');
    expect(t.degrees).toHaveLength(13);
    expect(t.period).toBeCloseTo(1901.955, 3);
    expect(t.periodRatio).toBe('3/1');
    expect(resolveTuning(t).naming).toBe('ratios');
  });

  it('keeps the description as short, plain text', () => {
    const t = parseScl(scl(['2/1'], `<img src=x onerror=alert(1)>\u0007${'x'.repeat(500)}`), 'x.scl');
    expect(t.description.length).toBeLessThanOrEqual(200);
    expect(t.description).not.toContain('\u0007');
  });

  it('explains what’s wrong with a bad file', () => {
    const bad = (text: string) => { try { parseScl(text, 'x.scl'); return ''; } catch (e) { expect(e).toBeInstanceOf(SclError); return (e as Error).message; } };
    expect(bad('')).toMatch(/number of notes/);
    expect(bad('desc\n 3\n 100.0\n 2/1')).toMatch(/says 3 notes but has 2/);
    expect(bad('desc\n 2\n abc\n 2/1')).toMatch(/line 3: "abc"/);
    expect(bad('desc\n 1\n 0/1')).toMatch(/ratio/);
    expect(bad('desc\n 1\n -100.0')).toMatch(/period/);
    expect(bad('desc\n 1\n 50.0')).toMatch(/period must be between/);
    expect(bad(scl(Array.from({ length: MAX_IMPORTED_NOTES + 1 }, (_, i) => ((i + 1) * 0.5).toFixed(2))))).toMatch(/notes/);
    expect(bad('x'.repeat(MAX_SCL_BYTES + 1))).toMatch(/too large/);
  });

  it('a large file works, and fills the staff and snapping', () => {
    const lines = Array.from({ length: 192 }, (_, i) => ((i + 1) * 1200 / 192).toFixed(5));
    const t = parseScl(scl(lines), 'edo192.scl');
    expect(t.degrees).toHaveLength(192);
    const s = settings({ tuning: t });
    const started = performance.now();
    const grid = staffGridFor(s);
    const notes = pitchSetFor(s)!.notes;
    expect(performance.now() - started).toBeLessThan(500);
    expect(grid.lines.length).toBe(notes.length);
    expect(notes.length).toBeGreaterThan(192 * 8);
  });

  it('a saved composition’s imported tuning is checked before use', () => {
    const broken = { kind: 'imported', name: 'x', description: '', degrees: [0, 500, 400], period: 1200, ratios: [], periodRatio: null } as ImportedTuningRef;
    expect(resolveTuning(broken).key).toBe('edo-12');
  });
});

describe('writing .scl files (BACKLOG 13.8 (d))', () => {
  const pitches = (text: string) => text.split('\n').filter(l => l.startsWith(' ')).slice(1).map(l => l.trim());

  it('12-EDO C major: the scale from the root, the period last', () => {
    const { text, fileName } = toScl(settings({ scaleId: 'major' }));
    expect(pitches(text)).toEqual(['200.00000', '400.00000', '500.00000', '700.00000', '900.00000', '1100.00000', '2/1']);
    expect(text).toContain('\n 7\n');
    expect(text).toContain('12-EDO, C Major (Ionian)');
    expect(fileName).toBe('12-EDO-C-Major-Ionian.scl');
  });

  it('just intonation keeps its ratios, counted from the root', () => {
    const { text } = toScl(settings({ tuning: { kind: 'table', id: 'ji-5-limit' }, root: 2, scaleId: 'major' }));
    // D major in the 5-limit table, over D's 9/8: E 5/4 → 10/9, F# 45/32 → 5/4, and C# (16/15)
    // wraps an octave: 32/15 → 256/135.
    expect(pitches(text)).toEqual(['10/9', '5/4', '4/3', '40/27', '5/3', '256/135', '2/1']);
  });

  it('All notes writes the whole tuning; round trips through import', () => {
    const edo19 = settings({ tuning: { kind: 'edo', divisions: 19, equave: 'octave' }, root: 3 });
    const back = parseScl(toScl(edo19).text, 'x.scl');
    expect(back.degrees).toHaveLength(19);
    expect(back.degrees[1]).toBeCloseTo(1200 / 19, 4);
    expect(back.periodRatio).toBe('2/1');
  });
});

describe('the store and files keep imported tunings (BACKLOG 13.8 (d))', () => {
  it('imports keep the root’s pitch, and stay on offer after switching away', async () => {
    const { store } = await import('../state/store');
    const { createComposition } = await import('../model/composition');
    store.loadComposition(createComposition());
    store.setRoot(4);                                             // E
    const t = parseScl(MEANTONE, 'meanquar.scl');
    store.importTuning(t);
    expect(store.getState().root).toBe(4);
    store.setTuning({ ...TWELVE_EDO });
    expect(store.getState().importedTuning).toEqual(t);
  });

  it('round-trips through a saved file', async () => {
    const { store } = await import('../state/store');
    const { serializeComposition, deserializeComposition } = await import('../export/json-export');
    const t = parseScl(MEANTONE, 'meanquar.scl');
    store.importTuning(t);
    const loaded = deserializeComposition(serializeComposition(store.getComposition()));
    expect(loaded.snap.tuning).toEqual(t);
    expect(loaded.snap.importedTuning).toEqual(t);
  });
});
