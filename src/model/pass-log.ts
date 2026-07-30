/**
 * Log of performed passes, for "drop last pass" / undo-last-layer (BACKLOG 10.4).
 *
 * The log is **append-only**: entries are never popped. Whether a pass can be
 * dropped is *derived* from whether its curves still exist in the composition.
 * That single choice buys three things:
 *
 *  - Dropping needs no bookkeeping — the curves go, so the entry stops
 *    qualifying on its own.
 *  - Ctrl+Z restoring a dropped pass makes it droppable *again* automatically,
 *    with no undo hooks or flags, which is the looper's "redo layer".
 *  - Curves removed by other means (manual delete, cut, move-to-track) age
 *    their entry out instead of leaving dangling ids behind.
 */

import type { Composition, Track } from '../types';

export interface CommittedPass {
  /** Track the pass committed onto. */
  trackId: string;
  curveIds: string[];
  /** Did this pass open its layer track? Only then is the emptied track removed
   *  along with it — a track the user made themselves is left alone. */
  createdTrack: boolean;
}

export interface DroppablePass {
  pass: CommittedPass;
  /** Curve ids from the pass that are still present. A partially deleted pass
   *  drops whatever is left of it. */
  surviving: string[];
}

/**
 * Newest pass that still has curves in the composition, walking backward — the
 * same newest-first idiom as repeated Keep presses. Returns null when nothing
 * in the log survives.
 */
export function findDroppablePass(
  log: readonly CommittedPass[],
  comp: Composition,
): DroppablePass | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const pass = log[i]!;
    const track = comp.tracks.find(t => t.id === pass.trackId);
    if (!track) continue;
    const present = new Set(track.curves.map(c => c.id));
    const surviving = pass.curveIds.filter(id => present.has(id));
    if (surviving.length > 0) return { pass, surviving };
  }
  return null;
}

export interface DropResult {
  curvesRemoved: number;
  /** Track the curves came off, for the caller's toast + removal decision. */
  track: Track;
  /** True when the pass created this track and nothing is left in it, so the
   *  caller should remove the track to fully reverse the pass. */
  shouldRemoveTrack: boolean;
}

/**
 * Remove a pass's surviving curves from their track. Mutates the composition;
 * call inside store.mutate. Track removal is left to the caller because it has
 * store-level side effects (selection, MIDI arm, projection source) that don't
 * belong in a model helper — see store.removeTrack.
 */
export function dropPassCurves(
  comp: Composition,
  pass: CommittedPass,
  surviving: readonly string[],
): DropResult | null {
  const track = comp.tracks.find(t => t.id === pass.trackId);
  if (!track) return null;
  const doomed = new Set(surviving);
  const before = track.curves.length;
  track.curves = track.curves.filter(c => !doomed.has(c.id));
  const curvesRemoved = before - track.curves.length;
  return {
    curvesRemoved,
    track,
    shouldRemoveTrack: pass.createdTrack && track.curves.length === 0,
  };
}
