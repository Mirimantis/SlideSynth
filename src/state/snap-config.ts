import type { AppState, Composition } from '../types';
import type { SnapConfig } from '../utils/snap';
import { getAdaptiveSubdivisions } from '../utils/snap';
import { pitchSetFor, prismOffsets } from '../tuning/tuning';
import { computeProjectionTargetsAtX } from '../canvas/projection-renderer';
import { SUBDIVISIONS_PER_BEAT } from '../constants';
import { store } from './store';

/**
 * The one snap-config builder (BACKLOG 15.6). Drawing, point and transform
 * drags, guide drags, ruler scrubbing, the hold-A audition and live
 * performance all get their snap targets here, so they can't disagree. Before,
 * perform built its own config without Prism projection echoes, and the
 * preview built one without guides or echoes (14.4). 12.1 (snap-target
 * composition) grows from here.
 */
export interface SnapQuery {
  /** Horizontal zoom (px per beat); picks the beat-grid resolution. Omit for
   *  the finest default. */
  zoomX?: number;
  /** Beat the snap happens at. Harmonic Prism projection echoes are sampled
   *  here; omit it and they're left out (callers that only snap X). */
  atBeat?: number;
  /** A guide being dragged, left out of the targets so it can't snap to itself. */
  excludeGuideId?: string;
}

/** The slice of app state a snap config is built from. */
export type SnapSources = Pick<AppState,
  'snapEnabled' | 'tuning' | 'root' | 'scaleId' | 'tunedFrom' | 'hidePitchLines' | 'guidesVisible' | 'harmonicPrism'
> & { composition: Pick<Composition, 'tracks' | 'guides'> };

export function snapConfigFor(st: SnapSources, q: SnapQuery = {}): SnapConfig {
  // Harmonic Prism projection: echo pitches of the source curve at this beat.
  // snapToGrid / findAdaptiveSnap treat a non-empty list as exclusive Y targets.
  let projectionTargets: readonly number[] | undefined;
  const prism = st.harmonicPrism;
  if (prism.projectionSourceId && q.atBeat !== undefined) {
    let source;
    for (const t of st.composition.tracks) {
      source = t.curves.find(c => c.id === prism.projectionSourceId);
      if (source) break;
    }
    if (source) {
      projectionTargets = computeProjectionTargetsAtX(
        source, prismOffsets(prism.chordSpec, st), prism.projectionOctaveRange, q.atBeat,
      );
    }
  }

  // User guides (8.7) snap only while visible.
  let guideXTargets: readonly number[] | undefined;
  let guideYTargets: readonly number[] | undefined;
  if (st.guidesVisible) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const g of st.composition.guides) {
      if (g.id === q.excludeGuideId) continue;
      (g.orientation === 'x' ? xs : ys).push(g.position);
    }
    if (xs.length > 0) guideXTargets = xs;
    if (ys.length > 0) guideYTargets = ys;
  }

  return {
    enabled: st.snapEnabled,
    subdivisionsPerBeat: q.zoomX !== undefined ? getAdaptiveSubdivisions(q.zoomX) : SUBDIVISIONS_PER_BEAT,
    pitchTargets: pitchSetFor(st)?.notes ?? null,
    projectionTargets,
    guideXTargets,
    guideYTargets,
  };
}

/** snapConfigFor over the live store. */
export function currentSnapConfig(q: SnapQuery = {}): SnapConfig {
  return snapConfigFor(store.getState(), q);
}
