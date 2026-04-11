import { noteToFrequency, frequencyToNote, noteNumberToName } from '../constants';

// Re-export from constants for convenience
export { noteToFrequency, frequencyToNote, noteNumberToName };

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp value between min and max. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
