import { describe, it, expect } from 'vitest';
import { curveFromRecording, pitchPoints, type RecordedSample } from './curve';
import { getLane } from './lane';

describe('curveFromRecording — volume lane density', () => {
  it('collapses volume to exactly 2 points (start/end), independent of pitch point count', () => {
    // A gliding gesture: pitch moves continuously (RDP keeps several points),
    // volume stays constant. Recording used to mirror the pitch curve's point
    // density onto the volume lane, making a flat volume look as busy as the
    // glissando. It should only ever carry the start/end of the gesture.
    const samples: RecordedSample[] = [];
    for (let i = 0; i <= 20; i++) {
      // A wobbling (non-linear) pitch path so RDP keeps interior points.
      samples.push({ beat: i * 0.1, note: 6000 + Math.round(Math.sin(i) * 300), volume: 0.8 });
    }
    const curve = curveFromRecording(samples)!;
    expect(curve).not.toBeNull();
    expect(pitchPoints(curve).length).toBeGreaterThan(2); // pitch keeps its shape

    const volumeLane = getLane(curve, 'volume')!;
    expect(volumeLane.points).toHaveLength(2);
    expect(volumeLane.points[0]!.position.x).toBe(pitchPoints(curve)[0]!.position.x);
    expect(volumeLane.points[1]!.position.x).toBe(pitchPoints(curve)[pitchPoints(curve).length - 1]!.position.x);
    expect(volumeLane.points[0]!.position.y).toBeCloseTo(0.8, 6);
    expect(volumeLane.points[1]!.position.y).toBeCloseTo(0.8, 6);
  });

  it('keeps distinct start/end volume values when they differ (no averaging)', () => {
    const samples: RecordedSample[] = [
      { beat: 0, note: 6000, volume: 0.9 },
      { beat: 0.5, note: 6100, volume: 0.5 },
      { beat: 1, note: 6000, volume: 0.2 },
    ];
    const curve = curveFromRecording(samples)!;
    const volumeLane = getLane(curve, 'volume')!;
    expect(volumeLane.points).toHaveLength(2);
    expect(volumeLane.points[0]!.position.y).toBeCloseTo(0.9, 6);
    expect(volumeLane.points[1]!.position.y).toBeCloseTo(0.2, 6);
  });

  it('clamps volume to [0,1]', () => {
    const samples: RecordedSample[] = [
      { beat: 0, note: 6000, volume: 1.4 },
      { beat: 1, note: 6000, volume: -0.3 },
    ];
    const curve = curveFromRecording(samples)!;
    const volumeLane = getLane(curve, 'volume')!;
    expect(volumeLane.points[0]!.position.y).toBe(1);
    expect(volumeLane.points[1]!.position.y).toBe(0);
  });
});
