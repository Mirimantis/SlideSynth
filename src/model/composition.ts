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
    timeSignatureDenominator: 4,
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

/**
 * Measure length in internal (quarter-note) beats, derived from the time
 * signature. 4/4 → 4; 3/4 → 3; 6/8 → 3; 9/8 → 4.5; 12/8 → 6.
 */
export function measureLengthInBeats(comp: Composition): number {
  return comp.beatsPerMeasure * 4 / (comp.timeSignatureDenominator || 4);
}

/**
 * Metronome tick spacing in internal (quarter-note) beats. /4 meters tick
 * once per beat; /8 meters tick on eighth notes (every half-beat).
 */
export function metronomeTickIntervalInBeats(comp: Composition): number {
  return 4 / (comp.timeSignatureDenominator || 4);
}
