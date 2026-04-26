// Chord-group helpers. A chord group is a set of `BezierCurve`s sharing
// the same `chordGroupId`. Grouping is for placement/deletion/transform
// coupling; point-level edits after placement do NOT cascade to siblings.

import type { BezierCurve, Track } from '../types';
import { generateId } from './tone';

export function createChordGroupId(): string {
  return generateId('chord');
}

/**
 * Return the IDs of all curves in the same chord group as `curveId`
 * (including the source curve). If the source has no group, returns just [curveId].
 */
export function getChordGroupMembers(track: Track, curveId: string): string[] {
  const source = track.curves.find(c => c.id === curveId);
  if (!source || !source.chordGroupId) return [curveId];
  const group = source.chordGroupId;
  return track.curves.filter(c => c.chordGroupId === group).map(c => c.id);
}

/** Expand a selection so that selecting any member of a chord group selects all members. */
export function expandSelectionToChordGroups(
  selectedIds: Iterable<string>,
  track: Track,
): Set<string> {
  const out = new Set<string>();
  for (const id of selectedIds) {
    out.add(id);
    const members = getChordGroupMembers(track, id);
    for (const m of members) out.add(m);
  }
  return out;
}

/** Stamp a fresh (or provided) chord-group ID onto each curve. Returns the group id. */
export function assignChordGroup(curves: BezierCurve[], groupId?: string): string {
  const id = groupId ?? createChordGroupId();
  for (const c of curves) c.chordGroupId = id;
  return id;
}

/**
 * Regenerate chord-group IDs in-place. Curves that shared a group in the input
 * share a new group in the output; curves without a group stay ungrouped.
 * Use on paste so duplicated chord groups get fresh IDs (don't collide with
 * the source).
 */
export function remapChordGroupIds(curves: BezierCurve[]): void {
  const oldToNew = new Map<string, string>();
  for (const c of curves) {
    if (!c.chordGroupId) continue;
    let mapped = oldToNew.get(c.chordGroupId);
    if (!mapped) {
      mapped = createChordGroupId();
      oldToNew.set(c.chordGroupId, mapped);
    }
    c.chordGroupId = mapped;
  }
}

/** Dissolve the chord group for every curve in the list. */
export function dissolveChordGroup(curves: BezierCurve[]): void {
  for (const c of curves) {
    if (c.chordGroupId) c.chordGroupId = null;
  }
}
