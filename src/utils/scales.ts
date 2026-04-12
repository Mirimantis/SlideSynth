import { MIN_NOTE, MAX_NOTE } from '../constants';

export interface ScaleDefinition {
  id: string;
  name: string;
  group: string;
  intervals: number[];
  period: number;
}

export const SCALE_CATALOG: ScaleDefinition[] = [
  // ── Western Modes ──────────────────────────────────────────
  { id: 'major',          name: 'Major (Ionian)',       group: 'Western Modes',      intervals: [0,2,4,5,7,9,11],    period: 12 },
  { id: 'natural-minor',  name: 'Natural Minor',        group: 'Western Modes',      intervals: [0,2,3,5,7,8,10],    period: 12 },
  { id: 'harmonic-minor', name: 'Harmonic Minor',       group: 'Western Modes',      intervals: [0,2,3,5,7,8,11],    period: 12 },
  { id: 'melodic-minor',  name: 'Melodic Minor',        group: 'Western Modes',      intervals: [0,2,3,5,7,9,11],    period: 12 },
  { id: 'dorian',         name: 'Dorian',               group: 'Western Modes',      intervals: [0,2,3,5,7,9,10],    period: 12 },
  { id: 'phrygian',       name: 'Phrygian',             group: 'Western Modes',      intervals: [0,1,3,5,7,8,10],    period: 12 },
  { id: 'lydian',         name: 'Lydian',               group: 'Western Modes',      intervals: [0,2,4,6,7,9,11],    period: 12 },
  { id: 'mixolydian',     name: 'Mixolydian',           group: 'Western Modes',      intervals: [0,2,4,5,7,9,10],    period: 12 },
  { id: 'locrian',        name: 'Locrian',              group: 'Western Modes',      intervals: [0,1,3,5,6,8,10],    period: 12 },

  // ── Pentatonic / Blues ─────────────────────────────────────
  { id: 'major-penta',    name: 'Major Pentatonic',     group: 'Pentatonic / Blues',  intervals: [0,2,4,7,9],         period: 12 },
  { id: 'minor-penta',    name: 'Minor Pentatonic',     group: 'Pentatonic / Blues',  intervals: [0,3,5,7,10],        period: 12 },
  { id: 'blues',          name: 'Blues',                 group: 'Pentatonic / Blues',  intervals: [0,3,5,6,7,10],      period: 12 },

  // ── Other Western ─────────────────────────────────────────
  { id: 'whole-tone',     name: 'Whole Tone',           group: 'Other Western',       intervals: [0,2,4,6,8,10],      period: 12 },
  { id: 'chromatic',      name: 'Chromatic',            group: 'Other Western',       intervals: [0,1,2,3,4,5,6,7,8,9,10,11], period: 12 },
  { id: 'dim-hw',         name: 'Diminished HW',        group: 'Other Western',       intervals: [0,1,3,4,6,7,9,10],  period: 12 },
  { id: 'dim-wh',         name: 'Diminished WH',        group: 'Other Western',       intervals: [0,2,3,5,6,8,9,11],  period: 12 },

  // ── World Scales ──────────────────────────────────────────
  { id: 'hungarian-minor', name: 'Hungarian Minor',     group: 'World Scales',        intervals: [0,2,3,6,7,8,11],    period: 12 },
  { id: 'double-harmonic', name: 'Double Harmonic',     group: 'World Scales',        intervals: [0,1,4,5,7,8,11],    period: 12 },
  { id: 'hirajoshi',       name: 'Hirajoshi',           group: 'World Scales',        intervals: [0,2,3,7,8],         period: 12 },
  { id: 'in-sen',          name: 'In-Sen',              group: 'World Scales',        intervals: [0,1,5,7,10],        period: 12 },
  { id: 'bhairav',         name: 'Raga Bhairav',        group: 'World Scales',        intervals: [0,1,4,5,7,8,11],    period: 12 },

  // ── Microtonal ────────────────────────────────────────────
  { id: 'maqam-rast',     name: 'Maqam Rast',           group: 'Microtonal',          intervals: [0,2,3.5,5,7,9,10.5],           period: 12 },
  { id: 'maqam-bayati',   name: 'Maqam Bayati',         group: 'Microtonal',          intervals: [0,1.5,3,5,7,8,10],             period: 12 },
  { id: 'slendro',        name: 'Gamelan Slendro',      group: 'Microtonal',          intervals: [0,2.4,4.8,7.2,9.6],            period: 12 },
  { id: 'pelog',           name: 'Gamelan Pelog',        group: 'Microtonal',          intervals: [0,1.6,3.2,5.2,7.2,8.4,10.8],   period: 12 },
  { id: 'thai-7tet',      name: 'Thai 7-TET',           group: 'Microtonal',          intervals: [0, 12/7, 24/7, 36/7, 48/7, 60/7, 72/7], period: 12 },
];

/** Look up a scale by ID. */
export function getScaleById(id: string): ScaleDefinition | undefined {
  return SCALE_CATALOG.find(s => s.id === id);
}

/** Get ordered unique group names for <optgroup> rendering. */
export function getScaleGroups(): string[] {
  const seen = new Set<string>();
  return SCALE_CATALOG.filter(s => {
    if (seen.has(s.group)) return false;
    seen.add(s.group);
    return true;
  }).map(s => s.group);
}

/** Check if a scale has any fractional (microtonal) intervals. */
export function isMicrotonal(scale: ScaleDefinition): boolean {
  return scale.intervals.some(iv => iv !== Math.floor(iv));
}

/**
 * Get all MIDI note values belonging to the given scale
 * within the staff range [MIN_NOTE, MAX_NOTE].
 */
export function getScaleNotes(root: number, scale: ScaleDefinition): number[] {
  const notes: number[] = [];
  const startOctave = Math.floor((MIN_NOTE - root) / scale.period);
  const endOctave = Math.ceil((MAX_NOTE - root) / scale.period);
  for (let oct = startOctave; oct <= endOctave; oct++) {
    for (const interval of scale.intervals) {
      const note = root + oct * scale.period + interval;
      if (note >= MIN_NOTE && note <= MAX_NOTE) {
        notes.push(note);
      }
    }
  }
  return notes;
}

/** Check whether a MIDI note (integer or fractional) is in the scale. */
export function isNoteInScale(note: number, root: number, scale: ScaleDefinition): boolean {
  const offset = ((note - root) % scale.period + scale.period) % scale.period;
  return scale.intervals.some(iv => Math.abs(offset - iv) < 0.01);
}

/** Find the nearest in-scale note to a given MIDI value. */
export function nearestScaleNote(note: number, root: number, scale: ScaleDefinition): number {
  const relativeNote = note - root;
  const octave = Math.floor(relativeNote / scale.period);

  let bestNote = note;
  let bestDist = Infinity;

  for (let o = octave - 1; o <= octave + 1; o++) {
    for (const interval of scale.intervals) {
      const candidate = root + o * scale.period + interval;
      const dist = Math.abs(candidate - note);
      if (dist < bestDist) {
        bestDist = dist;
        bestNote = candidate;
      }
    }
  }

  return Math.max(MIN_NOTE, Math.min(MAX_NOTE, bestNote));
}
