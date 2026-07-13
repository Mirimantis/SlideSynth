import { describe, it, expect } from 'vitest';
import { curveFromRecording, pitchPoints, applyTransformToCurve, deepCopyPoints, type RecordedSample } from './curve';
import { getLane, deepCopyLanes } from './lane';

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

describe('applyTransformToCurve — non-pitch lanes stay time-locked', () => {
  // A 4-beat swell: pitch flat at 6000, volume ramps 0 -> 0.8.
  function makeSwell(): ReturnType<typeof curveFromRecording> {
    const samples: RecordedSample[] = [
      { beat: 0, note: 6000, volume: 0 },
      { beat: 4, note: 6000, volume: 0.8 },
    ];
    return curveFromRecording(samples);
  }

  it('translate: shifts the volume lane by the same dx as the pitch lane', () => {
    const curve = makeSwell()!;
    const origPitch = deepCopyPoints(pitchPoints(curve));
    const origNonPitch = deepCopyLanes(curve.lanes.filter(l => l.type !== 'pitch'));
    const bbox = { minX: 0, minY: 6000, maxX: 4, maxY: 6000 };

    // Move the whole curve 4 beats later (dx = 4, dy = 0).
    applyTransformToCurve(curve, origPitch, bbox, 'translate', { x: 0, y: 0 }, { x: 4, y: 0 }, null, origNonPitch);

    expect(pitchPoints(curve)[0]!.position.x).toBe(4);
    expect(pitchPoints(curve)[1]!.position.x).toBe(8);

    const volumeLane = getLane(curve, 'volume')!;
    expect(volumeLane.points[0]!.position.x).toBe(4);
    expect(volumeLane.points[1]!.position.x).toBe(8);
    // Volume values (Y) are untouched by the move.
    expect(volumeLane.points[0]!.position.y).toBeCloseTo(0, 6);
    expect(volumeLane.points[1]!.position.y).toBeCloseTo(0.8, 6);
  });

  it('scale: stretches the volume lane\'s X by the same factor/anchor as the pitch lane, leaving Y untouched', () => {
    const curve = makeSwell()!;
    const origPitch = deepCopyPoints(pitchPoints(curve));
    const origNonPitch = deepCopyLanes(curve.lanes.filter(l => l.type !== 'pitch'));
    const bbox = { minX: 0, minY: 6000, maxX: 4, maxY: 6000 };

    // Drag the right handle to halve the curve's length (4 beats -> 2 beats).
    applyTransformToCurve(curve, origPitch, bbox, 'right', { x: 4, y: 0 }, { x: 2, y: 0 }, null, origNonPitch);

    expect(pitchPoints(curve)[0]!.position.x).toBeCloseTo(0, 6);
    expect(pitchPoints(curve)[1]!.position.x).toBeCloseTo(2, 6);

    const volumeLane = getLane(curve, 'volume')!;
    // The swell should still start and end with the note: same anchor (0) and
    // scale (0.5) as the pitch lane, not left behind at its original beats.
    expect(volumeLane.points[0]!.position.x).toBeCloseTo(0, 6);
    expect(volumeLane.points[1]!.position.x).toBeCloseTo(2, 6);
    expect(volumeLane.points[0]!.position.y).toBeCloseTo(0, 6);
    expect(volumeLane.points[1]!.position.y).toBeCloseTo(0.8, 6);
  });

  it('without an originalNonPitchLanes snapshot, non-pitch lanes are left untouched (backward compatible)', () => {
    const curve = makeSwell()!;
    const origPitch = deepCopyPoints(pitchPoints(curve));
    const bbox = { minX: 0, minY: 6000, maxX: 4, maxY: 6000 };

    applyTransformToCurve(curve, origPitch, bbox, 'translate', { x: 0, y: 0 }, { x: 4, y: 0 });

    const volumeLane = getLane(curve, 'volume')!;
    expect(volumeLane.points[0]!.position.x).toBe(0);
    expect(volumeLane.points[1]!.position.x).toBe(4);
  });
});
