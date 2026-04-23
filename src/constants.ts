import type { ToneDefinition } from './types';

// ── Staff range ─────────────────────────────────────────────────
// C0 (MIDI 12) through C9 (MIDI 120) — 9 octaves, 109 note lines
export const MIN_NOTE = 12;  // C0
export const MAX_NOTE = 120; // C9
// Extra room past MIN_NOTE / MAX_NOTE for working comfortably near the edges.
export const Y_PAN_MARGIN = 6; // semitones (half an octave)

// ── Note names ──────────────────────────────────────────────────
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function noteNumberToName(n: number): string {
  const octave = Math.floor(n / 12) - 1;
  const name = NOTE_NAMES[n % 12];
  return `${name}${octave}`;
}

export function isNaturalNote(n: number): boolean {
  const i = n % 12;
  // C=0, D=2, E=4, F=5, G=7, A=9, B=11
  return [0, 2, 4, 5, 7, 9, 11].includes(i);
}

export function isCNote(n: number): boolean {
  return n % 12 === 0;
}

// ── Frequency conversion ────────────────────────────────────────
// A4 = MIDI 69 = 440 Hz
export function noteToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function frequencyToNote(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
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

// ── Canvas extent ──────────────────────────────────────────────
// The canvas renders (and the viewport pans) over this range in beats.
// Extent is derived dynamically from the composition length plus buffer,
// so users can always scroll a bit past the last point to add new curves.
export const MIN_CANVAS_EXTENT = 32;    // empty composition still has a usable grid
export const SCROLL_BUFFER = 64;        // generous open space past the last point
export const MAX_CANVAS_EXTENT = 10000; // memory cap (~83 min at 120 BPM)

// ── Viewport defaults ───────────────────────────────────────────
export const DEFAULT_ZOOM_X = 120;  // pixels per beat
export const DEFAULT_ZOOM_Y = 14;   // pixels per semitone
// Min is 0.5 px/beat so the viewport can show ~10 minutes at 120 BPM on a
// typical canvas width. The slider maps to this range logarithmically so the
// useful mid-range resolution isn't swamped by the extended low end.
export const MIN_ZOOM_X = 0.5;
export const MAX_ZOOM_X = 600;
export const MIN_ZOOM_Y = 4;
export const MAX_ZOOM_Y = 140;

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
