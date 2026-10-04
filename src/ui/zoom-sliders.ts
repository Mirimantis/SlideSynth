/**
 * The zoom sliders along the canvas's edges (13.32; split out of main.ts in
 * 15.3): time along the bottom, pitch down the right side.
 */

import { MIN_ZOOM_X, MAX_ZOOM_X } from '../constants';
import { computeMultiCurveBBox } from '../model/curve';
import { store } from '../state/store';
import type { Viewport } from '../canvas/viewport';

/** Zoom X slider uses a logarithmic mapping so a single slider covers the full
 *  ~1200× range (0.5..600 px/beat) without the low-zoom end squeezing out all
 *  the useful mid-zoom resolution. */
const ZOOM_X_LOG_STEPS = 1000;
const ZOOM_X_LOG_RATIO = Math.log(MAX_ZOOM_X / MIN_ZOOM_X);

export function sliderPosToZoomX(pos: number): number {
  const t = Math.max(0, Math.min(1, pos / ZOOM_X_LOG_STEPS));
  return MIN_ZOOM_X * Math.exp(t * ZOOM_X_LOG_RATIO);
}

export function zoomXToSliderPos(zoom: number): number {
  const t = Math.log(zoom / MIN_ZOOM_X) / ZOOM_X_LOG_RATIO;
  return Math.round(Math.max(0, Math.min(1, t)) * ZOOM_X_LOG_STEPS);
}

export interface ZoomSliders {
  /** Put the sliders where the viewport's zoom is now (after a zoom from
   *  anywhere else: the wheel, a resize, a fresh view). */
  update(): void;
}

export function createZoomSliders(deps: {
  zoomX: HTMLInputElement;
  zoomY: HTMLInputElement;
  viewport: Viewport;
  canvasContainer: HTMLElement;
  /** Lowest offsetX the view may pan to (negative in the rail view). */
  minPanOffsetX(canvasWidth: number): number;
  /** The view changed. */
  onZoom(): void;
}): ZoomSliders {
  const { zoomX, zoomY, viewport, canvasContainer } = deps;

  /** Anchor for slider zoom: center of selection bbox if any selected, else canvas center. */
  function anchor(): { sx: number; sy: number } {
    const rect = canvasContainer.getBoundingClientRect();
    const center = { sx: rect.width / 2, sy: rect.height / 2 };
    const state = store.getState();
    if (state.selectedCurveIds.size === 0) return center;
    const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
    if (!track) return center;
    const selected = track.curves.filter(c => state.selectedCurveIds.has(c.id));
    if (selected.length === 0) return center;
    const bbox = computeMultiCurveBBox(selected);
    return viewport.worldToScreen((bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2);
  }

  function settle() {
    const rect = canvasContainer.getBoundingClientRect();
    viewport.clampOffset(rect.width, rect.height, deps.minPanOffsetX(rect.width));
    deps.onZoom();
  }

  zoomX.value = String(zoomXToSliderPos(viewport.state.zoomX));
  zoomX.addEventListener('input', () => {
    const target = sliderPosToZoomX(Number(zoomX.value));
    const factor = target / viewport.state.zoomX;
    if (factor !== 1 && isFinite(factor)) viewport.zoomXAt(factor, anchor().sx);
    else viewport.setZoomX(target);
    settle();
  });
  zoomY.addEventListener('input', () => {
    const target = Number(zoomY.value);
    const factor = target / viewport.state.zoomY;
    if (factor !== 1 && isFinite(factor)) viewport.zoomYAt(factor, anchor().sy);
    else viewport.setZoomY(target);
    settle();
  });
  // Release focus after the user finishes adjusting so hotkeys (e.g. Space) don't
  // get captured by the range input.
  zoomX.addEventListener('change', () => zoomX.blur());
  zoomY.addEventListener('change', () => zoomY.blur());

  return {
    update() {
      zoomX.value = String(zoomXToSliderPos(viewport.state.zoomX));
      zoomY.min = String(viewport.minZoomY);
      zoomY.value = String(viewport.state.zoomY);
    },
  };
}
