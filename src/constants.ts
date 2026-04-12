import type { ToneDefinition } from './types';

// ── Staff range ─────────────────────────────────────────────────
// C0 (MIDI 12) through C9 (MIDI 120) — 9 octaves, 109 note lines
export const MIN_NOTE = 12;  // C0
export const MAX_NOTE = 120; // C9

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

// Default composition length: 1 minute at default BPM = 120 beats
export const DEFAULT_TOTAL_BEATS = DEFAULT_BPM; // 1 min at 120 BPM
// Max composition: ~10 minutes at 300 BPM = 3000 beats (reasonable WAV size ~50MB stereo)
export const MAX_TOTAL_BEATS = 3000;
export const MIN_TOTAL_BEATS = 4;

// ── Viewport defaults ───────────────────────────────────────────
export const DEFAULT_ZOOM_X = 120;  // pixels per beat
export const DEFAULT_ZOOM_Y = 14;   // pixels per semitone
export const MIN_ZOOM_X = 30;
export const MAX_ZOOM_X = 600;
export const MIN_ZOOM_Y = 4;
export const MAX_ZOOM_Y = 40;

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
