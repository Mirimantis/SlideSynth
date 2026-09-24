import { describe, it, expect } from 'vitest';
import { LiveVoiceState } from './live-voice-dsp';

const SR = 48000;
const QUANTUM = 128;

function voice(hz = 440, extra: Partial<{ gain: number; fadeInSeconds: number; pitchGlideSeconds: number }> = {}) {
  return new LiveVoiceState({ hz, pitchGlideSeconds: 0.008, gain: 0, fadeInSeconds: 0.01, ...extra }, SR);
}

/** Render `seconds` of control signal; returns the last quantum's buffers and
 *  every frequency sample rendered. */
function run(v: LiveVoiceState, seconds: number) {
  const freq = new Float32Array(QUANTUM);
  const gain = new Float32Array(QUANTUM);
  const allFreq: number[] = [];
  const allGain: number[] = [];
  for (let n = 0; n < Math.ceil((seconds * SR) / QUANTUM); n++) {
    v.render(freq, gain);
    allFreq.push(...freq);
    allGain.push(...gain);
  }
  return { freq: allFreq, gain: allGain };
}

const cents = (hz: number, ref: number) => 1200 * Math.log2(hz / ref);
const last = (xs: number[]) => xs[xs.length - 1]!;

describe('live voice control signals (BACKLOG 15.7)', () => {
  it('starts in tune and fades in from silence on the first samples', () => {
    const { freq, gain } = run(voice(440, { gain: 0.6, fadeInSeconds: 0.01 }), 0.02);
    expect(freq[0]).toBeCloseTo(440, 3);
    expect(gain[0]).toBeGreaterThan(0);
    expect(gain[0]).toBeLessThan(0.01);
    // 10 ms fade = 480 samples, then it holds.
    expect(gain[479]).toBeCloseTo(0.6, 5);
    expect(last(gain)).toBeCloseTo(0.6, 5);
  });

  it('glides in log-frequency: no step, most of the way after one time constant', () => {
    const v = voice(440);
    run(v, 0.01);
    v.receive({ type: 'pitch', hz: 880 });
    const { freq } = run(v, 0.1);
    // Continuous: no sample jumps by more than a few cents.
    let maxStep = 0;
    for (let i = 1; i < freq.length; i++) maxStep = Math.max(maxStep, Math.abs(cents(freq[i]!, freq[i - 1]!)));
    expect(maxStep).toBeLessThan(5);
    // After tau (8 ms = 384 samples) it has covered 1 − 1/e of the octave, in cents.
    expect(cents(freq[383]!, 440)).toBeCloseTo(1200 * (1 - Math.exp(-1)), 0);
    // And it settles on the target.
    expect(last(freq)).toBeCloseTo(880, 1);
  });

  it('glides up and down an octave in the same time (even in cents)', () => {
    const up = voice(440); up.receive({ type: 'pitch', hz: 880 });
    const down = voice(880); down.receive({ type: 'pitch', hz: 440 });
    const u = last(run(up, 0.004).freq);
    const d = last(run(down, 0.004).freq);
    expect(cents(u, 440)).toBeCloseTo(-cents(d, 880), 3);
  });

  it('ramps gain linearly to a target and lands on it exactly, in either direction', () => {
    const v = voice(440, { gain: 0.8, fadeInSeconds: 0.001 });
    run(v, 0.01);
    v.receive({ type: 'gain', value: 0.2, seconds: 0.02 });
    const { gain } = run(v, 0.03);
    expect(gain[479]).toBeCloseTo(0.5, 2); // halfway through the 960-sample ramp
    expect(last(gain)).toBe(Math.fround(0.2));
    v.receive({ type: 'gain', value: 5, seconds: 0.001 }); // clamped to 1
    expect(last(run(v, 0.01).gain)).toBe(1);
  });

  it('ignores a non-positive pitch, and reports when it has ended', () => {
    const v = voice(440);
    v.receive({ type: 'pitch', hz: 0 });
    expect(last(run(v, 0.01).freq)).toBeCloseTo(440, 3);
    expect(v.ended).toBe(false);
    v.receive({ type: 'end' });
    expect(v.ended).toBe(true);
  });
});
