import { SUBDIVISIONS_PER_BEAT, MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_SEMITONE } from '../constants';
import type { ScaleDefinition } from './scales';
import { nearestScaleNote, getScaleNotes } from './scales';

/** Within this many beats of a guide, the guide wins X-snap over the subdivision grid. */
const GUIDE_X_SNAP_RADIUS_BEATS = 0.25;
/** Within this many cents of a guide, the guide wins Y-snap over scale/chromatic. */
const GUIDE_Y_SNAP_RADIUS_CENTS = 50;

export interface SnapConfig {
  enabled: boolean;
  subdivisionsPerBeat: number;
  scaleRoot: number | null;
  scale: ScaleDefinition | null;
  /** 8.19 "None" Key mode. With no scale active, suppresses the chromatic-
   *  semitone Y-snap fallback so the cursor floats freely in Y. Projection
   *  echoes, scale snap, and user guides are unaffected. */
  hidePitchLines?: boolean;
  /** Harmonic Prism projection echo pitches (cents). Optional. */
  projectionTargets?: readonly number[];
  /** User-placed X-guide beat positions. Snap pulls within GUIDE_X_SNAP_RADIUS_BEATS. */
  guideXTargets?: readonly number[];
  /** User-placed Y-guide pitch positions (cents). Snap pulls within GUIDE_Y_SNAP_RADIUS_CENTS. */
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
  } else if (config.hidePitchLines) {
    // 8.19 "None" Key mode: no chromatic auto-snap. Cursor Y floats free; only
    // explicit targets (guides, projection echoes) below pull it.
    snappedY = wy;
  } else {
    // Chromatic fallback: nearest 12-TET line (multiples of 100 cents).
    const clamped = Math.max(MIN_PITCH_CENTS, Math.min(MAX_PITCH_CENTS, wy));
    snappedY = Math.round(clamped / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
  }
  // Guide Y: same precedence as X — beats scale/integer snap when closer (and
  // when projection isn't owning the snap exclusively). In 8.19 None mode the
  // chromatic fallback is gone, so a guide within radius always wins (it's the
  // only target competing with the raw cursor).
  if (
    !(config.projectionTargets && config.projectionTargets.length > 0)
    && config.guideYTargets && config.guideYTargets.length > 0
  ) {
    const nearestGuide = nearestWithinRadius(wy, config.guideYTargets, GUIDE_Y_SNAP_RADIUS_CENTS);
    if (nearestGuide !== null) {
      const distToGuide = Math.abs(wy - nearestGuide);
      const distToOther = Math.abs(wy - snappedY);
      const noBackground = config.hidePitchLines && (config.scaleRoot === null || !config.scale);
      if (noBackground || distToGuide < distToOther) snappedY = nearestGuide;
    }
  }

  return { wx: Math.max(0, snappedX), wy: snappedY };
}

/** Hard cap on adaptive snap radius (cents). Wider attractor wells get gentler
 *  peak forces (see SNAPK_REFERENCE_RADIUS in snap-magnetic), but reach is
 *  still bounded so a lone guide doesn't dominate notes that are nowhere near
 *  it. 300 ¢ (~3 ST) covers typical sparse-guide setups (gaps up to 6 ST
 *  contiguous); past this the cursor floats free between wells. */
const MAX_ADAPTIVE_RADIUS = 300;

export interface AdaptiveSnapResult {
  /** Nearest snap target to the cursor (scale note, chromatic semitone, or
   *  Y-guide). Null only in None Key mode with no guides anywhere nearby. */
  target: number | null;
  /** Half the distance to the next target on the cursor's side, capped at
   *  MAX_ADAPTIVE_RADIUS. Defines the attractor well's reach. */
  radius: number;
  /** True when |cursor - target| <= radius. Used to gate "snap engaged"
   *  behaviors: draw-snap in None mode, magnetic-attractor activation. */
  captured: boolean;
}

/** Build the union of snap targets active near `wy`. Mirrors snapToGrid's
 *  priority (projection exclusive, scale OR chromatic, guides additive) but
 *  returns the full local target list so the caller can pick neighbors. */
function collectSnapTargets(wy: number, config: SnapConfig, range: number): number[] {
  const targets: number[] = [];

  if (config.projectionTargets && config.projectionTargets.length > 0) {
    for (const t of config.projectionTargets) {
      if (Math.abs(t - wy) <= range) targets.push(t);
    }
    targets.sort((a, b) => a - b);
    return targets;
  }

  if (config.scaleRoot !== null && config.scale) {
    const scaleNotes = getScaleNotes(config.scaleRoot, config.scale);
    for (const n of scaleNotes) {
      if (Math.abs(n - wy) <= range) targets.push(n);
    }
  } else if (!config.hidePitchLines) {
    // Chromatic 12-TET lines every 100 cents.
    const lo = Math.max(MIN_PITCH_CENTS, Math.floor((wy - range) / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE);
    const hi = Math.min(MAX_PITCH_CENTS, Math.ceil((wy + range) / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE);
    for (let n = lo; n <= hi; n += CENTS_PER_SEMITONE) targets.push(n);
  }

  if (config.guideYTargets) {
    for (const g of config.guideYTargets) {
      if (Math.abs(g - wy) > range) continue;
      // Dedupe against scale/chromatic targets at the same pitch.
      if (!targets.some(t => Math.abs(t - g) < 1e-6)) targets.push(g);
    }
  }

  targets.sort((a, b) => a - b);
  return targets;
}

/** Find the nearest snap target to `wy` and the adaptive well radius around it.
 *  Radius = half the distance to the next target on the cursor's side, so
 *  adjacent wells meet at midpoints without overlapping. Pentatonic-like sparse
 *  scales and far-apart Y guides get wider wells than chromatic / dense
 *  scales — wherever the snap grid is sparser, magnetic pull reaches farther. */
export function findAdaptiveSnap(wy: number, config: SnapConfig): AdaptiveSnapResult {
  const targets = collectSnapTargets(wy, config, MAX_ADAPTIVE_RADIUS * 2);
  if (targets.length === 0) return { target: null, radius: 0, captured: false };

  let nearestIdx = 0;
  let nearestDist = Math.abs(targets[0]! - wy);
  for (let i = 1; i < targets.length; i++) {
    const d = Math.abs(targets[i]! - wy);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  const T = targets[nearestIdx]!;

  let radius: number;
  if (wy >= T) {
    const above = nearestIdx + 1 < targets.length ? targets[nearestIdx + 1]! : null;
    radius = above !== null ? Math.min((above - T) / 2, MAX_ADAPTIVE_RADIUS) : MAX_ADAPTIVE_RADIUS;
  } else {
    const below = nearestIdx - 1 >= 0 ? targets[nearestIdx - 1]! : null;
    radius = below !== null ? Math.min((T - below) / 2, MAX_ADAPTIVE_RADIUS) : MAX_ADAPTIVE_RADIUS;
  }

  return { target: T, radius, captured: Math.abs(wy - T) <= radius };
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
