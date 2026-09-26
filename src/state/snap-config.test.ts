import { describe, it, expect } from 'vitest';
import { snapConfigFor, type SnapSources } from './snap-config';
import { createCurve, createControlPoint, addPointToCurve } from '../model/curve';
import { DEFAULT_CHORD_SPEC } from '../utils/harmonics';
import { SUBDIVISIONS_PER_BEAT } from '../constants';
import { getAdaptiveSubdivisions } from '../utils/snap';
import type { GuideDefinition } from '../types';

function flatCurve(id: string, fromBeat: number, toBeat: number, cents: number) {
  const c = createCurve();
  c.id = id;
  addPointToCurve(c, createControlPoint(fromBeat, cents));
  addPointToCurve(c, createControlPoint(toBeat, cents));
  return c;
}

function guide(id: string, orientation: 'x' | 'y', position: number): GuideDefinition {
  return { id, orientation, position } as GuideDefinition;
}

function sources(over: Partial<SnapSources> = {}): SnapSources {
  return {
    snapEnabled: true,
    tuning: { kind: 'edo', divisions: 12, equave: 'octave' },
    root: 0,
    scaleId: 'all',
    customScale: null,
    tunedFrom: 0,
    hidePitchLines: false,
    guidesVisible: true,
    harmonicPrism: {
      chordSpec: DEFAULT_CHORD_SPEC,
      projectionOctaveRange: 0,
      activeMode: null,
      projectionSourceId: null,
      drawMode: false,
    },
    composition: { tracks: [], guides: [] },
    ...over,
  };
}

describe('snapConfigFor (BACKLOG 15.6)', () => {
  it('uses the adaptive beat grid for a zoom, and the finest grid without one', () => {
    expect(snapConfigFor(sources()).subdivisionsPerBeat).toBe(SUBDIVISIONS_PER_BEAT);
    expect(snapConfigFor(sources(), { zoomX: 20 }).subdivisionsPerBeat).toBe(getAdaptiveSubdivisions(20));
  });

  it('splits visible guides by axis, and leaves out the one being dragged', () => {
    const composition = {
      tracks: [],
      guides: [guide('g1', 'x', 4), guide('g2', 'y', 6000), guide('g3', 'y', 6700)],
    };
    const cfg = snapConfigFor(sources({ composition }));
    expect(cfg.guideXTargets).toEqual([4]);
    expect(cfg.guideYTargets).toEqual([6000, 6700]);

    const dragging = snapConfigFor(sources({ composition }), { excludeGuideId: 'g2' });
    expect(dragging.guideYTargets).toEqual([6700]);

    const hidden = snapConfigFor(sources({ composition, guidesVisible: false }));
    expect(hidden.guideXTargets).toBeUndefined();
    expect(hidden.guideYTargets).toBeUndefined();
  });

  it('samples Prism projection echoes at the given beat, and only when one is given', () => {
    const src = flatCurve('src', 0, 4, 6000);
    const st = sources({
      composition: { tracks: [{ curves: [src] } as never], guides: [] },
      harmonicPrism: { ...sources().harmonicPrism, projectionSourceId: 'src', activeMode: 'projection' },
    });
    expect(snapConfigFor(st, { atBeat: 2 }).projectionTargets).toContain(6000);
    // X-only callers (ruler scrub, scissors) pass no beat and get no echoes.
    expect(snapConfigFor(st).projectionTargets).toBeUndefined();
    // Off the source curve there is nothing to echo.
    expect(snapConfigFor(st, { atBeat: 9 }).projectionTargets).toEqual([]);
  });

  it('ignores a projection source that no longer exists', () => {
    const st = sources({
      harmonicPrism: { ...sources().harmonicPrism, projectionSourceId: 'gone' },
    });
    expect(snapConfigFor(st, { atBeat: 1 }).projectionTargets).toBeUndefined();
  });
});
