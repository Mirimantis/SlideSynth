import type { Composition } from '../types';
import { DEFAULT_BPM, DEFAULT_BEATS_PER_MEASURE } from '../constants';
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
    toneLibrary,
    tracks: [createTrack('Track 1', firstTone.id)],
    loopStartBeats: 0,
    loopEndBeats: 2 * DEFAULT_BEATS_PER_MEASURE,
  };
}

/**
 * Composition length in beats: the X coordinate of the rightmost point across
 * all curves in all tracks. Returns 0 for an empty composition.
 */
export function getCompositionLength(comp: Composition): number {
  let max = 0;
  for (const t of comp.tracks) {
    for (const c of t.curves) {
      for (const p of c.points) {
        if (p.position.x > max) max = p.position.x;
      }
    }
  }
  return max;
}
