import type { GuideDefinition } from '../types';
import { CENTS_PER_SEMITONE } from '../constants';
import { repeats } from '../model/frets';
import {
  ALL_NOTES, CUSTOM_SCALE, degreeCents, resolveTuning, scaleSteps, scalesFor,
  type CustomScale, type ImportedTuningRef, type PitchSettings,
} from './tuning';

/**
 * Frets ↔ scale (BACKLOG 13.8 (f); spec in DESIGN.md › Frets and the scale).
 *
 * - Scale → frets: each note of the scale becomes an octave fret, ready to
 *   nudge by ear.
 * - Frets → scale: the octave frets' pitch classes become the scale. If every
 *   one is on a note of the tuning, that's a Custom scale; if not, a Custom
 *   tuning of exactly those pitches with All notes, its first note on the
 *   root fret. Single frets are one-off pitches and stay as they are.
 */

/** More frets than this would bury the canvas. */
export const MAX_SCALE_FRETS = 72;
/** A fret this close to a note of the tuning is on it. */
const ON_NOTE_CENTS = 0.05;

type Settings = Omit<PitchSettings, 'hidePitchLines'>;

const newId = () => `guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mod = (a: number, p: number) => ((a % p) + p) % p;
/** Distance round a circle of circumference p. */
const around = (a: number, b: number, p: number) => { const d = mod(a - b, p); return Math.min(d, p - d); };

/** The octave frets for the scale's notes (the whole tuning with All notes),
 *  near C4, leaving out any note an octave fret already covers. Null if the
 *  scale has more notes than frets can usefully show. */
export function scaleToFrets(s: Settings, existing: readonly GuideDefinition[]): GuideDefinition[] | null {
  const tuning = resolveTuning(s.tuning);
  const n = tuning.degrees.length;
  const steps = scaleSteps(s, tuning) ?? tuning.degrees.map((_, i) => i);
  if (steps.length > MAX_SCALE_FRETS) return null;
  const covered = existing.filter(repeats).map(g => g.position);
  return steps
    .map(step => degreeCents(s, (s.root + step) % n))
    .filter(cents => !covered.some(c => around(c, cents, tuning.period) < ON_NOTE_CENTS))
    .map(cents => ({ id: newId(), orientation: 'y' as const, position: cents, label: '', repeat: 'octave' as const }));
}

/** What the octave frets become. */
export type FretsAsScale =
  | { kind: 'scale'; root: number; scaleId: string; customScale: CustomScale | null }
  | { kind: 'tuning'; tuning: ImportedTuningRef; tunedFrom: number };

/** The scale (or tuning) the octave frets make, or null if there are none.
 *  The root stays where it is if a fret is on it, else moves to the fret
 *  nearest it. */
export function fretsToScale(s: Settings, guides: readonly GuideDefinition[]): FretsAsScale | null {
  const tuning = resolveTuning(s.tuning);
  const p = tuning.period;
  const n = tuning.degrees.length;
  const anchor = s.tunedFrom * CENTS_PER_SEMITONE;
  // Pitch classes: cents above the tuning's degree 0, within one period.
  const classes = [...new Set(guides.filter(repeats).map(g => Math.round(mod(g.position - anchor, p) * 10000) / 10000))]
    .sort((a, b) => a - b)
    .filter((c, i, all) => i === 0 || c - all[i - 1]! > ON_NOTE_CENTS);
  if (classes.length === 0) return null;
  const rootClass = tuning.degrees[s.root] ?? 0;
  const home = classes.reduce((best, c) => (around(c, rootClass, p) < around(best, rootClass, p) ? c : best));

  // Every fret on a note of the tuning: the scale they make over it, by name
  // if it's one of the tuning's scales (a round trip gives D major back),
  // else Custom.
  const degreeOf = (c: number) => tuning.degrees.findIndex(d => around(d, c, p) < ON_NOTE_CENTS);
  const degrees = classes.map(degreeOf);
  if (degrees.every(d => d >= 0)) {
    const root = degreeOf(home);
    const steps = [...new Set(degrees.map(d => mod(d - root, n)))].sort((a, b) => a - b);
    if (steps.length === n) return { kind: 'scale', root, scaleId: ALL_NOTES, customScale: null };
    const named = scalesFor(tuning).find(sc => sc.degrees.length === steps.length && sc.degrees.every((d, i) => d === steps[i]));
    return named
      ? { kind: 'scale', root, scaleId: named.id, customScale: null }
      : { kind: 'scale', root, scaleId: CUSTOM_SCALE, customScale: { size: n, steps } };
  }

  // Otherwise the frets are the tuning: its first note on the root fret.
  const tuningDegrees = classes.map(c => mod(c - home, p)).sort((a, b) => a - b);
  const tunedFrom = mod(anchor + home, p) / CENTS_PER_SEMITONE;
  return {
    kind: 'tuning',
    tunedFrom: Math.round(tunedFrom * 1e6) / 1e6,
    tuning: {
      kind: 'imported',
      name: 'From frets',
      description: `${tuningDegrees.length} notes from octave frets`,
      degrees: tuningDegrees,
      period: p,
      ratios: tuningDegrees.map(() => null),
      periodRatio: tuning.periodRatio,
    },
  };
}
