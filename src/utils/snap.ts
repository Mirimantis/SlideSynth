import { SUBDIVISIONS_PER_BEAT, MIN_NOTE, MAX_NOTE } from '../constants';
import type { ScaleDefinition } from './scales';
import { nearestScaleNote } from './scales';

export interface SnapConfig {
  enabled: boolean;
  subdivisionsPerBeat: number;
  scaleRoot: number | null;
  scale: ScaleDefinition | null;
}

/**
 * Snap world coordinates to the grid.
 * X snaps to 1/16 beat boundaries.
 * Y snaps to nearest in-scale note if a scale is active, otherwise nearest integer note.
 * Returns original coordinates if snap is disabled.
 */
export function snapToGrid(
  wx: number,
  wy: number,
  config: SnapConfig,
): { wx: number; wy: number } {
  if (!config.enabled) return { wx, wy };

  const step = 1 / config.subdivisionsPerBeat;
  const snappedX = Math.round(wx / step) * step;

  let snappedY: number;
  if (config.scaleRoot !== null && config.scale) {
    snappedY = nearestScaleNote(wy, config.scaleRoot, config.scale);
  } else {
    snappedY = Math.round(Math.max(MIN_NOTE, Math.min(MAX_NOTE, wy)));
  }

  return { wx: Math.max(0, snappedX), wy: snappedY };
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  subdivisionsPerBeat: SUBDIVISIONS_PER_BEAT,
  scaleRoot: null,
  scale: null,
};

/**
 * Compute the snap subdivision count based on the current X zoom level.
 * At high zoom, snaps to 1/16 beats. At lower zoom, coarsens to
 * musically meaningful divisions: eighths, quarters, whole beats, measures.
 */
export function getAdaptiveSubdivisions(zoomX: number): number {
  if (zoomX >= 60) return 16;           // 1/16 beats (sixteenths)
  if (zoomX >= 35) return 2;            // 1/2 beats (eighths)
  return 1;                             // whole beats
}

/**
 * Choose the coarsest musical interval (in beats) that still keeps adjacent
 * beat/measure gridlines at least MIN_GRID_PX apart. Used by the staff grid
 * and the ruler so zooming out progresses cleanly through beats → measures →
 * every-2nd measure → every-4th, etc, instead of drawing thousands of
 * sub-pixel lines.
 */
const MIN_GRID_PX = 30;
export function getAdaptiveBeatStep(zoomX: number, measureLen: number): number {
  if (zoomX * 1 >= MIN_GRID_PX) return 1;
  if (measureLen <= 0) return 1;
  let step = measureLen;
  while (zoomX * step < MIN_GRID_PX) step *= 2;
  return step;
}
