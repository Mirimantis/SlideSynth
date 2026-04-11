import type { Composition } from '../types';
import { DEFAULT_BPM, DEFAULT_BEATS_PER_MEASURE, DEFAULT_TOTAL_BEATS } from '../constants';
import { createDefaultToneLibrary } from './tone';
import { createTrack } from './track';

export function createComposition(): Composition {
  const toneLibrary = createDefaultToneLibrary();
  const firstTone = toneLibrary[0]!;

  return {
    version: 1,
    name: 'Untitled',
    bpm: DEFAULT_BPM,
    beatsPerMeasure: DEFAULT_BEATS_PER_MEASURE,
    totalBeats: DEFAULT_TOTAL_BEATS,
    toneLibrary,
    tracks: [createTrack('Track 1', firstTone.id)],
  };
}
