import { describe, it, expect } from 'vitest';
import type { BezierCurve, Composition, Track } from '../types';
import { createLane, createLanePoint } from './lane';
import { createTrack } from './track';
import { findDroppablePass, dropPassCurves, type CommittedPass } from './pass-log';

function curve(id: string): BezierCurve {
  const lane = createLane('pitch');
  lane.points = [createLanePoint(0, 6000), createLanePoint(1, 6100)];
  return { id, lanes: [lane] };
}

function comp(tracks: Track[]): Composition {
  return { tracks } as unknown as Composition;
}

function trackWith(name: string, curveIds: string[]): Track {
  const t = createTrack(name, 'tone-1');
  t.curves = curveIds.map(curve);
  return t;
}

function pass(track: Track, curveIds: string[], createdTrack = true): CommittedPass {
  return { trackId: track.id, curveIds, createdTrack };
}

describe('findDroppablePass', () => {
  it('returns null for an empty log', () => {
    expect(findDroppablePass([], comp([trackWith('Layer 1', ['a'])]))).toBeNull();
  });

  it('returns the newest pass', () => {
    const t1 = trackWith('Layer 1', ['a']);
    const t2 = trackWith('Layer 2', ['b']);
    const log = [pass(t1, ['a']), pass(t2, ['b'])];
    const found = findDroppablePass(log, comp([t1, t2]));
    expect(found?.pass.trackId).toBe(t2.id);
    expect(found?.surviving).toEqual(['b']);
  });

  it('walks past a pass whose curves were all deleted elsewhere', () => {
    const t1 = trackWith('Layer 1', ['a']);
    const t2 = trackWith('Layer 2', []);      // its curve was deleted manually
    const log = [pass(t1, ['a']), pass(t2, ['b'])];
    const found = findDroppablePass(log, comp([t1, t2]));
    expect(found?.pass.trackId).toBe(t1.id);
  });

  it('walks past a pass whose track no longer exists', () => {
    const t1 = trackWith('Layer 1', ['a']);
    const gone = trackWith('Layer 2', ['b']);
    const log = [pass(t1, ['a']), pass(gone, ['b'])];
    const found = findDroppablePass(log, comp([t1]));   // Layer 2 removed
    expect(found?.pass.trackId).toBe(t1.id);
  });

  it('returns only the surviving ids of a partially deleted pass', () => {
    const t = trackWith('Layer 1', ['a', 'c']);        // 'b' was deleted
    const log = [pass(t, ['a', 'b', 'c'])];
    expect(findDroppablePass(log, comp([t]))?.surviving).toEqual(['a', 'c']);
  });

  it('returns null when every entry is stale', () => {
    const t = trackWith('Layer 1', []);
    expect(findDroppablePass([pass(t, ['a'])], comp([t]))).toBeNull();
  });

  it('re-qualifies a pass once its curves come back (Ctrl+Z restore)', () => {
    const t = trackWith('Layer 1', []);
    const log = [pass(t, ['a'])];
    expect(findDroppablePass(log, comp([t]))).toBeNull();
    t.curves = [curve('a')];                            // undo restored it
    expect(findDroppablePass(log, comp([t]))?.surviving).toEqual(['a']);
  });
});

describe('dropPassCurves', () => {
  it('removes the pass curves and reports the count', () => {
    const t = trackWith('Layer 1', ['a', 'b', 'c']);
    const result = dropPassCurves(comp([t]), pass(t, ['a', 'b']), ['a', 'b']);
    expect(result?.curvesRemoved).toBe(2);
    expect(t.curves.map(c => c.id)).toEqual(['c']);
  });

  it('flags removal of a created track it just emptied', () => {
    const t = trackWith('Layer 1', ['a']);
    const result = dropPassCurves(comp([t]), pass(t, ['a'], true), ['a']);
    expect(result?.shouldRemoveTrack).toBe(true);
  });

  it('keeps a track the pass did not create, even when emptied', () => {
    const t = trackWith('Lead', ['a']);
    const result = dropPassCurves(comp([t]), pass(t, ['a'], false), ['a']);
    expect(result?.shouldRemoveTrack).toBe(false);
    expect(t.curves).toEqual([]);
  });

  it('keeps a created track that still holds other curves', () => {
    const t = trackWith('Layer 1', ['a', 'manual']);
    const result = dropPassCurves(comp([t]), pass(t, ['a'], true), ['a']);
    expect(result?.shouldRemoveTrack).toBe(false);
    expect(t.curves.map(c => c.id)).toEqual(['manual']);
  });

  it('returns null when the track is gone', () => {
    const t = trackWith('Layer 1', ['a']);
    expect(dropPassCurves(comp([]), pass(t, ['a']), ['a'])).toBeNull();
  });

  it('supports walking backward through successive drops', () => {
    const t1 = trackWith('Layer 1', ['a']);
    const t2 = trackWith('Layer 2', ['b']);
    const c = comp([t1, t2]);
    const log = [pass(t1, ['a']), pass(t2, ['b'])];

    const first = findDroppablePass(log, c)!;
    dropPassCurves(c, first.pass, first.surviving);
    expect(first.pass.trackId).toBe(t2.id);

    const second = findDroppablePass(log, c)!;
    dropPassCurves(c, second.pass, second.surviving);
    expect(second.pass.trackId).toBe(t1.id);

    expect(findDroppablePass(log, c)).toBeNull();
  });
});
