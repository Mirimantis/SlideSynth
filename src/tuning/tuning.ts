import { MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_SEMITONE, CENTS_PER_OCTAVE, centsToNoteName } from '../constants';
import { chordOffsets, type ChordSpec, type ChordSteps } from '../utils/harmonics';

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

/** A tuning read from a Scala .scl file (13.8 (d)). The composition keeps
 *  the whole tuning, since the file it came from may be gone. */
export interface ImportedTuningRef {
  kind: 'imported';
  /** The file's name, without .scl. */
  name: string;
  /** The file's description line: display text only. */
  description: string;
  /** Cents above degree 0, ascending, starting at 0. */
  degrees: number[];
  /** The repeat, in cents: the file's last note. */
  period: number;
  /** Each degree's ratio where the file gave one ('1/1' for degree 0), else null. */
  ratios: (string | null)[];
  /** The period's ratio ('2/1'), if the file gave one. */
  periodRatio: string | null;
}

/** A tuning, as stored in a composition. */
export type TuningRef =
  | { kind: 'edo'; divisions: number; equave: Equave }
  | { kind: 'table'; id: string }
  | ImportedTuningRef;

/** Imported tunings: at most this many notes, and a period from 100 ¢ to six
 *  octaves, so a file can't ask the staff for more than a line a cent. */
export const MAX_IMPORTED_NOTES = 1200;
export const MIN_IMPORTED_PERIOD = 100;
export const MAX_IMPORTED_PERIOD = 7200;

export const TWELVE_EDO: TuningRef = { kind: 'edo', divisions: 12, equave: 'octave' };
export const MIN_EDO = 5;
export const MAX_EDO = 72;
const TRITAVE_CENTS = CENTS_PER_OCTAVE * Math.log2(3);

export type TuningGroup = 'Equal divisions' | 'Just intonation' | 'Historical' | 'Traditional' | 'Imported';

/** A fixed table of degrees. */
interface TuningTable {
  id: string;
  name: string;
  group: Exclude<TuningGroup, 'Equal divisions' | 'Imported'>;
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
  /** Per-degree ratios (just intonation, and imported files that gave them). */
  ratios?: readonly (string | null)[];
  /** The period as a ratio ('2/1'), for .scl export. */
  periodRatio: string | null;
  approximate: boolean;
  /** An imported file's description line: display text only. */
  description?: string;
}

export function tuningKey(ref: TuningRef): string {
  if (ref.kind === 'edo') return `edo-${ref.divisions}${ref.equave === 'tritave' ? '-3' : ''}`;
  if (ref.kind === 'table') return ref.id;
  return `imported-${hashString(`${ref.name}|${ref.period}|${ref.degrees.join(',')}`)}`;
}

/** A short, stable hash (FNV-1a) for cache keys. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Why an imported tuning can't be used, or null if it can. Files are
 *  untrusted: a saved composition could hold anything here. */
export function importedTuningProblem(ref: ImportedTuningRef): string | null {
  const { degrees, period } = ref;
  if (!Number.isFinite(period) || period < MIN_IMPORTED_PERIOD || period > MAX_IMPORTED_PERIOD) {
    return `its period must be between ${MIN_IMPORTED_PERIOD} and ${MAX_IMPORTED_PERIOD} cents`;
  }
  if (!Array.isArray(degrees) || degrees.length < 1 || degrees.length > MAX_IMPORTED_NOTES) {
    return `it must have 1 to ${MAX_IMPORTED_NOTES} notes`;
  }
  if (degrees[0] !== 0) return 'its first degree must be 0';
  for (let i = 1; i < degrees.length; i++) {
    const d = degrees[i]!;
    if (!Number.isFinite(d) || d <= degrees[i - 1]! || d >= period) return 'its notes must rise within one period';
  }
  if (degrees.length * CENTS_PER_OCTAVE / period > MAX_IMPORTED_NOTES) {
    return `it can have at most ${MAX_IMPORTED_NOTES} notes to the octave`;
  }
  return null;
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
      periodRatio: ref.equave === 'tritave' ? '3/1' : '2/1',
      approximate: false,
    };
  } else if (ref.kind === 'imported') {
    if (importedTuningProblem(ref)) return resolveTuning(TWELVE_EDO);
    const octave = Math.abs(ref.period - CENTS_PER_OCTAVE) < 1e-6;
    const ratios = Array.isArray(ref.ratios) && ref.ratios.length === ref.degrees.length
      ? ref.ratios.map(r => (typeof r === 'string' ? r : null))
      : undefined;
    t = {
      key,
      name: String(ref.name),
      group: 'Imported',
      degrees: ref.degrees,
      period: ref.period,
      // Like the built-in tables: 12 notes to the octave take letters.
      naming: octave && ref.degrees.length === 12 ? 'letters' : 'ratios',
      ratios,
      periodRatio: typeof ref.periodRatio === 'string' ? ref.periodRatio : null,
      approximate: false,
      description: String(ref.description ?? ''),
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
      periodRatio: '2/1',
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

/** What a degree is called: its letter (where the tuning has letters), its
 *  ratio (just intonation) and its number (1-based, as musicians count). */
interface DegreeParts {
  letter: string | null;
  ratio: string | null;
  number: string;
}

function degreeParts(tuning: Tuning, tunedFrom: number, degree: number): DegreeParts {
  const n = tuning.degrees.length;
  const d = ((degree % n) + n) % n;
  const ratio = tuning.ratios?.[d] ?? null;
  let letter: string | null = null;
  if (tuning.naming === 'letters') {
    if (n === 12) {
      // Tuned from can be between standard notes (a tuning made from frets,
      // 13.8 (f)): letters then name the nearest.
      letter = PITCH_CLASS_NAMES[(((Math.round(tunedFrom) + d) % 12) + 12) % 12]!;
    } else if (tunedFrom === 0) {
      // A meantone EDO: letters only while degree 0 is on C.
      let names = meantoneCache.get(n);
      if (!names) meantoneCache.set(n, names = meantoneNames(n));
      letter = names[d]!;
    }
  }
  return { letter, ratio, number: String(d + 1) };
}

/** A degree's name: a letter where the tuning has letters, else its number,
 *  with the ratio for just intonation. */
export function degreeName(tuning: Tuning, tunedFrom: number, degree: number): string {
  const { letter, ratio, number } = degreeParts(tuning, tunedFrom, degree);
  if (letter) return ratio ? `${letter} (${ratio})` : letter;
  if (tuning.naming === 'ratios' && ratio) return ratio;
  return number;
}

/** A degree's short name, for the pitch circle's rim: its letter, else its
 *  ratio or number. */
export function degreeLabel(tuning: Tuning, tunedFrom: number, degree: number): string {
  const { letter, ratio, number } = degreeParts(tuning, tunedFrom, degree);
  return letter ?? (tuning.naming === 'ratios' && ratio ? ratio : number);
}

/** A note's name on the staff and in the pitch readout: letter and octave
 *  ("Eb4"), or the degree's number or ratio. `nearest` adds the nearest
 *  standard note ("6 ≈D4") to a name that doesn't say where it is. */
function noteName(tuning: Tuning, tunedFrom: number, degree: number, cents: number, nearest: boolean): string {
  const { letter, ratio, number } = degreeParts(tuning, tunedFrom, degree);
  if (letter) {
    // The octave of the nearest standard note, so B#4 and Cb5 sit where they sound.
    const octave = Math.floor(Math.round(cents / CENTS_PER_SEMITONE) / 12) - 1;
    return ratio ? `${letter}${octave} ${ratio}` : `${letter}${octave}`;
  }
  const name = tuning.naming === 'ratios' && ratio ? ratio : number;
  return nearest ? `${name} ≈${centsToNoteName(cents)}` : name;
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
/** The scale built on the pitch circle (13.8 (c)): `customScale`. */
export const CUSTOM_SCALE = 'custom';

/** A scale made by Shift+clicking the pitch circle's degrees. */
export interface CustomScale {
  /** The tuning size it was made in; it fits tunings of this size. */
  size: number;
  /** Degree steps from the root, ascending, starting at 0. */
  steps: number[];
}

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

/** Does this custom scale fit the tuning? */
export function customFits(custom: CustomScale | null, tuning: Tuning): custom is CustomScale {
  return !!custom && custom.size === tuning.degrees.length;
}

/** The chosen scale's steps from the root, or null for every note: All
 *  notes, or a scale that doesn't fit the tuning. */
export function scaleSteps(s: Pick<PitchSettings, 'scaleId' | 'customScale'>, tuning: Tuning): readonly number[] | null {
  if (s.scaleId === CUSTOM_SCALE) return customFits(s.customScale, tuning) ? s.customScale.steps : null;
  const scale = s.scaleId === ALL_NOTES ? undefined : getScale(s.scaleId);
  return scale && scale.size === tuning.degrees.length ? scale.degrees : null;
}

// ── The pitch grid ──────────────────────────────────────────────

/** What picks the pitch grid: a view of the composition's snap settings. */
export interface PitchSettings {
  tuning: TuningRef;
  root: number;
  scaleId: string;
  tunedFrom: number;
  hidePitchLines: boolean;
  /** The pitch circle's scale, used when `scaleId` is 'custom'. */
  customScale: CustomScale | null;
}

/** Snapping's view of the pitch grid (the staff's is `staffGridFor`). */
export interface PitchSet {
  /** Absolute cents of every note in the grid across the pitch range, ascending. */
  notes: readonly number[];
}

const pitchSets = new Map<string, PitchSet>();

/** The notes snapping aims at: the scale's, or every note of the tuning with
 *  All notes. Null when pitch lines are hidden (no lines, and nothing to snap
 *  to but frets and Prism echoes).
 *  Shared between callers: don't mutate. */
export function pitchSetFor(s: PitchSettings): PitchSet | null {
  if (s.hidePitchLines) return null;
  const tuning = resolveTuning(s.tuning);
  // A scale that doesn't fit the tuning plays as All notes.
  const steps = scaleSteps(s, tuning) ?? tuning.degrees.map((_, i) => i);
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
  const set: PitchSet = { notes: deduped };
  pitchSets.set(key, set);
  return set;
}

// ── The staff ───────────────────────────────────────────────────

/** One pitch line on the staff (13.8 (b)): a note of the tuning. */
export interface StaffLine {
  /** Absolute cents. */
  cents: number;
  /** Which degree of the tuning (0-based). */
  degree: number;
  isRoot: boolean;
  /** In the scale; every line is, with All notes. */
  inScale: boolean;
  /** Drawn as a main line: a letter without a sharp or flat, or any note of
   *  a tuning that names its notes by number or ratio. */
  natural: boolean;
  label: string;
}

/** The staff's lines for a tuning, root and scale. */
export interface StaffGrid {
  /** Every note of the tuning across the pitch range, ascending. */
  lines: readonly StaffLine[];
  /** A scale narrows the tuning: lines outside it are dimmed. */
  hasScale: boolean;
  /** The smallest gap between neighbouring lines, in cents. */
  minStep: number;
  /** The tuning's repeat, in cents. */
  period: number;
  /** 12-EDO: no 12-EDO reference layer, it would sit on every line. */
  twelveEdo: boolean;
  /** Names its notes by letter; otherwise by number or ratio. */
  lettered: boolean;
}

const staffGrids = new Map<string, StaffGrid>();

/** The staff's lines: every note of the tuning, flagged with the root and the
 *  scale. Pitch lines hidden is the caller's business. Cached; don't mutate. */
export function staffGridFor(s: Omit<PitchSettings, 'hidePitchLines'>): StaffGrid {
  const tuning = resolveTuning(s.tuning);
  const n = tuning.degrees.length;
  const steps = scaleSteps(s, tuning);
  const key = `${tuning.key}|${s.root}|${steps?.join(',') ?? ALL_NOTES}|${s.tunedFrom}`;
  const hit = staffGrids.get(key);
  if (hit) return hit;

  const inScale = new Set(steps ? steps.map(step => (s.root + step) % n) : tuning.degrees.map((_, i) => i));
  const anchor = s.tunedFrom * CENTS_PER_SEMITONE;
  const lines: StaffLine[] = [];
  const first = Math.floor((MIN_PITCH_CENTS - anchor) / tuning.period) - 1;
  const last = Math.ceil((MAX_PITCH_CENTS - anchor) / tuning.period) + 1;
  for (let k = first; k <= last; k++) {
    tuning.degrees.forEach((offset, degree) => {
      const cents = roundCents(anchor + k * tuning.period + offset);
      if (cents < MIN_PITCH_CENTS - 1e-6 || cents > MAX_PITCH_CENTS + 1e-6) return;
      const isRoot = degree === s.root;
      const parts = degreeParts(tuning, s.tunedFrom, degree);
      lines.push({
        cents,
        degree,
        isRoot,
        inScale: inScale.has(degree),
        natural: parts.letter ? !/[#b]/.test(parts.letter) : true,
        label: noteName(tuning, s.tunedFrom, degree, cents, isRoot),
      });
    });
  }
  const gaps = tuning.degrees.map((d, i) => (tuning.degrees[i + 1] ?? tuning.period) - d);
  const grid: StaffGrid = {
    lines,
    hasScale: steps !== null,
    minStep: Math.min(...gaps),
    period: tuning.period,
    twelveEdo: isTwelveEdo(s.tuning),
    lettered: lines.some(l => /^[A-G]/.test(l.label)),
  };
  staffGrids.set(key, grid);
  return grid;
}

/** A pitch named by the tuning (the pitch readout): the nearest note of the
 *  tuning, and how far the pitch is from it in cents. */
export function pitchName(s: Omit<PitchSettings, 'hidePitchLines'>, cents: number): { name: string; offset: number } {
  const tuning = resolveTuning(s.tuning);
  const degree = nearestDegree(tuning, s.tunedFrom, cents);
  const anchor = s.tunedFrom * CENTS_PER_SEMITONE + tuning.degrees[degree]!;
  const note = anchor + Math.round((cents - anchor) / tuning.period) * tuning.period;
  return { name: noteName(tuning, s.tunedFrom, degree, note, true), offset: cents - note };
}

/** A pitch as one label: the tuning's nearest note, and the cents off it when
 *  that rounds to a cent or more ("Db4 +12¢"). Frets use it (13.16). */
export function pitchLabel(s: Omit<PitchSettings, 'hidePitchLines'>, cents: number): string {
  const { name, offset } = pitchName(s, cents);
  const off = Math.round(offset);
  return off === 0 ? name : `${name} ${off > 0 ? '+' : ''}${off}¢`;
}

// ── The Harmonic Prism ──────────────────────────────────────────

/** The steps the Prism's "Equal" intonation counts in (13.8 (b)): the
 *  tuning's notes, counted from the root. Null for 12-EDO, whose steps are the
 *  chord tables' own semitones. */
export function chordStepsFor(s: Pick<PitchSettings, 'tuning' | 'root'>): ChordSteps | null {
  if (isTwelveEdo(s.tuning)) return null;
  const tuning = resolveTuning(s.tuning);
  const n = tuning.degrees.length;
  const root = ((s.root % n) + n) % n;
  const from = tuning.degrees[root]!;
  const intervals = tuning.degrees.map((_, k) => {
    const i = root + k;
    return tuning.degrees[i % n]! - from + (i >= n ? tuning.period : 0);
  });
  return { intervals, period: tuning.period };
}

/** The Prism chord's voice offsets in the current tuning.
 *
 *  `noteRoot`: the degree a Per note chord (13.21) counts from, from
 *  `noteRootAt`. Without one (projection echoes, which keep the from-root
 *  shapes), and for the other intonations, the chord counts from the root. */
export function prismOffsets(spec: ChordSpec, s: Pick<PitchSettings, 'tuning' | 'root'>, noteRoot?: number): number[] {
  const root = spec.tuning === 'per-note' && noteRoot !== undefined ? noteRoot : s.root;
  return chordOffsets(spec, chordStepsFor({ tuning: s.tuning, root }));
}

/** Per note (13.21): the degree a chord on `base` counts from, the tuning's
 *  note nearest it. The chord is that note's chord, moved by the base's
 *  offset from it, so its offsets from the base are the note's own. */
export function noteRootAt(s: Pick<PitchSettings, 'tuning' | 'tunedFrom'>, base: number): number {
  return nearestDegree(resolveTuning(s.tuning), s.tunedFrom, base);
}

/** The Prism chord on `base`: counted from its own note with Per note, from
 *  the root otherwise. */
export function prismOffsetsAt(spec: ChordSpec, s: Pick<PitchSettings, 'tuning' | 'root' | 'tunedFrom'>, base: number): number[] {
  return prismOffsets(spec, s, noteRootAt(s, base));
}

/** Drop float noise so equal pitches compare equal (0.0001 ¢ is inaudible). */
function roundCents(c: number): number {
  return Math.round(c * 10000) / 10000;
}

/** The pitch circle's audition pitch for a degree: in the period starting at
 *  degree 0 at or above `from` (C4 by default). */
export function degreeCents(s: Pick<PitchSettings, 'tuning' | 'tunedFrom'>, degree: number, from = 6000): number {
  const t = resolveTuning(s.tuning);
  return from + s.tunedFrom * CENTS_PER_SEMITONE + (t.degrees[degree] ?? 0);
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
