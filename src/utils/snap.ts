import { SUBDIVISIONS_PER_BEAT, MIN_NOTE, MAX_NOTE } from '../constants';
import type { ScaleDefinition } from './scales';
import { nearestScaleNote } from './scales';

/** Within this many beats of a guide, the guide wins X-snap over the subdivision grid. */
const GUIDE_X_SNAP_RADIUS_BEATS = 0.25;
/** Within this many semitones of a guide, the guide wins Y-snap over scale/integer. */
const GUIDE_Y_SNAP_RADIUS_SEMITONES = 0.5;

export interface SnapConfig {
  enabled: boolean;
  subdivisionsPerBeat: number;
  scaleRoot: number | null;
  scale: ScaleDefinition | null;
  /** Harmonic Prism projection echo pitches (MIDI float). Optional. */
  projectionTargets?: readonly number[];
  /** User-placed X-guide beat positions. Snap pulls within GUIDE_X_SNAP_RADIUS_BEATS. */
  guideXTargets?: readonly number[];
  /** User-placed Y-guide MIDI-note positions. Snap pulls within GUIDE_Y_SNAP_RADIUS_SEMITONES. */
  guideYTargets?: readonly number[];
}

/**
 * Snap world coordinates to the grid.
 * X always snaps to 1/subdivisionsPerBeat boundaries, except when an X-guide is
 *   closer (within GUIDE_X_SNAP_RADIUS_BEATS) — guides are additive.
 * Y snap behavior:
 *   • When Harmonic Prism projection is active (projectionTargets provided
 *     and non-empty) → Y snaps EXCLUSIVELY to the nearest projection echo.
 *     Grid lines, scale notes, and guides are all ignored so the user can
 *     reliably hit echo targets.
 *   • Otherwise → snaps to the nearest in-scale note (if a scale is set) or
 *     the nearest integer semitone, BUT a Y-guide within
 *     GUIDE_Y_SNAP_RADIUS_SEMITONES wins over both.
 * Returns original coordinates if snap is disabled.
 */
export function snapToGrid(
  wx: number,
  wy: number,
  config: SnapConfig,
): { wx: number; wy: number } {
  if (!config.enabled) return { wx, wy };

  const step = 1 / config.subdivisionsPerBeat;
  let snappedX = Math.round(wx / step) * step;
  // Guide X: pick the nearest within radius; if it's closer than the grid snap,
  // it wins.
  if (config.guideXTargets && config.guideXTargets.length > 0) {
    const nearestGuide = nearestWithinRadius(wx, config.guideXTargets, GUIDE_X_SNAP_RADIUS_BEATS);
    if (nearestGuide !== null) {
      const distToGuide = Math.abs(wx - nearestGuide);
      const distToGrid = Math.abs(wx - snappedX);
      if (distToGuide < distToGrid) snappedX = nearestGuide;
    }
  }

  let snappedY: number;
  if (config.projectionTargets && config.projectionTargets.length > 0) {
    // Projection mode: snap ONLY to echo targets.
    let best = config.projectionTargets[0]!;
    let bestDist = Math.abs(wy - best);
    for (let i = 1; i < config.projectionTargets.length; i++) {
      const pt = config.projectionTargets[i]!;
      const d = Math.abs(wy - pt);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    snappedY = best;
  } else if (config.scaleRoot !== null && config.scale) {
    snappedY = nearestScaleNote(wy, config.scaleRoot, config.scale);
  } else {
    snappedY = Math.round(Math.max(MIN_NOTE, Math.min(MAX_NOTE, wy)));
  }
  // Guide Y: same precedence as X — beats scale/integer snap when closer (and
  // when projection isn't owning the snap exclusively).
  if (
    !(config.projectionTargets && config.projectionTargets.length > 0)
    && config.guideYTargets && config.guideYTargets.length > 0
  ) {
    const nearestGuide = nearestWithinRadius(wy, config.guideYTargets, GUIDE_Y_SNAP_RADIUS_SEMITONES);
    if (nearestGuide !== null) {
      const distToGuide = Math.abs(wy - nearestGuide);
      const distToOther = Math.abs(wy - snappedY);
      if (distToGuide < distToOther) snappedY = nearestGuide;
    }
  }

  return { wx: Math.max(0, snappedX), wy: snappedY };
}

/** Nearest value in `targets` to `v` if it's within `radius`, else null. */
function nearestWithinRadius(v: number, targets: readonly number[], radius: number): number | null {
  let best: number | null = null;
  let bestDist = radius;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d <= bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
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
