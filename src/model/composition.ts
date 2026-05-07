import type { Composition, SnapSettings } from '../types';
import {
  DEFAULT_BPM, DEFAULT_BEATS_PER_MEASURE,
  DEFAULT_SNAP_ENABLED, DEFAULT_MAGNETIC_ENABLED,
  DEFAULT_MAGNETIC_STRENGTH, DEFAULT_MAGNETIC_SPRING_K, DEFAULT_MAGNETIC_DAMPING,
} from '../constants';
import { createDefaultToneLibrary } from './tone';
import { createTrack } from './track';

/** Default snap settings for a new composition. Also the migration target for v1 files. */
export function createDefaultSnapSettings(): SnapSettings {
  return {
    enabled: DEFAULT_SNAP_ENABLED,
    scaleRoot: null,
    scaleId: null,
    hidePitchLines: false,
    magneticEnabled: DEFAULT_MAGNETIC_ENABLED,
    magneticStrength: DEFAULT_MAGNETIC_STRENGTH,
    magneticSpringK: DEFAULT_MAGNETIC_SPRING_K,
    magneticDamping: DEFAULT_MAGNETIC_DAMPING,
  };
}

export function createComposition(): Composition {
  const toneLibrary = createDefaultToneLibrary();
  const firstTone = toneLibrary[0]!;

  return {
    version: 2,
    name: 'Untitled',
    bpm: DEFAULT_BPM,
    beatsPerMeasure: DEFAULT_BEATS_PER_MEASURE,
    timeSignatureDenominator: 4,
    toneLibrary,
    tracks: [createTrack('Track 1', firstTone.id)],
    loopStartBeats: 0,
    loopEndBeats: 2 * DEFAULT_BEATS_PER_MEASURE,
    snap: createDefaultSnapSettings(),
    guides: [],
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
