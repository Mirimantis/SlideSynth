import type { ViewportState } from '../types';
import {
  DEFAULT_ZOOM_X, DEFAULT_ZOOM_Y,
  MIN_ZOOM_X, MAX_ZOOM_X,
  MIN_ZOOM_Y, MAX_ZOOM_Y,
  MIN_NOTE, MAX_NOTE,
  MIN_CANVAS_EXTENT, SCROLL_BUFFER,
} from '../constants';

export interface Viewport {
  state: ViewportState;
  /** Rightmost beat the viewport may pan to — derived from composition length + buffer. */
  canvasExtent: number;
  /** World (beats, noteNumber) → screen pixels */
  worldToScreen(wx: number, wy: number): { sx: number; sy: number };
  /** Screen pixels → world (beats, noteNumber) */
  screenToWorld(sx: number, sy: number): { wx: number; wy: number };
  /** Zoom X by factor, centered on screen point */
  zoomXAt(factor: number, screenX: number): void;
  /** Zoom Y by factor, centered on screen point */
  zoomYAt(factor: number, screenY: number): void;
  /** Pan by screen-space delta */
  panBy(dsx: number, dsy: number): void;
  /** Set zoom levels directly (for sliders) */
  setZoomX(z: number): void;
  setZoomY(z: number): void;
  /** Clamp the viewport offset so it doesn't scroll past composition bounds */
  clampOffset(canvasWidth: number, canvasHeight: number): void;
}

export function createViewport(): Viewport {
  const state: ViewportState = {
    offsetX: 0,
    offsetY: MAX_NOTE,
    zoomX: DEFAULT_ZOOM_X,
    zoomY: DEFAULT_ZOOM_Y,
  };

  const vp: Viewport = {
    state,
    canvasExtent: MIN_CANVAS_EXTENT + SCROLL_BUFFER,

    worldToScreen(wx: number, wy: number) {
      // X: beats → pixels (left = beat 0)
      const sx = (wx - state.offsetX) * state.zoomX;
      // Y: note number → pixels (top = high notes, bottom = low notes)
      // Higher note numbers appear higher (lower Y pixel value)
      const sy = (state.offsetY - wy) * state.zoomY;
      return { sx, sy };
    },

    screenToWorld(sx: number, sy: number) {
      const wx = sx / state.zoomX + state.offsetX;
      const wy = state.offsetY - sy / state.zoomY;
      return { wx, wy };
    },

    zoomXAt(factor: number, screenX: number) {
      const worldX = screenX / state.zoomX + state.offsetX;
      state.zoomX = clamp(state.zoomX * factor, MIN_ZOOM_X, MAX_ZOOM_X);
      state.offsetX = worldX - screenX / state.zoomX;
    },

    zoomYAt(factor: number, screenY: number) {
      const worldY = state.offsetY - screenY / state.zoomY;
      state.zoomY = clamp(state.zoomY * factor, MIN_ZOOM_Y, MAX_ZOOM_Y);
      state.offsetY = worldY + screenY / state.zoomY;
    },

    panBy(dsx: number, dsy: number) {
      state.offsetX -= dsx / state.zoomX;
      state.offsetY += dsy / state.zoomY;
    },

    setZoomX(z: number) {
      state.zoomX = clamp(z, MIN_ZOOM_X, MAX_ZOOM_X);
    },

    setZoomY(z: number) {
      state.zoomY = clamp(z, MIN_ZOOM_Y, MAX_ZOOM_Y);
    },

    clampOffset(canvasWidth: number, canvasHeight: number) {
      // X: can't scroll before beat 0, can't scroll past the canvas extent
      const visibleBeats = canvasWidth / state.zoomX;
      state.offsetX = clamp(state.offsetX, 0, Math.max(0, vp.canvasExtent - visibleBeats));

      // Y: can't scroll past note range
      const visibleNotes = canvasHeight / state.zoomY;
      const minOffsetY = MIN_NOTE + visibleNotes;
      const maxOffsetY = MAX_NOTE;
      state.offsetY = clamp(state.offsetY, minOffsetY, maxOffsetY);
    },
  };

  return vp;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
