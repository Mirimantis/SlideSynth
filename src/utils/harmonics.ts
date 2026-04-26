// Harmonic Prism — pure chord-offset math.
//
// Given a ChordSpec, `chordOffsets` returns MIDI-semitone offsets from the
// base pitch, one per voice (offsets[0] is the root, always 0 before
// direction is applied).
//
// Two tuning paths:
//   • 12-TET: additive semitone steps from a compact interval pattern.
//   • Just Intonation: prescribed frequency-ratio chains per
//     (stacking, quality, numVoices). Ratios stay as ratios until a single
//     final log2 conversion — never sum semitones of individual intervals
//     for JI, that reintroduces 12-TET drift.

export type StackingStyle = 'tertian' | 'quartal' | 'quintal' | 'secondal';
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'dominant'
  | 'diminished'
  | 'augmented'
  | 'sus2'
  | 'sus4'
  | 'perfect';
export type TuningSystem = '12-TET' | 'just-intonation';
export type Direction = 'up' | 'down' | 'symmetric';
export type NumVoices = 2 | 3 | 4 | 5;

export interface ChordSpec {
  stacking: StackingStyle;
  quality: ChordQuality;
  numVoices: NumVoices;
  tuning: TuningSystem;
  direction: Direction;
}

export const DEFAULT_CHORD_SPEC: ChordSpec = {
  stacking: 'tertian',
  quality: 'major',
  numVoices: 3,
  tuning: '12-TET',
  direction: 'up',
};

// ── 12-TET interval patterns ─────────────────────────────────────
// Each pattern is the step (semitones) between successive voices,
// starting from the root. Patterns repeat cyclically if numVoices > length+1.

const TERTIAN_STEPS_12TET: Record<ChordQuality, number[]> = {
  major:      [4, 3, 4, 3],      // 0, 4, 7, 11, 14  (triad → maj7 → maj9)
  minor:      [3, 4, 3, 4],      // 0, 3, 7, 10, 14  (triad → m7 → m9)
  dominant:   [4, 3, 3, 4],      // 0, 4, 7, 10, 14  (triad identical to major; 7th is minor)
  diminished: [3, 3, 3, 3],      // 0, 3, 6, 9, 12   (triad → dim7)
  augmented:  [4, 4, 4, 4],      // 0, 4, 8, 12      (stacked M3s)
  sus2:       [2, 5, 5, 2],      // 0, 2, 7, 12, 14
  sus4:       [5, 2, 5, 2],      // 0, 5, 7, 12, 14
  perfect:    [7, 5, 7, 5],      // 0, 7, 12, 19, 24 (stacked P5s; falls through for tertian)
};

// For non-tertian stackings, the "quality" is usually just perfect.
// We allow a couple of variants (augmented 4th, diminished 5th) for flavor.
function uniformStep12TET(stacking: StackingStyle, quality: ChordQuality): number {
  switch (stacking) {
    case 'secondal':
      return quality === 'minor' ? 1 : 2;
    case 'quartal':
      return quality === 'augmented' ? 6 : 5;
    case 'quintal':
      return quality === 'diminished' ? 6 : 7;
    default:
      return 4; // tertian uses the pattern table, not this path
  }
}

// ── Just Intonation ratio chains ─────────────────────────────────
// Indexed by [stacking][quality][numVoices-1]. Each chain includes the
// root as 1/1. Numerator/denominator kept as literals for readability.
// Empty (undefined) slots fall through to uniform-stack generation.

type ChainTable = Partial<Record<ChordQuality, readonly (readonly number[])[]>>;

const TERTIAN_JI: ChainTable = {
  // [dyad, triad, tetrad, pentad]
  major: [
    [1/1, 5/4],
    [1/1, 5/4, 3/2],
    [1/1, 5/4, 3/2, 15/8],          // maj7
    [1/1, 5/4, 3/2, 15/8, 9/4],     // maj9 (9/8 × 2)
  ],
  minor: [
    [1/1, 6/5],
    [1/1, 6/5, 3/2],
    [1/1, 6/5, 3/2, 9/5],           // m7
    [1/1, 6/5, 3/2, 9/5, 9/4],      // m9
  ],
  dominant: [
    [1/1, 5/4],
    [1/1, 5/4, 3/2],
    [1/1, 5/4, 3/2, 7/4],           // dom7 with harmonic seventh
    [1/1, 5/4, 3/2, 7/4, 9/4],      // dom9
  ],
  diminished: [
    [1/1, 6/5],
    [1/1, 6/5, 36/25],
    [1/1, 6/5, 36/25, 216/125],     // dim7 (three stacked 6/5s)
    [1/1, 6/5, 36/25, 216/125, 1296/625],
  ],
  augmented: [
    [1/1, 5/4],
    [1/1, 5/4, 25/16],              // two stacked 5/4
    [1/1, 5/4, 25/16, 125/64],
    [1/1, 5/4, 25/16, 125/64, 625/256],
  ],
  sus2: [
    [1/1, 9/8],
    [1/1, 9/8, 3/2],
    [1/1, 9/8, 3/2, 2/1],
    [1/1, 9/8, 3/2, 2/1, 9/4],
  ],
  sus4: [
    [1/1, 4/3],
    [1/1, 4/3, 3/2],
    [1/1, 4/3, 3/2, 2/1],
    [1/1, 4/3, 3/2, 2/1, 9/4],
  ],
  perfect: [
    [1/1, 3/2],
    [1/1, 3/2, 9/4],
    [1/1, 3/2, 9/4, 27/8],
    [1/1, 3/2, 9/4, 27/8, 81/16],
  ],
};

// For secondal/quartal/quintal we just stack a single ratio repeatedly.
function uniformStepRatioJI(stacking: StackingStyle, quality: ChordQuality): number {
  switch (stacking) {
    case 'secondal':
      return quality === 'minor' ? 16/15 : 9/8;
    case 'quartal':
      return quality === 'augmented' ? 45/32 : 4/3;
    case 'quintal':
      return quality === 'diminished' ? 45/32 : 3/2;
    default:
      return 5/4; // unreachable in practice
  }
}

// ── Math helpers ──────────────────────────────────────────────────

function ratioToSemitones(ratio: number): number {
  return 12 * Math.log2(ratio);
}

// ── Core computation ─────────────────────────────────────────────

function chordOffsets12TET(spec: ChordSpec): number[] {
  const offsets: number[] = [0];
  if (spec.stacking === 'tertian') {
    const pattern = TERTIAN_STEPS_12TET[spec.quality] ?? TERTIAN_STEPS_12TET.major;
    let acc = 0;
    for (let i = 1; i < spec.numVoices; i++) {
      acc += pattern[(i - 1) % pattern.length]!;
      offsets.push(acc);
    }
  } else {
    const step = uniformStep12TET(spec.stacking, spec.quality);
    for (let i = 1; i < spec.numVoices; i++) offsets.push(i * step);
  }
  return offsets;
}

function chordOffsetsJI(spec: ChordSpec): number[] {
  if (spec.stacking === 'tertian') {
    const chains = TERTIAN_JI[spec.quality];
    // Table starts at dyad (numVoices=2) → index 0.
    const chain = chains?.[spec.numVoices - 2];
    if (!chain) return chordOffsets12TET(spec); // safety net
    return chain.map(ratioToSemitones);
  }

  // Non-tertian: stack a single ratio multiplicatively.
  const ratio = uniformStepRatioJI(spec.stacking, spec.quality);
  const offsets: number[] = [0];
  let product = 1;
  for (let i = 1; i < spec.numVoices; i++) {
    product *= ratio;
    offsets.push(ratioToSemitones(product));
  }
  return offsets;
}

function applyDirection(offsets: number[], direction: Direction): number[] {
  if (direction === 'up') return offsets.slice();
  if (direction === 'down') return offsets.map(o => (o === 0 ? 0 : -o));
  // symmetric: shift so the median-index offset is 0 (base sits at middle voice).
  const midIdx = Math.floor((offsets.length - 1) / 2);
  const shift = offsets[midIdx] ?? 0;
  return offsets.map(o => o - shift);
}

/**
 * Compute semitone offsets from the base pitch for a chord spec.
 * Returns one number per voice. Offsets are additive in MIDI-note space,
 * so `baseY + offsets[i]` gives the voice's pitch regardless of whether
 * the base is at an integer or fractional MIDI note.
 */
export function chordOffsets(spec: ChordSpec): number[] {
  const base =
    spec.tuning === '12-TET' ? chordOffsets12TET(spec) : chordOffsetsJI(spec);
  return applyDirection(base, spec.direction);
}

// ── UI helpers ────────────────────────────────────────────────────

export const STACKING_LABELS: Record<StackingStyle, string> = {
  tertian: 'Tertian (3rds)',
  quartal: 'Quartal (4ths)',
  quintal: 'Quintal (5ths)',
  secondal: 'Secondal (2nds)',
};

export const QUALITY_LABELS: Record<ChordQuality, string> = {
  major: 'Major',
  minor: 'Minor',
  dominant: 'Dominant',
  diminished: 'Diminished',
  augmented: 'Augmented',
  sus2: 'Sus2',
  sus4: 'Sus4',
  perfect: 'Perfect',
};

export const TUNING_LABELS: Record<TuningSystem, string> = {
  '12-TET': 'Equal (12-TET)',
  'just-intonation': 'Just Intonation',
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  up: 'Above base',
  down: 'Below base',
  symmetric: 'Around base',
};

/**
 * Qualities that are musically meaningful for each stacking style.
 * UI should restrict the quality dropdown to these. The harmonics engine
 * itself is robust to any combination (falls back gracefully).
 */
export const RELEVANT_QUALITIES: Record<StackingStyle, ChordQuality[]> = {
  tertian: ['major', 'minor', 'dominant', 'diminished', 'augmented', 'sus2', 'sus4'],
  quartal: ['perfect', 'augmented'],
  quintal: ['perfect', 'diminished'],
  secondal: ['major', 'minor'],
};
