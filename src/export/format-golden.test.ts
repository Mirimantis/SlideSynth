import { describe, it, expect } from 'vitest';
import { deserializeComposition } from './json-export';
import { sampleCurve } from '../audio/curve-sampler';
import v1 from './__fixtures__/composition-v1.json';
import v2 from './__fixtures__/composition-v2.json';
import v3 from './__fixtures__/composition-v3.json';

/**
 * GOLDEN TEST — do not update these snapshots during the cents/lanes refactor.
 *
 * Loads legacy fixture files and snapshots the *audible* output of every
 * curve: sampled (timeSeconds, frequency, volume) tuples. Frequencies and
 * seconds are pitch-unit-independent, so the exact same snapshot must pass
 * before and after the internal pitch representation changes (MIDI-note Y →
 * cents Y, points/parameters → lanes). A snapshot mismatch here means the
 * refactor changed what the user hears — a real regression, not test churn.
 *
 * Values are rounded to absorb floating-point ulp drift from the ×100/÷100
 * unit conversion; anything beyond that tolerance is a genuine difference.
 */

/** Round to guard against float ulp drift while catching real regressions. */
function rounded(samples: Array<{ timeSeconds: number; frequency: number; volume: number }>) {
  return samples.map(s => ({
    t: Number(s.timeSeconds.toFixed(6)),
    hz: Number(s.frequency.toFixed(4)),
    vol: Number(s.volume.toFixed(6)),
  }));
}

function audibleOutput(json: string) {
  const comp = deserializeComposition(json);
  const out: Record<string, ReturnType<typeof rounded>> = {};
  for (const track of comp.tracks) {
    for (const curve of track.curves) {
      out[curve.id] = rounded(sampleCurve(curve, comp.bpm));
    }
  }
  return { bpm: comp.bpm, curves: out };
}

describe('golden audible output across format migrations', () => {
  it('v1 fixture sampled output is stable', () => {
    expect(audibleOutput(JSON.stringify(v1))).toMatchSnapshot();
  });

  it('v2 fixture sampled output is stable', () => {
    expect(audibleOutput(JSON.stringify(v2))).toMatchSnapshot();
  });

  it('v3 fixture sampled output is stable', () => {
    expect(audibleOutput(JSON.stringify(v3))).toMatchSnapshot();
  });

  it('v3 fixture preserves structural metadata', () => {
    const comp = deserializeComposition(JSON.stringify(v3));
    // Unit-independent structure that every future format version must keep.
    expect(comp.name).toBe('Fixture v3');
    expect(comp.bpm).toBe(90);
    expect(comp.beatsPerMeasure).toBe(3);
    expect(comp.timeSignatureDenominator).toBe(4);
    expect(comp.loopStartBeats).toBe(1);
    expect(comp.loopEndBeats).toBe(7);
    expect(comp.tuningOffsetCents).toBe(25);
    expect(comp.snap.enabled).toBe(true);
    expect(comp.snap.scaleRoot).toBe(2);
    expect(comp.snap.scaleId).toBe('dorian');
    expect(comp.snap.magneticStrength).toBe(0.7);
    expect(comp.snap.magneticSpringK).toBe(12);
    expect(comp.snap.magneticDamping).toBe(3.5);
    expect(comp.guides.map(g => g.id)).toEqual(['guide-x1', 'guide-y1']);
    expect(comp.tracks.map(t => t.id)).toEqual(['track-lead', 'track-chord']);
    const chord = comp.tracks[1]!;
    expect(chord.curves.map(c => c.groupId)).toEqual(['grp-1', 'grp-1']);
    expect(chord.curves.map(c => c.voiceIndex)).toEqual([0, 1]);
  });

  it('v1 fixture migrates chordGroupId to groupId', () => {
    const comp = deserializeComposition(JSON.stringify(v1));
    expect(comp.tracks[0]!.curves.map(c => c.groupId)).toEqual(['legacy-grp', 'legacy-grp']);
  });
});
