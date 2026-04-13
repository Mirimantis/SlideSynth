import { MIN_NOTE, MAX_NOTE } from '../constants';

export interface ChordDefinition {
  id: string;
  name: string;
  group: string;
  intervals: number[];  // semitone offsets from root
}

export const CHORD_CATALOG: ChordDefinition[] = [
  // ── Intervals ─────────────────────────────────────────────────
  { id: 'unison',    name: 'Unison',       group: 'Intervals', intervals: [0] },
  { id: 'min-2nd',   name: 'Minor 2nd',    group: 'Intervals', intervals: [0, 1] },
  { id: 'maj-2nd',   name: 'Major 2nd',    group: 'Intervals', intervals: [0, 2] },
  { id: 'min-3rd',   name: 'Minor 3rd',    group: 'Intervals', intervals: [0, 3] },
  { id: 'maj-3rd',   name: 'Major 3rd',    group: 'Intervals', intervals: [0, 4] },
  { id: 'perf-4th',  name: 'Perfect 4th',  group: 'Intervals', intervals: [0, 5] },
  { id: 'tritone',   name: 'Tritone',      group: 'Intervals', intervals: [0, 6] },
  { id: 'perf-5th',  name: 'Perfect 5th',  group: 'Intervals', intervals: [0, 7] },
  { id: 'min-6th',   name: 'Minor 6th',    group: 'Intervals', intervals: [0, 8] },
  { id: 'maj-6th',   name: 'Major 6th',    group: 'Intervals', intervals: [0, 9] },
  { id: 'min-7th',   name: 'Minor 7th',    group: 'Intervals', intervals: [0, 10] },
  { id: 'maj-7th',   name: 'Major 7th',    group: 'Intervals', intervals: [0, 11] },
  { id: 'octave',    name: 'Octave',       group: 'Intervals', intervals: [0, 12] },

  // ── Triads ────────────────────────────────────────────────────
  { id: 'major',     name: 'Major',        group: 'Triads', intervals: [0, 4, 7] },
  { id: 'minor',     name: 'Minor',        group: 'Triads', intervals: [0, 3, 7] },
  { id: 'dim',       name: 'Diminished',   group: 'Triads', intervals: [0, 3, 6] },
  { id: 'aug',       name: 'Augmented',    group: 'Triads', intervals: [0, 4, 8] },
  { id: 'sus2',      name: 'Sus2',         group: 'Triads', intervals: [0, 2, 7] },
  { id: 'sus4',      name: 'Sus4',         group: 'Triads', intervals: [0, 5, 7] },

  // ── Sevenths ──────────────────────────────────────────────────
  { id: 'maj7',      name: 'Major 7th',    group: 'Sevenths', intervals: [0, 4, 7, 11] },
  { id: 'min7',      name: 'Minor 7th',    group: 'Sevenths', intervals: [0, 3, 7, 10] },
  { id: 'dom7',      name: 'Dominant 7th',  group: 'Sevenths', intervals: [0, 4, 7, 10] },
  { id: 'dim7',      name: 'Diminished 7th', group: 'Sevenths', intervals: [0, 3, 6, 9] },
  { id: 'min-maj7',  name: 'Minor/Major 7th', group: 'Sevenths', intervals: [0, 3, 7, 11] },
  { id: 'aug7',      name: 'Augmented 7th', group: 'Sevenths', intervals: [0, 4, 8, 10] },
  { id: 'half-dim7', name: 'Half-Dim 7th',  group: 'Sevenths', intervals: [0, 3, 6, 10] },

  // ── Extended ──────────────────────────────────────────────────
  { id: 'dom9',      name: '9th',          group: 'Extended', intervals: [0, 4, 7, 10, 14] },
  { id: 'maj9',      name: 'Major 9th',    group: 'Extended', intervals: [0, 4, 7, 11, 14] },
  { id: 'min9',      name: 'Minor 9th',    group: 'Extended', intervals: [0, 3, 7, 10, 14] },
  { id: 'dom11',     name: '11th',         group: 'Extended', intervals: [0, 4, 7, 10, 14, 17] },
  { id: 'dom13',     name: '13th',         group: 'Extended', intervals: [0, 4, 7, 10, 14, 17, 21] },

  // ── Power ─────────────────────────────────────────────────────
  { id: 'power5',    name: 'Power 5th',    group: 'Power', intervals: [0, 7] },
  { id: 'power5-oct', name: 'Power 5th+Oct', group: 'Power', intervals: [0, 7, 12] },
];

/** Look up a chord by ID. */
export function getChordById(id: string): ChordDefinition | undefined {
  return CHORD_CATALOG.find(c => c.id === id);
}

/** Get ordered unique group names for <optgroup> rendering. */
export function getChordGroups(): string[] {
  const seen = new Set<string>();
  return CHORD_CATALOG.filter(c => {
    if (seen.has(c.group)) return false;
    seen.add(c.group);
    return true;
  }).map(c => c.group);
}

/**
 * Get the MIDI note numbers for a single chord voicing rooted at rootMidi.
 * Clamps to valid MIDI range.
 */
export function getChordNotes(rootMidi: number, chord: ChordDefinition): number[] {
  const notes: number[] = [];
  for (const interval of chord.intervals) {
    const note = rootMidi + interval;
    if (note >= MIN_NOTE && note <= MAX_NOTE) {
      notes.push(note);
    }
  }
  return notes;
}

/**
 * Get all MIDI note values that are chord tones across the full staff range.
 * Used for staff-wide guide line rendering.
 */
export function getChordNotesAllOctaves(
  rootPitchClass: number,
  chord: ChordDefinition,
  minNote: number = MIN_NOTE,
  maxNote: number = MAX_NOTE,
): number[] {
  const notes: number[] = [];
  const startOctave = Math.floor((minNote - rootPitchClass) / 12);
  const endOctave = Math.ceil((maxNote - rootPitchClass) / 12);
  for (let oct = startOctave; oct <= endOctave; oct++) {
    for (const interval of chord.intervals) {
      const note = rootPitchClass + oct * 12 + interval;
      if (note >= minNote && note <= maxNote) {
        notes.push(note);
      }
    }
  }
  return notes;
}
