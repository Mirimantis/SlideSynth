import { describe, it, expect } from 'vitest';
import {
  deserializeComposition, serializeComposition, GLISS_APP_ID, GLISS_FORMAT_VERSION,
} from './json-export';
import { evaluateLaneAtBeat, getLane } from '../model/lane';
import { pitchPoints } from '../model/curve';
import v3Fixture from './__fixtures__/composition-v3.json';

/** Build a minimal v2 composition JSON whose points still carry per-point `volume`. */
function v2Json(pointVolumes: Array<{ x: number; y: number; volume: number }>): string {
  return JSON.stringify({
    version: 2,
    name: 'legacy',
    bpm: 120,
    beatsPerMeasure: 4,
    timeSignatureDenominator: 4,
    toneLibrary: [{ id: 't1', name: 'T', color: '#fff', dashPattern: [], layers: [], distortion: null }],
    tracks: [{
      id: 'tr1', name: 'Track 1', toneId: 't1', muted: false, solo: false, volume: 1,
      curves: [{
        id: 'c1',
        points: pointVolumes.map(p => ({
          position: { x: p.x, y: p.y },
          handleIn: null,
          handleOut: null,
          volume: p.volume,
        })),
      }],
    }],
  });
}

describe('legacy volume migration (v2 → lanes)', () => {
  const pts = [
    { x: 0, y: 60, volume: 0.2 },
    { x: 2, y: 62, volume: 0.6 },
    { x: 4, y: 64, volume: 1.0 },
  ];

  it('bumps version to the current lanes version', () => {
    const comp = deserializeComposition(v2Json(pts));
    expect(comp.version).toBeGreaterThanOrEqual(4);
  });

  it('builds a pitch lane and a volume lane; strips per-point volume', () => {
    const comp = deserializeComposition(v2Json(pts));
    const curve = comp.tracks[0]!.curves[0]!;
    // lanes[0] is the pitch lane with the original points
    expect(curve.lanes[0]!.type).toBe('pitch');
    expect(pitchPoints(curve).map(p => p.position.y)).toEqual([6000, 6200, 6400]); // cents
    // No pitch point retains a volume field
    for (const p of pitchPoints(curve) as Array<{ volume?: number }>) {
      expect(p.volume).toBeUndefined();
    }
    // Volume lane mirrors the old per-point volumes at the same beats
    const lane = getLane(curve, 'volume')!;
    expect(lane.points.map(p => p.position.x)).toEqual([0, 2, 4]);
    expect(lane.points.map(p => p.position.y)).toEqual([0.2, 0.6, 1.0]);
    // Straight segments (null handles) → identical to old piecewise-linear sampling
    expect(lane.points.every(p => p.handleIn === null && p.handleOut === null)).toBe(true);
  });

  it('migrated sampling matches the old linear interpolation', () => {
    const comp = deserializeComposition(v2Json(pts));
    const lane = getLane(comp.tracks[0]!.curves[0]!, 'volume')!;
    // Old behavior: linear interp between consecutive point volumes.
    const oldInterp = (beat: number): number => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        if (beat >= a.x && beat <= b.x) {
          const t = (beat - a.x) / (b.x - a.x);
          return a.volume + (b.volume - a.volume) * t;
        }
      }
      return beat < pts[0]!.x ? pts[0]!.volume : pts[pts.length - 1]!.volume;
    };
    for (const beat of [0, 0.5, 1, 2, 3, 3.7, 4]) {
      expect(evaluateLaneAtBeat(lane, beat)).toBeCloseTo(oldInterp(beat), 4);
    }
  });

  it('is idempotent — re-deserializing a migrated result keeps the lanes', () => {
    const once = deserializeComposition(v2Json(pts));
    const twice = deserializeComposition(JSON.stringify(once));
    const lane = getLane(twice.tracks[0]!.curves[0]!, 'volume')!;
    expect(lane.points.map(p => p.position.y)).toEqual([0.2, 0.6, 1.0]);
    expect(pitchPoints(twice.tracks[0]!.curves[0]!).map(p => p.position.y)).toEqual([6000, 6200, 6400]);
  });
});

describe('.gliss envelope', () => {
  const loadFixture = () => deserializeComposition(JSON.stringify(v3Fixture));

  it('serializes to the envelope shape with lifted meta/tuning/snap sections', () => {
    const comp = loadFixture();
    const env = JSON.parse(serializeComposition(comp));
    expect(env.app).toBe(GLISS_APP_ID);
    expect(env.formatVersion).toBe(GLISS_FORMAT_VERSION);
    expect(env.kind).toBe('composition');
    expect(env.meta.name).toBe('Fixture v3');
    expect(env.tuning.referenceOffsetCents).toBe(25);
    expect(env.snap.settings.scaleId).toBe('dorian');
    expect(env.snap.guides.map((g: { id: string }) => g.id)).toEqual(['guide-x1', 'guide-y1']);
    // Lifted fields don't also appear inside the composition core.
    expect(env.composition.name).toBeUndefined();
    expect(env.composition.snap).toBeUndefined();
    expect(env.composition.guides).toBeUndefined();
    expect(env.composition.tuningOffsetCents).toBeUndefined();
    expect(env.composition.tracks).toHaveLength(2);
  });

  it('round-trips: load → save → load is deep-equal', () => {
    const comp = loadFixture();
    const again = deserializeComposition(serializeComposition(comp));
    expect(again).toEqual(comp);
  });

  it('preserves unknown lane types and gravity blobs across a round-trip', () => {
    const comp = loadFixture();
    const curve = comp.tracks[0]!.curves[0]!;
    // Simulate a future host writing extra lane data this app doesn't know.
    (curve.lanes[0] as { gravity?: unknown }).gravity = { wells: [{ target: 6900, strength: 0.5 }] };
    (curve.lanes as unknown[]).push({
      type: 'wobble', unit: 'normalized', range: [0, 1],
      points: [{ position: { x: 1, y: 0.5 }, handleIn: null, handleOut: null }],
    });
    const again = deserializeComposition(serializeComposition(comp));
    const againCurve = again.tracks[0]!.curves[0]!;
    expect((againCurve.lanes[0] as { gravity?: unknown }).gravity)
      .toEqual({ wells: [{ target: 6900, strength: 0.5 }] });
    expect((againCurve.lanes as Array<{ type: string }>).some(l => l.type === 'wobble')).toBe(true);
  });

  it('rejects a newer formatVersion with a clear error', () => {
    const comp = loadFixture();
    const env = JSON.parse(serializeComposition(comp));
    env.formatVersion = 999;
    expect(() => deserializeComposition(JSON.stringify(env))).toThrow(/format version 999/);
  });

  it('still accepts legacy flat JSON (no envelope)', () => {
    const comp = loadFixture(); // v3 fixture is flat legacy JSON
    expect(comp.tracks).toHaveLength(2);
    expect(pitchPoints(comp.tracks[0]!.curves[0]!)[0]!.position.y).toBe(6000);
    // Legacy y-guide scaled to cents exactly once.
    expect(comp.guides.find(g => g.id === 'guide-y1')!.position).toBe(6450);
  });
});
