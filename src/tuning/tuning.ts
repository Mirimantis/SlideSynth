import { MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_SEMITONE, CENTS_PER_OCTAVE } from '../constants';

/**
 * Tunings (BACKLOG 13.8, spec in DESIGN.md › Tuning spec).
 *
 * Three settings pick the pitch grid:
 * - **Tuning** — which pitches exist: a period (usually the octave) divided
 *   into degrees;
 * - **Root** — which degree is home (an index into the tuning's degrees);
 * - **Scale** — which degrees the piece uses, counted from the root, or all.
 *
 * A fourth, **Tuned from**, is where the tuning's degree 0 sits against the
 * 12 standard notes: C by default. It matters for tunings whose degrees
 * aren't evenly spaced (a Werckmeister table on C and on D are different
 * pieces) and for any tuning that isn't 12-EDO.
 *
 * Cents are absolute (0 = C-1), so degree 0 of a tuning tuned from C sits on
 * every C. Tune A4 is separate: it moves Hz, never the grid.
 */

export type Equave = 'octave' | 'tritave';

/** A tuning, as stored in a composition. */
export type TuningRef =
  | { kind: 'edo'; divisions: number; equave: Equave }
  | { kind: 'table'; id: string };

export const TWELVE_EDO: TuningRef = { kind: 'edo', divisions: 12, equave: 'octave' };
export const MIN_EDO = 5;
export const MAX_EDO = 72;
const TRITAVE_CENTS = CENTS_PER_OCTAVE * Math.log2(3);

export type TuningGroup = 'Equal divisions' | 'Just intonation' | 'Historical' | 'Traditional';

/** A fixed table of degrees. */
interface TuningTable {
  id: string;
  name: string;
  group: Exclude<TuningGroup, 'Equal divisions'>;
  /** Cents above degree 0, ascending, starting at 0. */
  degrees: readonly number[];
  period: number;
  /** Per-degree labels (ratios for just intonation). */
  ratios?: readonly string[];
  /** Tuned by ear or measured from instruments: one rendering of a family. */
  approximate?: boolean;
}

const ratioCents = (r: string) => {
  const [n, d] = r.split('/').map(Number);
  return CENTS_PER_OCTAVE * Math.log2(n! / d!);
};
const fromRatios = (ratios: readonly string[]) => ratios.map(ratioCents);

const JI_5_LIMIT = ['1/1', '16/15', '9/8', '6/5', '5/4', '4/3', '45/32', '3/2', '8/5', '5/3', '9/5', '15/8'];
const JI_7_LIMIT = ['1/1', '15/14', '9/8', '7/6', '5/4', '4/3', '7/5', '3/2', '8/5', '5/3', '7/4', '15/8'];
const HARMONICS_8_16 = ['1/1', '9/8', '5/4', '11/8', '3/2', '13/8', '7/4', '15/8'];

export const TUNING_TABLES: readonly TuningTable[] = [
  { id: 'ji-5-limit', name: '5-limit (12 notes)', group: 'Just intonation', degrees: fromRatios(JI_5_LIMIT), period: CENTS_PER_OCTAVE, ratios: JI_5_LIMIT },
  { id: 'ji-7-limit', name: '7-limit (12 notes)', group: 'Just intonation', degrees: fromRatios(JI_7_LIMIT), period: CENTS_PER_OCTAVE, ratios: JI_7_LIMIT },
  { id: 'ji-harmonics-8-16', name: 'Harmonics 8–16', group: 'Just intonation', degrees: fromRatios(HARMONICS_8_16), period: CENTS_PER_OCTAVE, ratios: HARMONICS_8_16 },
  // 12-note tables in cents above C.
  { id: 'meantone-quarter', name: '¼-comma meantone', group: 'Historical', period: CENTS_PER_OCTAVE,
    degrees: [0, 76.05, 193.16, 310.26, 386.31, 503.42, 579.47, 696.58, 772.63, 889.74, 1006.84, 1082.89] },
  { id: 'pythagorean', name: 'Pythagorean', group: 'Historical', period: CENTS_PER_OCTAVE,
    degrees: [0, 113.69, 203.91, 294.13, 407.82, 498.04, 611.73, 701.96, 815.64, 905.87, 996.09, 1109.78] },
  { id: 'werckmeister-3', name: 'Werckmeister III', group: 'Historical', period: CENTS_PER_OCTAVE,
    degrees: [0, 90.22, 192.18, 294.13, 390.22, 498.04, 588.27, 696.09, 792.18, 888.27, 996.09, 1092.18] },
  { id: 'kirnberger-3', name: 'Kirnberger III', group: 'Historical', period: CENTS_PER_OCTAVE,
    degrees: [0, 90.22, 193.16, 294.13, 386.31, 498.04, 590.22, 696.58, 792.18, 889.74, 996.09, 1088.27] },
  { id: 'vallotti', name: 'Vallotti', group: 'Historical', period: CENTS_PER_OCTAVE,
    degrees: [0, 94.13, 196.09, 298.04, 392.18, 501.96, 592.18, 698.04, 796.09, 894.13, 1000, 1090.22] },
  // The values the app has always shipped; real gamelan tunings vary by ensemble.
  { id: 'slendro', name: 'Slendro', group: 'Traditional', period: CENTS_PER_OCTAVE, approximate: true,
    degrees: [0, 240, 480, 720, 960] },
  { id: 'pelog', name: 'Pelog', group: 'Traditional', period: CENTS_PER_OCTAVE, approximate: true,
    degrees: [0, 160, 320, 520, 720, 840, 1080] },
];

/** How a tuning names its degrees. */
export type Naming = 'letters' | 'numbers' | 'ratios';

/** A tuning resolved to its degrees. */
export interface Tuning {
  /** Stable identity for caching and comparison. */
  key: string;
  name: string;
  group: TuningGroup;
  /** Cents above degree 0, ascending, starting at 0. */
  degrees: readonly number[];
  /** The repeat: 1200 for the octave. */
  period: number;
  naming: Naming;
  ratios?: readonly string[];
  approximate: boolean;
}

export function tuningKey(ref: TuningRef): string {
  return ref.kind === 'edo' ? `edo-${ref.divisions}${ref.equave === 'tritave' ? '-3' : ''}` : ref.id;
}

export function isTwelveEdo(ref: TuningRef): boolean {
  return ref.kind === 'edo' && ref.divisions === 12 && ref.equave === 'octave';
}

/** EDOs whose chain of fifths gives the familiar letter names (meantones). */
const LETTER_EDOS = new Set([12, 19, 31]);

const resolved = new Map<string, Tuning>();

/** A tuning's degrees. Unknown table ids fall back to 12-EDO. */
export function resolveTuning(ref: TuningRef): Tuning {
  const key = tuningKey(ref);
  const hit = resolved.get(key);
  if (hit) return hit;
  let t: Tuning;
  if (ref.kind === 'edo') {
    const n = clampDivisions(ref.divisions);
    const period = ref.equave === 'tritave' ? TRITAVE_CENTS : CENTS_PER_OCTAVE;
    t = {
      key,
      name: ref.equave === 'tritave' ? `${n} equal divisions of 3:1` : `${n}-EDO`,
      group: 'Equal divisions',
      degrees: Array.from({ length: n }, (_, i) => (i * period) / n),
      period,
      naming: ref.equave === 'octave' && LETTER_EDOS.has(n) ? 'letters' : 'numbers',
      approximate: false,
    };
  } else {
    const table = TUNING_TABLES.find(x => x.id === ref.id);
    if (!table) return resolveTuning(TWELVE_EDO);
    t = {
      key,
      name: table.name,
      group: table.group,
      degrees: table.degrees,
      period: table.period,
      // 12-note tables name their degrees by letter; other tables by ratio.
      naming: table.degrees.length === 12 ? 'letters' : 'ratios',
      ratios: table.ratios,
      approximate: !!table.approximate,
    };
  }
  resolved.set(key, t);
  return t;
}

export function clampDivisions(n: number): number {
  return Math.max(MIN_EDO, Math.min(MAX_EDO, Math.round(Number.isFinite(n) ? n : 12)));
}

// ── Degree names ────────────────────────────────────────────────

const LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Letter names for a meantone EDO, from its chain of fifths: each degree
 *  takes the name with the fewest accidentals (sharps win a tie). */
function meantoneNames(n: number): string[] {
  const fifth = Math.round(n * Math.log2(3 / 2));
  const names: Array<{ name: string; accidentals: number } | undefined> = new Array(n);
  // Chain positions -15..+19: from F double-flat to B double-sharp.
  for (let pos = -15; pos <= 19; pos++) {
    const letter = LETTERS[((pos + 1) % 7 + 7) % 7]!;
    const shift = Math.floor((pos + 1) / 7);   // sharps (+) or flats (-)
    const accidentals = Math.abs(shift);
    const name = letter + (shift > 0 ? '#'.repeat(shift) : 'b'.repeat(-shift));
    const degree = (((pos * fifth) % n) + n) % n;
    const current = names[degree];
    if (!current || accidentals < current.accidentals || (accidentals === current.accidentals && shift > 0 && current.name.includes('b'))) {
      names[degree] = { name, accidentals };
    }
  }
  return names.map((x, i) => x?.name ?? String(i));
}

const meantoneCache = new Map<number, string[]>();

/** A degree's name: a letter where the tuning has letters, else its number
 *  (1-based, as musicians count), with the ratio for just intonation. */
export function degreeName(tuning: Tuning, tunedFrom: number, degree: number): string {
  const n = tuning.degrees.length;
  const d = ((degree % n) + n) % n;
  const ratio = tuning.ratios?.[d];
  if (tuning.naming === 'letters') {
    if (n === 12) {
      const letter = PITCH_CLASS_NAMES[(((tunedFrom + d) % 12) + 12) % 12]!;
      return ratio ? `${letter} (${ratio})` : letter;
    }
    // A meantone EDO: letters only while degree 0 is on C.
    if (tunedFrom === 0) {
      let names = meantoneCache.get(n);
      if (!names) meantoneCache.set(n, names = meantoneNames(n));
      return names[d]!;
    }
  }
  if (tuning.naming === 'ratios' && ratio) return ratio;
  return String(d + 1);
}

// ── Scales ──────────────────────────────────────────────────────

export interface ScaleDefinition {
  id: string;
  name: string;
  group: string;
  /** The tunings it fits: those with this many degrees per period. */
  size: number;
  /** Degree steps from the root. */
  degrees: readonly number[];
}

/** Every degree of the tuning. */
export const ALL_NOTES = 'all';

export const SCALES: readonly ScaleDefinition[] = [
  { id: 'major', name: 'Major (Ionian)', group: 'Western Modes', size: 12, degrees: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'natural-minor', name: 'Natural Minor', group: 'Western Modes', size: 12, degrees: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic-minor', name: 'Harmonic Minor', group: 'Western Modes', size: 12, degrees: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic-minor', name: 'Melodic Minor', group: 'Western Modes', size: 12, degrees: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', group: 'Western Modes', size: 12, degrees: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', group: 'Western Modes', size: 12, degrees: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', group: 'Western Modes', size: 12, degrees: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', group: 'Western Modes', size: 12, degrees: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrian', group: 'Western Modes', size: 12, degrees: [0, 1, 3, 5, 6, 8, 10] },

  { id: 'major-penta', name: 'Major Pentatonic', group: 'Pentatonic / Blues', size: 12, degrees: [0, 2, 4, 7, 9] },
  { id: 'minor-penta', name: 'Minor Pentatonic', group: 'Pentatonic / Blues', size: 12, degrees: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', group: 'Pentatonic / Blues', size: 12, degrees: [0, 3, 5, 6, 7, 10] },

  { id: 'whole-tone', name: 'Whole Tone', group: 'Other Western', size: 12, degrees: [0, 2, 4, 6, 8, 10] },
  { id: 'dim-hw', name: 'Diminished HW', group: 'Other Western', size: 12, degrees: [0, 1, 3, 4, 6, 7, 9, 10] },
  { id: 'dim-wh', name: 'Diminished WH', group: 'Other Western', size: 12, degrees: [0, 2, 3, 5, 6, 8, 9, 11] },

  { id: 'hungarian-minor', name: 'Hungarian Minor', group: 'World Scales', size: 12, degrees: [0, 2, 3, 6, 7, 8, 11] },
  { id: 'double-harmonic', name: 'Double Harmonic', group: 'World Scales', size: 12, degrees: [0, 1, 4, 5, 7, 8, 11] },
  { id: 'hirajoshi', name: 'Hirajoshi', group: 'World Scales', size: 12, degrees: [0, 2, 3, 7, 8] },
  { id: 'in-sen', name: 'In-Sen', group: 'World Scales', size: 12, degrees: [0, 1, 5, 7, 10] },
  { id: 'bhairav', name: 'Raga Bhairav', group: 'World Scales', size: 12, degrees: [0, 1, 4, 5, 7, 8, 11] },

  // 24-EDO: quarter tones are degrees here, not decorations.
  { id: 'maqam-rast', name: 'Maqam Rast', group: 'Maqamat', size: 24, degrees: [0, 4, 7, 10, 14, 18, 21] },
  { id: 'maqam-bayati', name: 'Maqam Bayati', group: 'Maqamat', size: 24, degrees: [0, 3, 6, 10, 14, 16, 20] },
];

export function getScale(id: string): ScaleDefinition | undefined {
  return SCALES.find(s => s.id === id);
}

/** The scales that fit a tuning (All notes aside). */
export function scalesFor(tuning: Tuning): ScaleDefinition[] {
  return SCALES.filter(s => s.size === tuning.degrees.length);
}

// ── The pitch grid ──────────────────────────────────────────────

/** What picks the pitch grid: a view of the composition's snap settings. */
export interface PitchSettings {
  tuning: TuningRef;
  root: number;
  scaleId: string;
  tunedFrom: number;
  hidePitchLines: boolean;
}

/** The staff's and snapping's view of the pitch grid. */
export interface PitchSet {
  /** Absolute cents of every note in the grid across the pitch range, ascending. */
  notes: readonly number[];
  /** 12-EDO with every note: the plain chromatic staff. */
  plainChromatic: boolean;
  /** Every note sits on a 12-EDO line (within a cent). */
  onTwelveEdo: boolean;
}

const pitchSets = new Map<string, PitchSet>();

/** The notes the staff draws and snapping aims at; null when pitch lines are
 *  hidden (no lines, and nothing to snap to but frets and Prism echoes).
 *  Shared between callers: don't mutate. */
export function pitchSetFor(s: PitchSettings): PitchSet | null {
  if (s.hidePitchLines) return null;
  const tuning = resolveTuning(s.tuning);
  const scale = s.scaleId === ALL_NOTES ? null : getScale(s.scaleId);
  // A scale that doesn't fit the tuning plays as All notes.
  const steps = scale && scale.size === tuning.degrees.length
    ? scale.degrees
    : tuning.degrees.map((_, i) => i);
  const key = `${tuning.key}|${s.root}|${steps.join(',')}|${s.tunedFrom}`;
  const hit = pitchSets.get(key);
  if (hit) return hit;

  const n = tuning.degrees.length;
  const anchor = s.tunedFrom * CENTS_PER_SEMITONE;
  const notes: number[] = [];
  const first = Math.floor((MIN_PITCH_CENTS - anchor) / tuning.period) - 1;
  const last = Math.ceil((MAX_PITCH_CENTS - anchor) / tuning.period) + 1;
  for (let k = first; k <= last; k++) {
    for (const step of steps) {
      const idx = s.root + step;
      const wrap = Math.floor(idx / n);
      const cents = anchor + (k + wrap) * tuning.period + tuning.degrees[((idx % n) + n) % n]!;
      if (cents >= MIN_PITCH_CENTS - 1e-6 && cents <= MAX_PITCH_CENTS + 1e-6) notes.push(roundCents(cents));
    }
  }
  notes.sort((a, b) => a - b);
  const deduped = notes.filter((c, i) => i === 0 || c - notes[i - 1]! > 1e-6);
  const set: PitchSet = {
    notes: deduped,
    plainChromatic: isTwelveEdo(s.tuning) && scale === null,
    onTwelveEdo: deduped.every(c => Math.abs(c - Math.round(c / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE) < 1),
  };
  pitchSets.set(key, set);
  return set;
}

/** Drop float noise so equal pitches compare equal (0.0001 ¢ is inaudible). */
function roundCents(c: number): number {
  return Math.round(c * 10000) / 10000;
}

/** Where the root sits within the octave, in cents above C. */
export function rootCents(s: Pick<PitchSettings, 'tuning' | 'root' | 'tunedFrom'>): number {
  const t = resolveTuning(s.tuning);
  return s.tunedFrom * CENTS_PER_SEMITONE + (t.degrees[s.root] ?? 0);
}

/** The degree of `tuning` (tuned from `tunedFrom`) nearest a pitch, comparing
 *  within the period so octaves don't matter. */
export function nearestDegree(tuning: Tuning, tunedFrom: number, cents: number): number {
  const p = tuning.period;
  const rel = (((cents - tunedFrom * CENTS_PER_SEMITONE) % p) + p) % p;
  let best = 0;
  let bestDist = Infinity;
  tuning.degrees.forEach((d, i) => {
    const dist = Math.min(Math.abs(d - rel), p - Math.abs(d - rel));
    if (dist < bestDist - 1e-9) { bestDist = dist; best = i; }
  });
  return best;
}

/** The note in a sorted list nearest to `cents`. */
export function nearestNote(notes: readonly number[], cents: number): number {
  let lo = 0;
  let hi = notes.length - 1;
  if (hi < 0) return cents;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]! < cents) lo = mid + 1;
    else hi = mid;
  }
  const above = notes[lo]!;
  const below = lo > 0 ? notes[lo - 1]! : above;
  // A tie goes up, as Math.round does.
  return cents - below < above - cents ? below : above;
}
