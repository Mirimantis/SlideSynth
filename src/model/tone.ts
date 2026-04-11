import type { ToneDefinition } from '../types';
import { PRESET_TONES } from '../constants';

/** Create a copy of the preset tone library. */
export function createDefaultToneLibrary(): ToneDefinition[] {
  return PRESET_TONES.map(t => ({ ...t, layers: t.layers.map(l => ({ ...l })), distortion: t.distortion ? { ...t.distortion } : null }));
}

let _counter = 0;

/** Generate a unique ID. */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}-${Date.now()}-${++_counter}`;
}
