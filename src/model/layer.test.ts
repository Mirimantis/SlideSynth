import { describe, it, expect } from 'vitest';
import type { Track } from '../types';
import { createTrack } from './track';
import {
  nextLayerName, canOpenLayer, createLayerTrack, newestLayerTrack, LAYER_TRACK_LIMIT,
} from './layer';

function track(name: string, toneId = 'tone-1', volume = 0.8): Track {
  const t = createTrack(name, toneId);
  t.volume = volume;
  return t;
}

describe('nextLayerName', () => {
  it('starts at Layer 1 on an empty composition', () => {
    expect(nextLayerName([])).toBe('Layer 1');
  });

  it('ignores tracks that are not layers', () => {
    expect(nextLayerName([track('Track 1'), track('Bass')])).toBe('Layer 1');
  });

  it('counts one past the highest existing layer', () => {
    expect(nextLayerName([track('Layer 1'), track('Layer 2')])).toBe('Layer 3');
  });

  it('does not reuse a name after a middle layer is deleted', () => {
    // Layer 2 was dropped (10.4); reusing "Layer 2" would duplicate on re-add.
    expect(nextLayerName([track('Layer 1'), track('Layer 3')])).toBe('Layer 4');
  });

  it('handles multi-digit layer numbers', () => {
    expect(nextLayerName([track('Layer 9'), track('Layer 12')])).toBe('Layer 13');
  });

  it('ignores names that merely contain "Layer"', () => {
    expect(nextLayerName([track('Layer'), track('Layer 2 lead'), track('My Layer 7')]))
      .toBe('Layer 1');
  });
});

describe('canOpenLayer', () => {
  it('allows layers below the limit', () => {
    expect(canOpenLayer(Array.from({ length: LAYER_TRACK_LIMIT - 1 }, (_, i) => track(`Layer ${i + 1}`))))
      .toBe(true);
  });

  it('refuses at exactly the limit', () => {
    expect(canOpenLayer(Array.from({ length: LAYER_TRACK_LIMIT }, (_, i) => track(`Layer ${i + 1}`))))
      .toBe(false);
  });

  it('counts all tracks, not just layers', () => {
    const tracks = Array.from({ length: LAYER_TRACK_LIMIT }, (_, i) => track(`Track ${i + 1}`));
    expect(canOpenLayer(tracks)).toBe(false);
  });
});

describe('createLayerTrack', () => {
  it('inherits the source tone and volume', () => {
    const source = track('Lead', 'tone-warm', 0.42);
    const layer = createLayerTrack(source, [source]);
    expect(layer.toneId).toBe('tone-warm');
    expect(layer.volume).toBeCloseTo(0.42);
  });

  it('starts audible and empty with a distinct id', () => {
    const source = track('Lead');
    const layer = createLayerTrack(source, [source]);
    expect(layer.muted).toBe(false);
    expect(layer.solo).toBe(false);
    expect(layer.curves).toEqual([]);
    expect(layer.id).not.toBe(source.id);
  });

  it('names itself from the existing tracks', () => {
    const source = track('Lead');
    const existing = [source, track('Layer 1')];
    expect(createLayerTrack(source, existing).name).toBe('Layer 2');
  });
});

describe('newestLayerTrack', () => {
  it('returns the last layer in track order', () => {
    const tracks = [track('Layer 1'), track('Lead'), track('Layer 2')];
    expect(newestLayerTrack(tracks)?.name).toBe('Layer 2');
  });

  it('returns null when no layers exist', () => {
    expect(newestLayerTrack([track('Lead')])).toBeNull();
  });
});
