import type { Track } from '../types';
import { generateId } from './tone';

/** Solo is on when any track that can sound is soloed. A guide track can't
 *  be soloed (13.10), so it doesn't count. */
export function soloActive(tracks: readonly Track[]): boolean {
  return tracks.some(t => t.solo && !t.guide);
}

/** Whether a track is heard (13.10): not a guide track, not muted, and
 *  soloed if Solo is on. Playback, WAV export and the previews all ask this. */
export function trackSounds(track: Track, tracks: readonly Track[]): boolean {
  if (track.guide || track.muted) return false;
  return !soloActive(tracks) || track.solo;
}

/** The name a new guide track gets from Send to guide track. */
export const GUIDE_TRACK_NAME = 'Guides';

export function createTrack(name: string, toneId: string): Track {
  return {
    id: generateId('track'),
    name,
    toneId,
    curves: [],
    muted: false,
    solo: false,
    volume: 0.8,
  };
}
