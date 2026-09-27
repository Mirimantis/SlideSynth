import type { AppState, Composition } from '../types';
import type { SnapConfig } from '../utils/snap';
import { getAdaptiveSubdivisions } from '../utils/snap';
import { pitchSetFor, prismOffsets, resolveTuning } from '../tuning/tuning';
import { fretLines, shownGuides } from '../model/frets';
import { computeProjectionTargetsAtX } from '../canvas/projection-renderer';
import { evaluateCurveAtBeat } from '../audio/curve-sampler';
import { trackShown } from '../model/track';
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
  /** Curves being drawn or edited: a pitch guide among them doesn't pull on
   *  itself (13.10). */
  excludeCurveIds?: ReadonlySet<string>;
}

/** The slice of app state a snap config is built from. */
export type SnapSources = Pick<AppState,
  'snapEnabled' | 'tuning' | 'root' | 'scaleId' | 'customScale' | 'tunedFrom' | 'hidePitchLines' | 'guidesVisible' | 'fretsVisible' | 'harmonicPrism'
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

  // User guides (8.7) snap only while visible; frets only while Frets is on (13.22).
  let guideXTargets: readonly number[] | undefined;
  let guideYTargets: readonly number[] | undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  // An octave fret pulls at every one of its lines (13.18).
  const period = resolveTuning(st.tuning).period;
  for (const g of shownGuides(st)) {
    if (g.id === q.excludeGuideId) continue;
    if (g.orientation === 'x') xs.push(g.position);
    else for (const line of fretLines(g, period)) ys.push(line.cents);
  }
  // Pitch guides (13.10): a guide track's curves pull at their pitch at this
  // beat, like frets whose pitch moves. Under the same Guides switch.
  if (q.atBeat !== undefined) {
    for (const track of st.composition.tracks) {
      // Hidden guide tracks, and all of them with Guides off, don't pull.
      if (!track.guide || !trackShown(track, st.guidesVisible)) continue;
      for (const curve of track.curves) {
        if (q.excludeCurveIds?.has(curve.id)) continue;
        const hit = evaluateCurveAtBeat(curve, q.atBeat);
        if (hit) ys.push(hit.noteNumber);
      }
    }
  }
  if (xs.length > 0) guideXTargets = xs;
  if (ys.length > 0) guideYTargets = ys;

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
