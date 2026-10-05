/**
 * Tools and modes (split out of main.ts in 15.3): switching tools, entering
 * and leaving Perform (BACKLOG 16.2), and Compose's "scroll the canvas during
 * playback".
 */

import { store } from '../state/store';
import { isRolling, forcesScrollView, type TransportEvent } from '../state/transport';
import type { ToolMode } from '../types';
import type { PlaybackEngine } from '../audio/playback';
import { rebuildTransformBox, type Interaction } from '../canvas/interaction';
import type { Viewport } from '../canvas/viewport';
import { scrollViewportToBeat } from '../canvas/scrolling-play';
import type { Performer } from '../perform/performer';
import { showToast } from '../ui/toast';
import type { Audition } from './audition';
import { markBgDirty } from './redraw';

export function createModes(deps: {
  interaction: Interaction;
  performer: Performer;
  audition: Audition;
  playback: PlaybackEngine;
  viewport: Viewport;
  canvasContainer: HTMLElement;
  transport(event: TransportEvent): void;
  effectiveScrollCanvas(): boolean;
  /** The beat under the rail. */
  railBeat(): number;
  /** Lowest offsetX the view may pan to (negative in the rail view). */
  minPanOffsetX(canvasWidth: number): number;
  /** Put the zoom sliders where the viewport's zoom is now. */
  updateZoom(): void;
}) {
  const { interaction, performer, audition, playback, viewport, canvasContainer } = deps;

  /** Entering Select with curves already selected (e.g. a track clicked while in
   *  Draw) shows their transform box straight away. */
  function buildTransformBoxFromSelection(): void {
    const st = store.getState();
    if (st.selectedCurveIds.size === 0 || interaction.transformBox) return;
    const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
    if (track) rebuildTransformBox(interaction, track);
  }

  /** Switch tools — the tool buttons and D / V / X / C. */
  function selectTool(tool: ToolMode) {
    store.setTool(tool);
    if (tool !== 'draw' && interaction.drawingCurve) {
      interaction.drawingCurve = null;
    }
    if (tool !== 'draw') audition.endPreview();
    if (tool === 'scissors') {
      interaction.transformBox = null;
      store.setSelectedCurve(null);
      store.setSelectedPoint(null);
    } else if (tool === 'nudge') {
      // The brush works on whatever curve you press; no box in the way.
      interaction.transformBox = null;
    } else if (tool === 'draw') {
      // Clear the transform box but keep the curve selection so Draw extends it.
      interaction.transformBox = null;
    } else if (tool === 'select') {
      buildTransformBoxFromSelection();
    }
  }

  /**
   * Enter or leave Perform (BACKLOG 16.2). Returns whether the mode is now `on`.
   *
   * Entering ends whatever the edit tools had in flight, as switching tools
   * does, and puts the rail on the playhead; if the transport is rolling, its
   * clock becomes open-ended. Leaving hands the left button back to the active
   * tool, and when stopped leaves the playhead where the rail was. It's refused
   * while the left button is held, and while a recording runs (the mouse would
   * silently stop feeding it).
   */
  function setPerformMode(on: boolean): boolean {
    const st = store.getState();
    if (st.performMode === on) return true;
    if (performer.engine.isLmbDown() || performer.fingerCount() > 0) return false;
    if (!on && forcesScrollView(st.transport)) {
      showToast('Stop recording first', 2000);
      return false;
    }
    const r = canvasContainer.getBoundingClientRect();
    if (on) {
      const wasRailView = deps.effectiveScrollCanvas();
      interaction.drawingCurve = null;
      interaction.transformBox = null;
      audition.endPreview();
      store.setPerformMode(true);
      if (isRolling(st.transport)) {
        deps.transport({ type: 'open-clock' });
      } else if (!wasRailView) {
        scrollViewportToBeat(viewport, st.playback.positionBeats, r.width, r.height);
      }
    } else {
      if (!playback.isPlaying()) store.setPlaybackPosition(deps.railBeat());
      store.setPerformMode(false);
      viewport.clampOffset(r.width, r.height, deps.minPanOffsetX(r.width));
      selectTool(st.activeTool);
    }
    deps.updateZoom();
    markBgDirty();
    return true;
  }

  /** A tool button or D / V / X / C. In Perform, picking a tool is also how
   *  you go back to editing. */
  function chooseTool(tool: ToolMode) {
    if (!setPerformMode(false)) return;
    selectTool(tool);
  }

  /** Compose mode's "scroll the canvas during playback" (BACKLOG 16.2), from
   *  the View menu. Stopped, the rail appears on the playhead, as when entering
   *  Perform. */
  function toggleScrollDuringPlayback(): void {
    store.setScrollCanvas(!store.getState().scrollCanvasEnabled);
    if (playback.isPlaying()) return;
    const r = canvasContainer.getBoundingClientRect();
    if (deps.effectiveScrollCanvas()) {
      scrollViewportToBeat(viewport, store.getState().playback.positionBeats, r.width, r.height);
    } else {
      viewport.clampOffset(r.width, r.height, deps.minPanOffsetX(r.width));
    }
    deps.updateZoom();
    markBgDirty();
  }

  return { selectTool, setPerformMode, chooseTool, toggleScrollDuringPlayback };
}
