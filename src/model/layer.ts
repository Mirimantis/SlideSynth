/**
 * Layer-per-pass looping (BACKLOG 10.3).
 *
 * A "layer" is just a Track: each pass you perform gets its own track, so
 * passes stack into a choir and inherit mute / solo / volume and per-layer tone
 * from the existing track panel for free.
 */

import type { Track } from '../types';
import { createTrack } from './track';

/** Ceiling on total tracks while layering. 16 matches MPE's usable channel
 *  count and a VCV poly cable, so a stack that fits here can be exported to
 *  either host without dropping voices. */
export const LAYER_TRACK_LIMIT = 16;

const LAYER_NAME_PATTERN = /^Layer (\d+)$/;

/**
 * Next free `Layer N` name. Numbering runs one past the highest existing layer
 * rather than off the track count, so deleting a layer never produces a
 * duplicate name (drop-last-pass in 10.4 removes layers routinely).
 */
export function nextLayerName(tracks: readonly Track[]): string {
  let highest = 0;
  for (const track of tracks) {
    const match = LAYER_NAME_PATTERN.exec(track.name);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `Layer ${highest + 1}`;
}

/** Is there room for another track? */
export function canOpenLayer(tracks: readonly Track[]): boolean {
  return tracks.length < LAYER_TRACK_LIMIT;
}

/**
 * A fresh layer inheriting the source track's voice: same tone, same volume,
 * so successive passes sound like the same instrument. Mute/solo start clear
 * (a new layer should be audible).
 */
export function createLayerTrack(source: Track, tracks: readonly Track[]): Track {
  const layer = createTrack(nextLayerName(tracks), source.toneId);
  layer.volume = source.volume;
  return layer;
}

/** The most recently created layer track, or null if none exist. Used at the
 *  track cap, where further passes join the newest layer instead of opening
 *  one that won't fit. */
export function newestLayerTrack(tracks: readonly Track[]): Track | null {
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i]!;
    if (LAYER_NAME_PATTERN.test(track.name)) return track;
  }
  return null;
}
