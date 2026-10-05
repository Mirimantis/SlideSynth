/**
 * Sizing the canvases and the opening view (split out of main.ts in 15.3).
 */

import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, MIN_PITCH_CENTS, MAX_PITCH_CENTS, Y_PAN_MARGIN } from '../constants';
import { getCompositionLength } from '../model/composition';
import type { Composition } from '../types';
import { markBgDirty } from '../app/redraw';
import { scrollViewportToBeat } from './scrolling-play';
import type { Viewport } from './viewport';
import type { ParamViewport } from './param-viewport';

/** px; matches #param-resize-handle height + #param-canvas top */
const PARAM_HANDLE_H = 7;

export function createStage(deps: {
  viewport: Viewport;
  paramViewport: ParamViewport;
  canvasContainer: HTMLElement;
  bgCanvas: HTMLCanvasElement;
  fgCanvas: HTMLCanvasElement;
  paramContainer: HTMLElement;
  paramCanvas: HTMLCanvasElement;
  /** After a resize from outside (the window, a container): the zoom
   *  sliders follow the viewport's zoom. */
  onResized(): void;
}) {
  const { viewport, paramViewport, canvasContainer, paramContainer, paramCanvas } = deps;
  let paramW = 0;
  let paramH = 0;

  function resize() {
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    for (const canvas of [deps.bgCanvas, deps.fgCanvas]) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Widest Y zoom must fit the entire playable note range plus pan margin
    // within the area below the top rulers.
    const usableH = h - viewport.topInset;
    if (usableH > 0) {
      viewport.minZoomY = usableH / (MAX_PITCH_CENTS - MIN_PITCH_CENTS + 2 * Y_PAN_MARGIN);
      viewport.setZoomY(viewport.state.zoomY);
    }

    // Parameters Graph canvas — its own rect (different height) + DPR transform.
    // Subtract the resize-handle strip at the top so the canvas fills the area
    // below it exactly (canvas is offset by the same amount via CSS top).
    const prect = paramContainer.getBoundingClientRect();
    paramW = Math.floor(prect.width);
    paramH = Math.max(0, Math.floor(prect.height) - PARAM_HANDLE_H);
    paramCanvas.width = paramW * dpr;
    paramCanvas.height = paramH * dpr;
    paramCanvas.style.width = `${paramW}px`;
    paramCanvas.style.height = `${paramH}px`;
    paramCanvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    paramViewport.setHeight(paramH);

    markBgDirty();
  }

  /** Size the canvases now, and again whenever they change size. Once the
   *  whole layout is in, so the first sizing is the real one. */
  function start() {
    function resizeFromOutside() {
      resize();
      deps.onResized();
    }
    window.addEventListener('resize', resizeFromOutside);
    // Keep the canvases correctly sized whenever their containers change size for
    // ANY reason — window resize, the param-graph resize handle, drawer layout, or
    // a post-hot-reload relayout (which previously left the canvas 0-height until a
    // hard refresh). The observer also fires once on observe(), covering initial
    // sizing after layout settles.
    const observer = new ResizeObserver(resizeFromOutside);
    observer.observe(canvasContainer);
    observer.observe(paramContainer);
    resize();
  }

  /** Default view: about 30 seconds visible in X (at the composition's BPM),
   *  middle 3 octaves in Y (within the area below the top rulers). */
  function openingView(bpm: number, railView: boolean) {
    const rect = canvasContainer.getBoundingClientRect();
    const midPitch = (MIN_PITCH_CENTS + MAX_PITCH_CENTS) / 2;     // F#4 (6600 ¢)
    const visibleCents = 3600;                                    // 3 octaves
    const visibleBeats = (30 / 60) * bpm;                         // 30s of beats
    viewport.setZoomX(rect.width / visibleBeats);
    viewport.setZoomY((rect.height - viewport.topInset) / visibleCents);
    viewport.state.offsetY = midPitch + visibleCents / 2 + viewport.topInset / viewport.state.zoomY;
    // In the rail view, the rail — not the left edge — is where the next gesture
    // lands, so beat 0 belongs under it (BACKLOG 13.3). Otherwise a fresh
    // composition starts drawing at whatever beat the rail happens to sit over.
    if (railView) {
      scrollViewportToBeat(viewport, 0, rect.width, rect.height);
    } else {
      viewport.state.offsetX = 0;
      viewport.clampOffset(rect.width, rect.height);
    }
    markBgDirty();
  }

  return {
    /** Size the canvases to their containers. */
    resize,
    start,
    openingView,
    /** The Parameters Graph canvas's size in CSS px. */
    paramSize: () => ({ w: paramW, h: paramH }),
  };
}

/**
 * How far the view can pan in time, from the composition: the canvas extent
 * (the viewport's pan bound) and the composition's length.
 */
export function fitExtentToComposition(viewport: Viewport, comp: Composition): void {
  const length = getCompositionLength(comp);
  // Pan buffer past the last point: at least SCROLL_BUFFER beats, but bumped to
  // 2 minutes' worth at the current BPM so the user can always scroll well past
  // the end to add new content. clampOffset adds a width-aware floor on top.
  const timeBuffer = Math.max(SCROLL_BUFFER, 2 * comp.bpm);
  viewport.canvasExtent = Math.min(
    MAX_CANVAS_EXTENT,
    Math.max(MIN_CANVAS_EXTENT, length) + timeBuffer,
  );
  viewport.compLengthBeats = length;
}
