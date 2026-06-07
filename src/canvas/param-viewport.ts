import type { Viewport } from './viewport';

/**
 * Projection helper for the Parameters Graph canvas.
 *
 * The X (time/beat) axis is LOCKED to the main viewport — same offsetX and
 * zoomX — so the parameter lane stays pixel-aligned with the pitch curve under
 * pan and X-zoom. The Y axis is INDEPENDENT and fixed: parameter value 0..1
 * maps into the canvas height (1 at top, 0 at bottom) with a small vertical pad.
 */
export interface ParamViewport {
  /** World (beat, value 0..1) → screen pixels in the param canvas. */
  worldToScreen(beat: number, value: number): { sx: number; sy: number };
  /** Screen pixels → world (beat, value 0..1). */
  screenToWorld(sx: number, sy: number): { beat: number; value: number };
  /** Map a beat to its screen X (shares the main viewport's X transform). */
  beatToX(beat: number): number;
  /** Update the canvas height (CSS px) used for the Y mapping. */
  setHeight(h: number): void;
  /** Vertical padding (px) reserved at top and bottom of the value range. */
  readonly pad: number;
}

export function createParamViewport(main: Viewport, pad: number = 14): ParamViewport {
  let height = 140;

  function valueToY(value: number): number {
    const usable = Math.max(1, height - pad * 2);
    return pad + (1 - value) * usable;
  }
  function yToValue(sy: number): number {
    const usable = Math.max(1, height - pad * 2);
    return 1 - (sy - pad) / usable;
  }

  return {
    pad,
    beatToX(beat: number) {
      return (beat - main.state.offsetX) * main.state.zoomX;
    },
    worldToScreen(beat: number, value: number) {
      return {
        sx: (beat - main.state.offsetX) * main.state.zoomX,
        sy: valueToY(value),
      };
    },
    screenToWorld(sx: number, sy: number) {
      return {
        beat: sx / main.state.zoomX + main.state.offsetX,
        value: yToValue(sy),
      };
    },
    setHeight(h: number) {
      height = h;
    },
  };
}
