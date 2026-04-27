// Curve-group helpers. A group is a set of `BezierCurve`s sharing the same
// `groupId`. Groups can come from chord-cluster placement (Harmonic Prism Draw)
// or freehand Group/Ungroup actions. Grouping couples placement/deletion/
// transform; point-level edits do NOT cascade to siblings.

import type { BezierCurve, Track } from '../types';
import { generateId } from './tone';

export function createGroupId(): string {
  return generateId('group');
}

/**
 * Return the IDs of all curves in the same group as `curveId`
 * (including the source curve). If the source has no group, returns just [curveId].
 */
export function getGroupMembers(track: Track, curveId: string): string[] {
  const source = track.curves.find(c => c.id === curveId);
  if (!source || !source.groupId) return [curveId];
  const group = source.groupId;
  return track.curves.filter(c => c.groupId === group).map(c => c.id);
}

/** Expand a selection so that selecting any member of a group selects all members. */
export function expandSelectionToGroups(
  selectedIds: Iterable<string>,
  track: Track,
): Set<string> {
  const out = new Set<string>();
  for (const id of selectedIds) {
    out.add(id);
    const members = getGroupMembers(track, id);
    for (const m of members) out.add(m);
  }
  return out;
}

/** Stamp a fresh (or provided) group ID onto each curve. Returns the group id. */
export function assignGroup(curves: BezierCurve[], groupId?: string): string {
  const id = groupId ?? createGroupId();
  for (const c of curves) c.groupId = id;
  return id;
}

/**
 * Regenerate group IDs in-place. Curves that shared a group in the input
 * share a new group in the output; curves without a group stay ungrouped.
 * Use on paste / duplicate so duplicated groups get fresh IDs that don't
 * collide with the source.
 */
export function remapGroupIds(curves: BezierCurve[]): void {
  const oldToNew = new Map<string, string>();
  for (const c of curves) {
    if (!c.groupId) continue;
    let mapped = oldToNew.get(c.groupId);
    if (!mapped) {
      mapped = createGroupId();
      oldToNew.set(c.groupId, mapped);
    }
    c.groupId = mapped;
  }
}

/** Dissolve the group for every curve in the list. */
export function dissolveGroup(curves: BezierCurve[]): void {
  for (const c of curves) {
    if (c.groupId) c.groupId = null;
  }
}

/** True if every selected curve already shares a single group id. */
export function allShareGroup(curves: BezierCurve[]): boolean {
  if (curves.length < 2) return false;
  const first = curves[0]!.groupId;
  if (!first) return false;
  return curves.every(c => c.groupId === first);
}

/** True if any selected curve has a non-null group id. */
export function anyGrouped(curves: BezierCurve[]): boolean {
  return curves.some(c => !!c.groupId);
}
