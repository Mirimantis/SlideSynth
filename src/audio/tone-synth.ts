import type { ToneDefinition, DistortionConfig } from '../types';
import { getAudioContext } from './engine';

export interface ToneSynth {
  /** Set pitch in Hz. Takes effect immediately or at scheduled time. */
  setFrequency(hz: number, time?: number): void;
  /** Set volume 0–1. Ramps linearly to avoid clicks. */
  setVolume(v: number, time?: number): void;
  /** Connect output to a destination node. */
  connect(dest: AudioNode): void;
  /** Start all oscillators. Call once. */
  start(time?: number): void;
  /** Stop and dispose all nodes. */
  stop(time?: number): void;
}

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 44100;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  const k = amount * 100;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function createDistortion(ctx: AudioContext, config: DistortionConfig): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(config.amount);
  shaper.oversample = config.oversample;
  return shaper;
}

/**
 * Build a synthesis graph from a ToneDefinition.
 * Multiple oscillator layers are mixed through individual gain nodes,
 * then optionally through a distortion waveshaper, into a final output gain.
 */
export function createToneSynth(tone: ToneDefinition): ToneSynth {
  const ctx = getAudioContext();

  // Output gain (volume envelope)
  const outputGain = ctx.createGain();
  outputGain.gain.value = 0;

  // Optional distortion
  let distortionNode: WaveShaperNode | null = null;
  const preDistNode: AudioNode = (() => {
    if (tone.distortion) {
      distortionNode = createDistortion(ctx, tone.distortion);
      distortionNode.connect(outputGain);
      return distortionNode;
    }
    return outputGain;
  })();

  // Layer mix node — all oscillators sum into this
  const mixGain = ctx.createGain();
  mixGain.gain.value = 1;
  mixGain.connect(preDistNode);

  // Build oscillator layers
  const oscillators: OscillatorNode[] = [];
  const layerGains: GainNode[] = [];

  for (const layer of tone.layers) {
    const osc = ctx.createOscillator();
    osc.type = layer.type;
    osc.detune.value = layer.detune;

    const gain = ctx.createGain();
    gain.gain.value = layer.gain;

    osc.connect(gain);
    gain.connect(mixGain);

    oscillators.push(osc);
    layerGains.push(gain);
  }

  return {
    setFrequency(hz: number, time?: number) {
      const t = time ?? ctx.currentTime;
      for (const osc of oscillators) {
        osc.frequency.setValueAtTime(hz, t);
      }
    },

    setVolume(v: number, time?: number) {
      const t = time ?? ctx.currentTime;
      outputGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), t);
    },

    connect(dest: AudioNode) {
      outputGain.connect(dest);
    },

    start(time?: number) {
      const t = time ?? ctx.currentTime;
      for (const osc of oscillators) {
        osc.start(t);
      }
    },

    stop(time?: number) {
      const t = time ?? ctx.currentTime;
      for (const osc of oscillators) {
        osc.stop(t);
      }
    },
  };
}
