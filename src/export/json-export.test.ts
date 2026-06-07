import { describe, it, expect } from 'vitest';
import { deserializeComposition } from './json-export';
import { evaluateParamAtBeat } from '../model/param-curve';

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

describe('v2 → v3 volume migration', () => {
  const pts = [
    { x: 0, y: 60, volume: 0.2 },
    { x: 2, y: 62, volume: 0.6 },
    { x: 4, y: 64, volume: 1.0 },
  ];

  it('bumps version to 3', () => {
    const comp = deserializeComposition(v2Json(pts));
    expect(comp.version).toBeGreaterThanOrEqual(3);
  });

  it('strips per-point volume and builds a parameters.volume lane', () => {
    const comp = deserializeComposition(v2Json(pts));
    const curve = comp.tracks[0]!.curves[0]!;
    // No point retains a volume field
    for (const p of curve.points as Array<{ volume?: number }>) {
      expect(p.volume).toBeUndefined();
    }
    // Lane mirrors the old per-point volumes at the same beats
    const lane = curve.parameters!.volume!;
    expect(lane.points.map(p => p.position.x)).toEqual([0, 2, 4]);
    expect(lane.points.map(p => p.position.y)).toEqual([0.2, 0.6, 1.0]);
    // Straight segments (null handles) → identical to old piecewise-linear sampling
    expect(lane.points.every(p => p.handleIn === null && p.handleOut === null)).toBe(true);
  });

  it('migrated sampling matches the old linear interpolation', () => {
    const comp = deserializeComposition(v2Json(pts));
    const lane = comp.tracks[0]!.curves[0]!.parameters!.volume!;
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
      expect(evaluateParamAtBeat(lane, beat)).toBeCloseTo(oldInterp(beat), 4);
    }
  });

  it('is idempotent — re-deserializing a v3 result keeps the lane', () => {
    const once = deserializeComposition(v2Json(pts));
    const twice = deserializeComposition(JSON.stringify(once));
    const lane = twice.tracks[0]!.curves[0]!.parameters!.volume!;
    expect(lane.points.map(p => p.position.y)).toEqual([0.2, 0.6, 1.0]);
  });
});
