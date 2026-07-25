import type { ToneDefinition } from './types';

// ── Pitch units ─────────────────────────────────────────────────
// Canonical pitch is CENTS from a frozen storage anchor: 0 ¢ ≡ C-1 (MIDI note
// 0 ≈ 8.1758 Hz). 100 ¢ = semitone, 1200 ¢ = octave, so ¢ ÷ 100 = MIDI note
// number and every audible pitch is positive. A4 = 440 Hz sits at 6900 ¢.
// The anchor never moves — concert-pitch tuning (A = 440/442/415…) rides on
// top via the mutable reference below and shifts FREQUENCIES, not stored
// pitch values.
export const CENTS_PER_SEMITONE = 100;
export const CENTS_PER_OCTAVE = 1200;
/** Cents value of A4 at the frozen C-1 anchor (MIDI 69 × 100). */
export const A4_CENTS = 6900;

// ── Staff range ─────────────────────────────────────────────────
// C0 (1200 ¢) through C9 (12000 ¢) — 9 octaves, 109 note lines
export const MIN_PITCH_CENTS = 1200;  // C0
export const MAX_PITCH_CENTS = 12000; // C9
// Extra room past the staff range for working comfortably near the edges.
export const Y_PAN_MARGIN = 600; // cents (half an octave)

// ── MIDI boundary conversions ───────────────────────────────────
// Only import/export and live MIDI input should need these; everything
// internal speaks cents.
export const midiToCents = (note: number): number => note * CENTS_PER_SEMITONE;
export const centsToMidi = (cents: number): number => cents / CENTS_PER_SEMITONE;

// ── Note names ──────────────────────────────────────────────────
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Name of an integer MIDI note number (12-TET grid). */
export function noteNumberToName(n: number): string {
  const octave = Math.floor(n / 12) - 1;
  const name = NOTE_NAMES[((n % 12) + 12) % 12];
  return `${name}${octave}`;
}

/** Note name of the 12-TET grid line nearest to a cents value. */
export function centsToNoteName(cents: number): string {
  return noteNumberToName(Math.round(cents / CENTS_PER_SEMITONE));
}

/** Is this cents value on a natural (white-key) 12-TET line? Expects grid-line
 *  cents (multiples of 100); rounds to the nearest line first. */
export function isNaturalCents(cents: number): boolean {
  const i = ((Math.round(cents / CENTS_PER_SEMITONE) % 12) + 12) % 12;
  // C=0, D=2, E=4, F=5, G=7, A=9, B=11
  return [0, 2, 4, 5, 7, 9, 11].includes(i);
}

/** Is this cents value on a C line? */
export function isCCents(cents: number): boolean {
  return ((Math.round(cents / CENTS_PER_SEMITONE) % 12) + 12) % 12 === 0;
}

// ── Frequency conversion ────────────────────────────────────────
// The reference is a module-level mutable so the whole audio path retunes
// consistently when the composition's tuningOffsetCents changes — synth
// voices, curve sampling, and preview all flow through centsToFrequency.
// Composition load + the Tune control in Transport push new values via
// setReferenceAHz().
export const STANDARD_A4_HZ = 440;
let currentReferenceAHz = STANDARD_A4_HZ;

/** Set the global reference A4 frequency. Clamped to a musically reasonable range. */
export function setReferenceAHz(hz: number): void {
  currentReferenceAHz = Math.max(380, Math.min(500, hz));
}

/** Read the current reference A4 frequency. */
export function getReferenceAHz(): number {
  return currentReferenceAHz;
}

/** Convert a cents offset (relative to A=440) to a reference A frequency in Hz. */
export function centsToReferenceAHz(cents: number): number {
  return STANDARD_A4_HZ * Math.pow(2, cents / CENTS_PER_OCTAVE);
}

/** Convert a reference A frequency to a cents offset relative to A=440. */
export function referenceAHzToCents(hz: number): number {
  return CENTS_PER_OCTAVE * Math.log2(hz / STANDARD_A4_HZ);
}

export function centsToFrequency(cents: number): number {
  return currentReferenceAHz * Math.pow(2, (cents - A4_CENTS) / CENTS_PER_OCTAVE);
}

export function frequencyToCents(hz: number): number {
  return CENTS_PER_OCTAVE * Math.log2(hz / currentReferenceAHz) + A4_CENTS;
}

// ── Default values ──────────────────────────────────────────────
export const DEFAULT_BPM = 120;
export const DEFAULT_BEATS_PER_MEASURE = 4;
export const SUBDIVISIONS_PER_BEAT = 16; // snap to 1/16 beats

// ── Curve handles ──────────────────────────────────────────────
// Fraction of the neighbor segment's X distance used for auto-smoothed (horizontal)
// bezier handle length. Shared by Draw Auto-Smoothing and the Smooth Curve action
// so both stay in sync.
export const AUTO_SMOOTH_X_RATIO = 0.25;

// ── Snap defaults ──────────────────────────────────────────────
// Used as the seed values when a new composition is created and as the migration
// target for v1 composition files (which had no snap block). Matches the historical
// global defaults from the AppState localStorage layer.
export const DEFAULT_SNAP_ENABLED = true;
export const DEFAULT_MAGNETIC_ENABLED = false;
export const DEFAULT_MAGNETIC_STRENGTH = 0.75;
export const DEFAULT_MAGNETIC_SPRING_K = 30;
export const DEFAULT_MAGNETIC_DAMPING = 3;

// ── Canvas extent ──────────────────────────────────────────────
// The canvas renders (and the viewport pans) over this range in beats.
// Extent is derived dynamically from the composition length plus buffer,
// so users can always scroll a bit past the last point to add new curves.
export const MIN_CANVAS_EXTENT = 32;    // empty composition still has a usable grid
export const SCROLL_BUFFER = 64;        // generous open space past the last point
export const MAX_CANVAS_EXTENT = 10000; // memory cap (~83 min at 120 BPM)
/** End of the "open-ended" play range used by jam mode and loop-off recording.
 *  Tied to MAX_CANVAS_EXTENT so the free-running clock stops exactly where the
 *  viewport (and memory budget) ends — the practical "endless" ceiling. */
export const OPEN_END_BEAT = MAX_CANVAS_EXTENT;

// ── Jam mode ────────────────────────────────────────────────────
/** Idle auto-stop for an un-armed jam session (no recording at stake, so much
 *  longer than the armed-recording AFK timeout). 10 minutes. */
export const JAM_IDLE_TIMEOUT_MS = 600_000;
/** How long a finished phrase stays keepable by retrospective capture
 *  (BACKLOG 10.2). Wall-clock, so loop wraps don't disturb it. */
export const KEEP_BUFFER_MS = 30_000;

// ── Viewport defaults ───────────────────────────────────────────
export const DEFAULT_ZOOM_X = 120;   // pixels per beat
export const DEFAULT_ZOOM_Y = 0.14;  // pixels per cent (14 px per semitone)
// Min is 0.5 px/beat so the viewport can show ~10 minutes at 120 BPM on a
// typical canvas width. The slider maps to this range logarithmically so the
// useful mid-range resolution isn't swamped by the extended low end.
export const MIN_ZOOM_X = 0.5;
export const MAX_ZOOM_X = 600;
export const MIN_ZOOM_Y = 0.04;  // 4 px per semitone
export const MAX_ZOOM_Y = 1.4;   // 140 px per semitone

// ── Playback ────────────────────────────────────────────────────
export const SCHEDULER_INTERVAL_MS = 25;
export const SCHEDULER_LOOKAHEAD_S = 0.1;
export const CURVE_SAMPLE_RATE = 200; // samples per second

// ── Preset tones ────────────────────────────────────────────────
export const PRESET_TONES: ToneDefinition[] = [
  {
    id: 'preset-sine',
    name: 'Pure Sine',
    color: '#4fc3f7',
    dashPattern: [],
    layers: [{ type: 'sine', gain: 1.0, detune: 0 }],
    distortion: null,
  },
  {
    id: 'preset-square',
    name: 'Bright Square',
    color: '#ff7043',
    dashPattern: [12, 4],
    layers: [{ type: 'square', gain: 0.6, detune: 0 }],
    distortion: null,
  },
  {
    id: 'preset-warm-pad',
    name: 'Warm Pad',
    color: '#ab47bc',
    dashPattern: [6, 3],
    layers: [
      { type: 'sine', gain: 0.5, detune: 0 },
      { type: 'triangle', gain: 0.3, detune: 7 },
      { type: 'sine', gain: 0.2, detune: -5 },
    ],
    distortion: null,
  },
  {
    id: 'preset-buzzy-saw',
    name: 'Buzzy Saw',
    color: '#66bb6a',
    dashPattern: [3, 3],
    layers: [
      { type: 'sawtooth', gain: 0.5, detune: 0 },
      { type: 'sawtooth', gain: 0.3, detune: 12 },
    ],
    distortion: { amount: 0.3, oversample: '4x' },
  },
];
