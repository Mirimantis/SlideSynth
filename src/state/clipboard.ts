import type { ControlPoint } from '../types';
import { store } from './store';
import { history } from './history';
import { createCurve, deepCopyPoints } from '../model/curve';
import { expandSelectionToGroups, remapGroupIds, createGroupId } from '../model/curve-groups';

interface ClipboardEntry {
  points: ControlPoint[];
  groupId: string | null;     // group membership at copy time (so paste can preserve cluster identity within the paste)
  voiceIndex: number | null;  // chord-cluster voice index, if any
}

interface Clipboard {
  curves: ClipboardEntry[];
  originX: number;
}

let clipboard: Clipboard | null = null;

export function hasClipboard(): boolean {
  return clipboard !== null;
}

/** Copy selected curves (auto-expanding chord-group siblings) to the in-memory clipboard. */
export function copySelectedCurves(): boolean {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return false;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return false;

  const expandedIds = expandSelectionToGroups(state.selectedCurveIds, track);
  const entries: ClipboardEntry[] = [];
  let originX = Infinity;

  for (const curveId of expandedIds) {
    const curve = track.curves.find(c => c.id === curveId);
    if (!curve || curve.points.length === 0) continue;
    entries.push({
      points: deepCopyPoints(curve.points),
      groupId: curve.groupId ?? null,
      voiceIndex: curve.voiceIndex ?? null,
    });
    for (const pt of curve.points) {
      if (pt.position.x < originX) originX = pt.position.x;
    }
  }

  if (entries.length === 0) return false;

  clipboard = { curves: entries, originX };
  return true;
}

/** Cut selected curves (auto-expanding chord-group siblings): copy then delete. */
export function cutSelectedCurves(): boolean {
  const state = store.getState();
  if (!copySelectedCurves()) return false;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return false;
  const idsToDelete = expandSelectionToGroups(state.selectedCurveIds, track);

  history.snapshot();
  store.mutate(comp => {
    const t = comp.tracks.find(tt => tt.id === state.selectedTrackId);
    if (t) {
      for (let i = t.curves.length - 1; i >= 0; i--) {
        if (idsToDelete.has(t.curves[i]!.id)) t.curves.splice(i, 1);
      }
    }
  });
  store.setSelectedCurve(null);
  return true;
}

/**
 * Paste clipboard curves at the given beat position. Group memberships in the
 * clipboard entry are preserved across the paste set with fresh group IDs (so
 * pasting a chord cluster gives you a new cluster that doesn't collide with the
 * source). Returns the new curve IDs (for transform box rebuild), or null.
 */
export function pasteCurves(atBeat: number): string[] | null {
  if (!clipboard) return null;

  const state = store.getState();
  if (!state.selectedTrackId) return null;

  const offsetX = atBeat - clipboard.originX;
  const newIds: string[] = [];

  history.snapshot();
  store.mutate(comp => {
    const track = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (!track) return;

    const created: { curve: ReturnType<typeof createCurve>; groupId: string | null }[] = [];
    for (const entry of clipboard!.curves) {
      const curve = createCurve();
      curve.points = deepCopyPoints(entry.points);
      for (const pt of curve.points) {
        pt.position.x += offsetX;
      }
      curve.groupId = entry.groupId;
      if (entry.voiceIndex !== null) curve.voiceIndex = entry.voiceIndex;
      track.curves.push(curve);
      newIds.push(curve.id);
      created.push({ curve, groupId: entry.groupId });
    }
    // Remap any preserved group IDs to fresh ones so the pasted set doesn't
    // collide with the source group(s).
    remapGroupIds(created.map(c => c.curve));
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}

/**
 * Duplicate selected curves (auto-expanding chord-group siblings) with a small
 * horizontal offset. Group identity is preserved within the dupe set with a
 * fresh ID. Returns the new curve IDs, or null.
 */
export function duplicateCurves(): string[] | null {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return null;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return null;

  const expandedIds = expandSelectionToGroups(state.selectedCurveIds, track);

  let minX = Infinity;
  let maxX = -Infinity;
  for (const curveId of expandedIds) {
    const curve = track.curves.find(c => c.id === curveId);
    if (!curve) continue;
    for (const pt of curve.points) {
      if (pt.position.x < minX) minX = pt.position.x;
      if (pt.position.x > maxX) maxX = pt.position.x;
    }
  }
  if (minX === Infinity) return null;

  const offsetX = (maxX - minX) + 0.25;
  const newIds: string[] = [];

  history.snapshot();
  store.mutate(comp => {
    const t = comp.tracks.find(tt => tt.id === state.selectedTrackId);
    if (!t) return;

    const created: ReturnType<typeof createCurve>[] = [];
    for (const curveId of expandedIds) {
      const original = t.curves.find(c => c.id === curveId);
      if (!original || original.points.length === 0) continue;
      const curve = createCurve();
      curve.points = deepCopyPoints(original.points);
      for (const pt of curve.points) {
        pt.position.x += offsetX;
      }
      curve.groupId = original.groupId ?? null;
      if (original.voiceIndex !== undefined) curve.voiceIndex = original.voiceIndex;
      t.curves.push(curve);
      newIds.push(curve.id);
      created.push(curve);
    }
    remapGroupIds(created);
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}

/**
 * Duplicate selected curves (auto-expanding chord-group siblings), placing each
 * copy so its first point is at the last point of the original (continuation).
 * The continuation set gets a FRESH group id so it forms a new chord cluster
 * after the original (per Phase 2 design decision). Returns the new curve IDs.
 */
export function continueCurves(): string[] | null {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return null;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return null;

  const expandedIds = expandSelectionToGroups(state.selectedCurveIds, track);
  const newIds: string[] = [];

  history.snapshot();
  store.mutate(comp => {
    const t = comp.tracks.find(tt => tt.id === state.selectedTrackId);
    if (!t) return;

    // For continuations of chord clusters, every sibling shares ONE new group id.
    // For ungrouped sources, no group is assigned. Track old-group → new-group mapping.
    const oldToNewGroup = new Map<string, string>();

    for (const curveId of expandedIds) {
      const original = t.curves.find(c => c.id === curveId);
      if (!original || original.points.length === 0) continue;

      const firstPt = original.points[0]!;
      const lastPt = original.points[original.points.length - 1]!;
      const offsetX = lastPt.position.x - firstPt.position.x;
      const offsetY = lastPt.position.y - firstPt.position.y;

      const curve = createCurve();
      curve.points = deepCopyPoints(original.points);
      for (const pt of curve.points) {
        pt.position.x += offsetX;
        pt.position.y += offsetY;
      }
      if (original.groupId) {
        let g = oldToNewGroup.get(original.groupId);
        if (!g) {
          g = createGroupId();
          oldToNewGroup.set(original.groupId, g);
        }
        curve.groupId = g;
      }
      if (original.voiceIndex !== undefined) curve.voiceIndex = original.voiceIndex;
      t.curves.push(curve);
      newIds.push(curve.id);
    }
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}
