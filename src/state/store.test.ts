import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { createLane, createLanePoint } from '../model/lane';
import type { BezierCurve } from '../types';

function curve(id: string): BezierCurve {
  const lane = createLane('pitch');
  lane.points = [createLanePoint(0, 6000), createLanePoint(1, 6100)];
  return { id, lanes: [lane] };
}

/** Fresh two-track composition: 'keep' stays, 'doomed' gets removed. */
function seed() {
  const comp = createComposition();
  comp.tracks = [];
  const keep = createTrack('Lead', comp.toneLibrary[0]!.id);
  keep.curves = [curve('keep-1')];
  const doomed = createTrack('Layer 1', comp.toneLibrary[0]!.id);
  doomed.curves = [curve('doomed-1'), curve('doomed-2')];
  comp.tracks.push(keep, doomed);
  store.loadComposition(comp);
  return { keep, doomed };
}

describe('store.removeTrack', () => {
  beforeEach(() => { seed(); });

  it('removes the track and its curves', () => {
    const { doomed } = seed();
    store.removeTrack(doomed.id);
    const ids = store.getComposition().tracks.map(t => t.id);
    expect(ids).not.toContain(doomed.id);
    expect(store.getComposition().tracks).toHaveLength(1);
  });

  it('is a no-op for an unknown track id', () => {
    seed();
    store.removeTrack('nope');
    expect(store.getComposition().tracks).toHaveLength(2);
  });

  it('reselects another track when the removed one was selected', () => {
    const { keep, doomed } = seed();
    store.setSelectedTrack(doomed.id);
    store.removeTrack(doomed.id);
    expect(store.getState().selectedTrackId).toBe(keep.id);
    expect(store.getState().selectedCurveIds.size).toBe(0);
  });

  it('leaves selection null when the last track is removed', () => {
    const comp = createComposition();
    comp.tracks = [createTrack('Only', comp.toneLibrary[0]!.id)];
    store.loadComposition(comp);
    store.setSelectedTrack(comp.tracks[0]!.id);
    store.removeTrack(comp.tracks[0]!.id);
    expect(store.getState().selectedTrackId).toBeNull();
  });

  it('drops selected curves that lived on the removed track', () => {
    const { keep, doomed } = seed();
    store.setSelectedTrack(keep.id);
    store.setSelectedCurves(['keep-1', 'doomed-1']);
    store.removeTrack(doomed.id);
    expect([...store.getState().selectedCurveIds]).toEqual(['keep-1']);
  });

  it('disarms MIDI when the armed track is removed', () => {
    const { doomed } = seed();
    store.setMidiArmedTrackId(doomed.id);
    store.removeTrack(doomed.id);
    expect(store.getState().midiArmedTrackId).toBeNull();
  });

  it('leaves a MIDI arm on a different track alone', () => {
    const { keep, doomed } = seed();
    store.setMidiArmedTrackId(keep.id);
    store.removeTrack(doomed.id);
    expect(store.getState().midiArmedTrackId).toBe(keep.id);
  });

  it('clears a Prism projection source that lived on the removed track', () => {
    const { doomed } = seed();
    store.setPrismProjectionSource('doomed-1');
    store.removeTrack(doomed.id);
    expect(store.getState().harmonicPrism.projectionSourceId).toBeNull();
  });

  it('keeps a projection source belonging to a surviving track', () => {
    const { doomed } = seed();
    store.setPrismProjectionSource('keep-1');
    store.removeTrack(doomed.id);
    expect(store.getState().harmonicPrism.projectionSourceId).toBe('keep-1');
  });

  it('drops planchettes bound to the removed track but keeps primary', () => {
    const { doomed } = seed();
    store.addPerformPlanchette({
      voiceId: 'midi-60', trackId: doomed.id,
      cursorWorldY: 6000, snappedWorldY: 6000, lastCrossedAt: 0,
    });
    store.removeTrack(doomed.id);
    const voices = store.getState().performance.planchettes.map(p => p.voiceId);
    expect(voices).toContain('primary');
    expect(voices).not.toContain('midi-60');
  });
});

describe('store.setLayerMode', () => {
  it('toggles layer mode', () => {
    store.setLayerMode(true);
    expect(store.getState().layerModeEnabled).toBe(true);
    store.setLayerMode(false);
    expect(store.getState().layerModeEnabled).toBe(false);
  });
});
