import { describe, it, expect, beforeEach } from 'vitest';
import { soloActive, trackSounds, createTrack } from './track';
import { createCurve, createControlPoint, addPointToCurve } from './curve';
import { createComposition } from './composition';
import { store } from '../state/store';
import { snapConfigFor } from '../state/snap-config';
import { serializeComposition, deserializeComposition } from '../export/json-export';
import type { Track } from '../types';

/** Guide tracks (BACKLOG 13.10 (a)). */

function curveAt(...pts: Array<[number, number]>) {
  const c = createCurve();
  for (const [x, y] of pts) addPointToCurve(c, createControlPoint(x, y));
  return c;
}
const track = (over: Partial<Track> = {}): Track => ({ ...createTrack('T', 'tone'), ...over });

describe('which tracks sound', () => {
  it('a guide track never does; muted ones don’t; Solo picks the soloed ones', () => {
    const plain = track();
    const guide = track({ guide: true });
    const muted = track({ muted: true });
    expect(trackSounds(plain, [plain, guide, muted])).toBe(true);
    expect(trackSounds(guide, [plain, guide])).toBe(false);
    expect(trackSounds(muted, [muted])).toBe(false);
    const soloed = track({ solo: true });
    expect(trackSounds(plain, [plain, soloed])).toBe(false);
    expect(trackSounds(soloed, [plain, soloed])).toBe(true);
  });

  it('a soloed guide track doesn’t silence the others', () => {
    const plain = track();
    const guide = track({ guide: true, solo: true });
    expect(soloActive([plain, guide])).toBe(false);
    expect(trackSounds(plain, [plain, guide])).toBe(true);
  });
});

describe('pitch guides pull at each beat', () => {
  const guideCurve = curveAt([0, 6000], [4, 6400]);
  guideCurve.id = 'g';
  const sounding = curveAt([0, 7000], [4, 7000]);
  const sources = (over: { guidesVisible?: boolean } = {}) => ({
    ...store.getState(),
    guidesVisible: over.guidesVisible ?? true,
    fretsVisible: true,
    composition: { guides: [], tracks: [track({ curves: [sounding] }), track({ guide: true, curves: [guideCurve] })] },
  });

  it('a guide curve is a target at its pitch at that beat; sounding curves aren’t', () => {
    const at0 = snapConfigFor(sources(), { atBeat: 0 }).guideYTargets!;
    expect(at0).toHaveLength(1);
    expect(at0[0]).toBeCloseTo(6000, 3);
    const mid = snapConfigFor(sources(), { atBeat: 2 }).guideYTargets![0]!;
    expect(mid).toBeGreaterThan(6000);
    expect(mid).toBeLessThan(6400);
    // Off the curve's span, nothing.
    expect(snapConfigFor(sources(), { atBeat: 9 }).guideYTargets).toBeUndefined();
  });

  it('not without a beat, not with Guides off, and not on itself', () => {
    expect(snapConfigFor(sources()).guideYTargets).toBeUndefined();
    expect(snapConfigFor(sources({ guidesVisible: false }), { atBeat: 1 }).guideYTargets).toBeUndefined();
    expect(snapConfigFor(sources(), { atBeat: 1, excludeCurveIds: new Set(['g']) }).guideYTargets).toBeUndefined();
  });
});

describe('the store and the file', () => {
  beforeEach(() => store.loadComposition(createComposition()));

  it('making a track a guide unmutes it and drops its solo; back again leaves it unmuted', () => {
    const t = store.getComposition().tracks[0]!;
    t.muted = true;
    t.solo = true;
    store.setTrackGuide(t.id, true);
    expect(t).toMatchObject({ guide: true, muted: false, solo: false });
    t.muted = true;
    store.setTrackGuide(t.id, false);
    expect(t.guide).toBeUndefined();
    expect(t.muted).toBe(false);
  });

  it('Send to guide track makes a Guides track once, moves whole groups, and keeps you where you were', () => {
    const t = store.getComposition().tracks[0]!;
    const a = curveAt([0, 6000], [1, 6000]);
    const b = curveAt([0, 6400], [1, 6400]);
    a.groupId = b.groupId = 'grp';
    const c = curveAt([2, 6000], [3, 6000]);
    store.mutate(() => t.curves.push(a, b, c));
    store.setSelectedTrack(t.id);
    const guideId = store.sendCurvesToGuideTrack([a.id])!;
    const guides = store.getComposition().tracks.find(tt => tt.id === guideId)!;
    expect(guides).toMatchObject({ name: 'Guides', guide: true });
    expect(guides.curves.map(x => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(t.curves.map(x => x.id)).toEqual([c.id]);
    expect(store.getState().selectedTrackId).toBe(t.id);
    expect(store.sendCurvesToGuideTrack([c.id])).toBe(guideId);
    expect(store.getComposition().tracks.filter(tt => tt.guide)).toHaveLength(1);
  });

  it('a guide track is saved muted for older apps, and loads as a guide, unmuted', () => {
    const comp = createComposition();
    comp.tracks[0]!.guide = true;
    const saved = JSON.parse(serializeComposition(comp));
    expect(saved.composition.tracks[0]).toMatchObject({ guide: true, muted: true });
    const again = deserializeComposition(JSON.stringify(saved));
    expect(again.tracks[0]).toMatchObject({ guide: true, muted: false });
    // Anything but true isn't a guide.
    saved.composition.tracks[0].guide = 'yes';
    expect(deserializeComposition(JSON.stringify(saved)).tracks[0]!.guide).toBeUndefined();
  });
});
