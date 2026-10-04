/**
 * Multitouch (BACKLOG 13.33): the bookkeeping for extra fingers in Perform.
 * The first finger (or the mouse) is the `primary` voice and keeps everything
 * it has always had; each further finger gets a voice of its own from a small
 * pool. A lifted finger's voice goes back to the pool, so voices aren't
 * fingers: the same voice can be a different finger next time.
 */

import type { VoiceId } from '../types';

/** Most fingers that play at once, the first one included. */
export const MAX_FINGERS = 10;

const FINGER_VOICE_PREFIX = 'touch-';

/** Whether a voice belongs to an extra finger (not the primary). */
export function isFingerVoice(voiceId: VoiceId): boolean {
  return voiceId.startsWith(FINGER_VOICE_PREFIX);
}

/** The lowest free extra-finger voice (`touch-1` … `touch-9`), or null when
 *  every one is in use: the primary is the tenth finger. */
export function allocateFingerVoice(inUse: Iterable<VoiceId>): VoiceId | null {
  const taken = new Set(inUse);
  for (let i = 1; i < MAX_FINGERS; i++) {
    const id = `${FINGER_VOICE_PREFIX}${i}`;
    if (!taken.has(id)) return id;
  }
  return null;
}

/**
 * How far to pan the view this frame while fingers are held near the top or
 * bottom edge (screen px; positive reveals higher pitches). Each finger near an
 * edge asks for a speed that grows toward the edge; the strongest ask wins, and
 * fingers at both edges cancel out rather than fight. `ys` are the held
 * fingers' screen Ys; `top` and `bottom` bound the pitch area.
 */
export function edgeScrollStep(
  ys: readonly number[], top: number, bottom: number, edgePx: number, peakPx: number,
): number {
  let up = 0;
  let down = 0;
  for (const sy of ys) {
    if (sy < top + edgePx) {
      up = Math.max(up, Math.min(1, (top + edgePx - sy) / edgePx));
    } else if (sy > bottom - edgePx) {
      down = Math.max(down, Math.min(1, (sy - (bottom - edgePx)) / edgePx));
    }
  }
  if (up > 0 && down > 0) return 0;
  if (up > 0) return peakPx * up;
  return down > 0 ? -peakPx * down : 0;
}
