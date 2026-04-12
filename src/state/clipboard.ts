import type { ControlPoint } from '../types';
import { store } from './store';
import { history } from './history';
import { createCurve, deepCopyPoints } from '../model/curve';

interface ClipboardEntry {
  curves: { points: ControlPoint[] }[];
  originX: number;
}

let clipboard: ClipboardEntry | null = null;

export function hasClipboard(): boolean {
  return clipboard !== null;
}

/** Copy selected curves to the in-memory clipboard. */
export function copySelectedCurves(): boolean {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return false;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return false;

  const entries: { points: ControlPoint[] }[] = [];
  let originX = Infinity;

  for (const curveId of state.selectedCurveIds) {
    const curve = track.curves.find(c => c.id === curveId);
    if (!curve || curve.points.length === 0) continue;
    entries.push({ points: deepCopyPoints(curve.points) });
    for (const pt of curve.points) {
      if (pt.position.x < originX) originX = pt.position.x;
    }
  }

  if (entries.length === 0) return false;

  clipboard = { curves: entries, originX };
  return true;
}

/** Cut selected curves: copy then delete. */
export function cutSelectedCurves(): boolean {
  const state = store.getState();
  if (!copySelectedCurves()) return false;

  const idsToDelete = [...state.selectedCurveIds];
  history.snapshot();
  store.mutate(comp => {
    const track = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (track) {
      for (const curveId of idsToDelete) {
        const idx = track.curves.findIndex(c => c.id === curveId);
        if (idx >= 0) track.curves.splice(idx, 1);
      }
    }
  });
  store.setSelectedCurve(null);
  return true;
}

/**
 * Paste clipboard curves at the given beat position.
 * Returns the new curve IDs (for transform box rebuild), or null if nothing pasted.
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

    for (const entry of clipboard!.curves) {
      const curve = createCurve();
      curve.points = deepCopyPoints(entry.points);
      for (const pt of curve.points) {
        pt.position.x += offsetX;
      }
      track.curves.push(curve);
      newIds.push(curve.id);
    }
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}

/**
 * Duplicate selected curves with a small horizontal offset.
 * Returns the new curve IDs, or null if nothing duplicated.
 */
export function duplicateCurves(): string[] | null {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return null;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return null;

  // Compute the width of the selection to place duplicates after it
  let minX = Infinity;
  let maxX = -Infinity;
  for (const curveId of state.selectedCurveIds) {
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
    const t = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (!t) return;

    for (const curveId of state.selectedCurveIds) {
      const original = t.curves.find(c => c.id === curveId);
      if (!original || original.points.length === 0) continue;
      const curve = createCurve();
      curve.points = deepCopyPoints(original.points);
      for (const pt of curve.points) {
        pt.position.x += offsetX;
      }
      t.curves.push(curve);
      newIds.push(curve.id);
    }
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}

/**
 * Duplicate selected curves, placing each copy so its first point
 * is at the last point of the original (continuation).
 * Returns the new curve IDs, or null if nothing duplicated.
 */
export function continueCurves(): string[] | null {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0 || !state.selectedTrackId) return null;

  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return null;

  const newIds: string[] = [];

  history.snapshot();
  store.mutate(comp => {
    const t = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (!t) return;

    for (const curveId of state.selectedCurveIds) {
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
      t.curves.push(curve);
      newIds.push(curve.id);
    }
  });

  if (newIds.length > 0) {
    store.setSelectedCurves(newIds);
  }
  return newIds.length > 0 ? newIds : null;
}
