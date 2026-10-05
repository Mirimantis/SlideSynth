/**
 * What the Tempo and Snap drawers' controls do beyond the store (split out of
 * main.ts in 15.3). The Tuning drawer's are in tuning-actions.ts.
 */

import { store } from '../state/store';
import { history } from '../state/history';
import { nearestNote, staffGridFor } from '../tuning/tuning';
import type { Viewport } from '../canvas/viewport';
import { markBgDirty } from '../app/redraw';
import { openPresetSaveDialog } from './preset-save-dialog';
import { showToast } from './toast';
import type { TempoActions } from './tempo-panel';
import type { SnapActions } from './snap-panel';

/** Tempo drawer edits (BACKLOG 16.3): each is one undo step. */
export const tempoActions: TempoActions = {
  setBpm(bpm) {
    history.snapshot();
    store.setBpm(bpm);
  },
  setTimeSignature(beats, denominator) {
    history.snapshot();
    store.setTimeSignature(beats, denominator);
  },
};

/** The Snap drawer (BACKLOG 16.4). New guides land in the middle of the view. */
export function createSnapActions(deps: { viewport: Viewport; canvasContainer: HTMLElement }): SnapActions {
  const { viewport, canvasContainer } = deps;

  /** Add a beat guide (x) or a fret (y) at the centre of the current viewport,
   *  then auto-select it so the user can immediately drag or rename it. */
  function addGuideAtViewportCenter(orientation: 'x' | 'y'): void {
    const r = canvasContainer.getBoundingClientRect();
    const centre = viewport.screenToWorld(r.width / 2, r.height / 2);
    const position = orientation === 'x'
      ? Math.max(0, Math.round(centre.wx * 4) / 4)   // round to nearest 1/4 beat for tidiness
      : nearestNote(staffGridFor(store.getState()).lines.map(l => l.cents), centre.wy); // the tuning's nearest note
    const guide = {
      id: `guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orientation,
      position,
      label: '',
    };
    history.snapshot();
    store.addGuide(guide);
    store.setSelectedGuide(guide.id);
    // Force the viewport to re-show the guides if they were hidden.
    store.setGuidesVisible(true);
    if (orientation === 'y') store.setFretsVisible(true);
    markBgDirty();
  }

  return {
    askPresetName: existingNames => openPresetSaveDialog({ title: 'Save Snap Preset', existingNames }),
    confirmDeletePreset: name => confirm(`Delete user preset "${name}"?`),
    addGuide: addGuideAtViewportCenter,
    redrawGuides: () => { markBgDirty(); },
    notify: showToast,
  };
}
