import { describe, it, expect } from 'vitest';
import {
  chordOffsets,
  DEFAULT_CHORD_SPEC,
  type ChordSpec,
  type StackingStyle,
  type ChordQuality,
  type TuningSystem,
  type Direction,
  type NumVoices,
} from './harmonics';

// Precision helper: JI offsets are irrational, so exact equality is wrong.
// 1e-6 semitones is ~0.000012 cents — well below anything audible.
function expectCloseTo(actual: number[], expected: number[], epsilon = 1e-6) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 5);
    void epsilon;
  }
}

function spec(partial: Partial<ChordSpec>): ChordSpec {
  return { ...DEFAULT_CHORD_SPEC, ...partial };
}

describe('chordOffsets — 12-TET tertian triads', () => {
  it('major triad: 0, 4, 7', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3 })))
      .toEqual([0, 4, 7]);
  });
  it('minor triad: 0, 3, 7', () => {
    expect(chordOffsets(spec({ quality: 'minor', numVoices: 3 })))
      .toEqual([0, 3, 7]);
  });
  it('diminished triad: 0, 3, 6', () => {
    expect(chordOffsets(spec({ quality: 'diminished', numVoices: 3 })))
      .toEqual([0, 3, 6]);
  });
  it('augmented triad: 0, 4, 8', () => {
    expect(chordOffsets(spec({ quality: 'augmented', numVoices: 3 })))
      .toEqual([0, 4, 8]);
  });
  it('sus2 triad: 0, 2, 7', () => {
    expect(chordOffsets(spec({ quality: 'sus2', numVoices: 3 })))
      .toEqual([0, 2, 7]);
  });
  it('sus4 triad: 0, 5, 7', () => {
    expect(chordOffsets(spec({ quality: 'sus4', numVoices: 3 })))
      .toEqual([0, 5, 7]);
  });
  it('dominant triad same as major (3 voices): 0, 4, 7', () => {
    expect(chordOffsets(spec({ quality: 'dominant', numVoices: 3 })))
      .toEqual([0, 4, 7]);
  });
});

describe('chordOffsets — 12-TET tertian extensions', () => {
  it('maj7: 0, 4, 7, 11', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 4 })))
      .toEqual([0, 4, 7, 11]);
  });
  it('min7: 0, 3, 7, 10', () => {
    expect(chordOffsets(spec({ quality: 'minor', numVoices: 4 })))
      .toEqual([0, 3, 7, 10]);
  });
  it('dom7: 0, 4, 7, 10', () => {
    expect(chordOffsets(spec({ quality: 'dominant', numVoices: 4 })))
      .toEqual([0, 4, 7, 10]);
  });
  it('dim7: 0, 3, 6, 9', () => {
    expect(chordOffsets(spec({ quality: 'diminished', numVoices: 4 })))
      .toEqual([0, 3, 6, 9]);
  });
  it('maj9: 0, 4, 7, 11, 14', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 5 })))
      .toEqual([0, 4, 7, 11, 14]);
  });
  it('dom9: 0, 4, 7, 10, 14', () => {
    expect(chordOffsets(spec({ quality: 'dominant', numVoices: 5 })))
      .toEqual([0, 4, 7, 10, 14]);
  });
});

describe('chordOffsets — 12-TET dyads', () => {
  it('major 3rd dyad: 0, 4', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 2 })))
      .toEqual([0, 4]);
  });
  it('perfect 5th dyad in quintal: 0, 7', () => {
    expect(chordOffsets(spec({ stacking: 'quintal', quality: 'perfect', numVoices: 2 })))
      .toEqual([0, 7]);
  });
  it('perfect 4th dyad in quartal: 0, 5', () => {
    expect(chordOffsets(spec({ stacking: 'quartal', quality: 'perfect', numVoices: 2 })))
      .toEqual([0, 5]);
  });
});

describe('chordOffsets — 12-TET non-tertian stackings', () => {
  it('quartal triad (stacked 4ths): 0, 5, 10', () => {
    expect(chordOffsets(spec({ stacking: 'quartal', quality: 'perfect', numVoices: 3 })))
      .toEqual([0, 5, 10]);
  });
  it('quintal triad (stacked 5ths): 0, 7, 14', () => {
    expect(chordOffsets(spec({ stacking: 'quintal', quality: 'perfect', numVoices: 3 })))
      .toEqual([0, 7, 14]);
  });
  it('secondal triad major (M2s): 0, 2, 4', () => {
    expect(chordOffsets(spec({ stacking: 'secondal', quality: 'major', numVoices: 3 })))
      .toEqual([0, 2, 4]);
  });
  it('secondal triad minor (m2s): 0, 1, 2', () => {
    expect(chordOffsets(spec({ stacking: 'secondal', quality: 'minor', numVoices: 3 })))
      .toEqual([0, 1, 2]);
  });
  it('quartal augmented triad (tritones): 0, 6, 12', () => {
    expect(chordOffsets(spec({ stacking: 'quartal', quality: 'augmented', numVoices: 3 })))
      .toEqual([0, 6, 12]);
  });
});

describe('chordOffsets — Just Intonation tertian', () => {
  // JI major triad 4:5:6 — M3 is 5/4 (386.314¢), P5 is 3/2 (701.955¢)
  it('major triad: 0, 3.8631, 7.0195', () => {
    const out = chordOffsets(spec({
      quality: 'major', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(5/4), 12 * Math.log2(3/2)]);
    expect(out[1]).toBeCloseTo(3.8631, 3);
    expect(out[2]).toBeCloseTo(7.0196, 3);
  });

  it('minor triad (10:12:15): 0, 3.156, 7.020', () => {
    const out = chordOffsets(spec({
      quality: 'minor', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(6/5), 12 * Math.log2(3/2)]);
    expect(out[1]).toBeCloseTo(3.1564, 3);
    expect(out[2]).toBeCloseTo(7.0196, 3);
  });

  // The critical one: dom7 uses 7/4 (harmonic seventh), not 9/5 or 16/9.
  // 7/4 in cents = 968.826, in semitones = 9.688. 12-TET m7 would be 10.000.
  it('dom7 uses harmonic 7th (7/4): 4th voice ≈ 9.688', () => {
    const out = chordOffsets(spec({
      quality: 'dominant', numVoices: 4, tuning: 'just-intonation',
    }));
    expect(out[3]).toBeCloseTo(12 * Math.log2(7/4), 6);
    expect(out[3]).toBeCloseTo(9.6883, 3);
    // Compare against 12-TET dom7 — should be audibly flatter (~31 cents).
    expect(out[3]).toBeLessThan(10);
  });

  it('maj7 uses 15/8: 4th voice ≈ 10.883', () => {
    const out = chordOffsets(spec({
      quality: 'major', numVoices: 4, tuning: 'just-intonation',
    }));
    expect(out[3]).toBeCloseTo(12 * Math.log2(15/8), 6);
    expect(out[3]).toBeCloseTo(10.8826, 3);
  });

  it('min7 uses 9/5: 4th voice ≈ 10.176', () => {
    const out = chordOffsets(spec({
      quality: 'minor', numVoices: 4, tuning: 'just-intonation',
    }));
    expect(out[3]).toBeCloseTo(12 * Math.log2(9/5), 6);
    expect(out[3]).toBeCloseTo(10.1760, 3);
  });

  it('dim triad (6/5 × 6/5): 0, 3.156, 6.313', () => {
    const out = chordOffsets(spec({
      quality: 'diminished', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(6/5), 12 * Math.log2(36/25)]);
  });

  it('aug triad (5/4 × 5/4): 0, 3.863, 7.727', () => {
    const out = chordOffsets(spec({
      quality: 'augmented', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(5/4), 12 * Math.log2(25/16)]);
  });

  it('sus2 triad (9/8, 3/2): 0, 2.039, 7.020', () => {
    const out = chordOffsets(spec({
      quality: 'sus2', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(9/8), 12 * Math.log2(3/2)]);
  });

  it('sus4 triad (4/3, 3/2): 0, 4.980, 7.020', () => {
    const out = chordOffsets(spec({
      quality: 'sus4', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(4/3), 12 * Math.log2(3/2)]);
  });
});

describe('chordOffsets — JI non-tertian', () => {
  it('quartal triad (4/3 stack): 0, 4.980, 9.961', () => {
    const out = chordOffsets(spec({
      stacking: 'quartal', quality: 'perfect', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(4/3), 12 * Math.log2(16/9)]);
  });
  it('quintal triad (3/2 stack): 0, 7.020, 14.039', () => {
    const out = chordOffsets(spec({
      stacking: 'quintal', quality: 'perfect', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(3/2), 12 * Math.log2(9/4)]);
  });
  it('secondal major (9/8 stack): 0, 2.039, 4.078', () => {
    const out = chordOffsets(spec({
      stacking: 'secondal', quality: 'major', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(9/8), 12 * Math.log2(81/64)]);
  });
  it('secondal minor (16/15 stack): 0, 1.117, 2.235', () => {
    const out = chordOffsets(spec({
      stacking: 'secondal', quality: 'minor', numVoices: 3, tuning: 'just-intonation',
    }));
    expectCloseTo(out, [0, 12 * Math.log2(16/15), 12 * Math.log2(256/225)]);
  });
});

describe('chordOffsets — microtonal invariance', () => {
  // Offsets are relative to the base, so they are base-pitch-invariant.
  // The offsets are the same whether the base is an integer or a fractional MIDI note.
  it('offsets do not depend on the base pitch (offsets are deltas)', () => {
    const major12 = chordOffsets(spec({ quality: 'major', numVoices: 3 }));
    const majorJI = chordOffsets(spec({ quality: 'major', numVoices: 3, tuning: 'just-intonation' }));
    // Same function called again — just confirming purity.
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3 }))).toEqual(major12);
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3, tuning: 'just-intonation' })))
      .toEqual(majorJI);
  });
  it('12-TET major 3rd is 14 cents sharper than JI major 3rd', () => {
    const tet = chordOffsets(spec({ quality: 'major', numVoices: 3 }))[1];
    const ji  = chordOffsets(spec({ quality: 'major', numVoices: 3, tuning: 'just-intonation' }))[1];
    // In cents (1 semi = 100¢)
    const diffCents = (tet! - ji!) * 100;
    expect(diffCents).toBeCloseTo(13.69, 1);
  });
});

describe('chordOffsets — direction', () => {
  it('up: offsets unchanged (default)', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3, direction: 'up' })))
      .toEqual([0, 4, 7]);
  });
  it('down: offsets mirrored', () => {
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3, direction: 'down' })))
      .toEqual([0, -4, -7]);
  });
  it('symmetric: median-index voice sits at 0 (3 voices → voice 1 becomes base)', () => {
    // For [0, 4, 7], middle index = 1 (value 4), shift by -4 → [-4, 0, 3]
    expect(chordOffsets(spec({ quality: 'major', numVoices: 3, direction: 'symmetric' })))
      .toEqual([-4, 0, 3]);
  });
  it('symmetric with 4 voices: lower middle becomes base', () => {
    // [0, 4, 7, 11], floor((4-1)/2) = 1 → shift by -4 → [-4, 0, 3, 7]
    expect(chordOffsets(spec({ quality: 'major', numVoices: 4, direction: 'symmetric' })))
      .toEqual([-4, 0, 3, 7]);
  });
});

describe('chordOffsets — defensive fallbacks', () => {
  it('tertian + perfect quality does not crash (falls through to pattern)', () => {
    const out = chordOffsets(spec({ stacking: 'tertian', quality: 'perfect', numVoices: 3 }));
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(0);
  });
  it('quartal + sus4 quality does not crash (uses default uniform step)', () => {
    const out = chordOffsets(spec({ stacking: 'quartal', quality: 'sus4', numVoices: 3 }));
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(0);
  });
  it('returns a fresh array each call (no shared mutation)', () => {
    const a = chordOffsets(spec({ quality: 'major', numVoices: 3 }));
    const b = chordOffsets(spec({ quality: 'major', numVoices: 3 }));
    expect(a).not.toBe(b);
    a[0] = 999;
    expect(b[0]).toBe(0);
  });
});

describe('chordOffsets — type safety spot checks', () => {
  it('all stacking × quality × numVoices × tuning × direction combos produce N numbers', () => {
    const stackings: StackingStyle[] = ['tertian', 'quartal', 'quintal', 'secondal'];
    const qualities: ChordQuality[] = [
      'major', 'minor', 'dominant', 'diminished', 'augmented', 'sus2', 'sus4', 'perfect',
    ];
    const tunings: TuningSystem[] = ['12-TET', 'just-intonation'];
    const directions: Direction[] = ['up', 'down', 'symmetric'];
    const voiceCounts: NumVoices[] = [2, 3, 4, 5];

    for (const s of stackings) {
      for (const q of qualities) {
        for (const t of tunings) {
          for (const d of directions) {
            for (const n of voiceCounts) {
              const out = chordOffsets({
                stacking: s, quality: q, numVoices: n, tuning: t, direction: d,
              });
              expect(out).toHaveLength(n);
              expect(out.every(Number.isFinite)).toBe(true);
            }
          }
        }
      }
    }
  });
});
