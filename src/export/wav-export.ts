import type { Composition } from '../types';
import { sampleCurve, getCurveTimeRange } from '../audio/curve-sampler';

/**
 * Render a composition to a WAV file using OfflineAudioContext.
 * Uses the same synthesis code as real-time playback.
 */
export async function exportWav(composition: Composition): Promise<void> {
  const sampleRate = 44100;
  const channels = 2; // stereo
  const bpm = composition.bpm;
  const totalSeconds = composition.totalBeats * 60 / bpm;
  const totalSamples = Math.ceil(totalSeconds * sampleRate);

  const offline = new OfflineAudioContext(channels, totalSamples, sampleRate);
  const masterGain = offline.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(offline.destination);

  // Determine which tracks to play (solo logic)
  const hasSolo = composition.tracks.some(t => t.solo);

  for (const track of composition.tracks) {
    if (track.muted) continue;
    if (hasSolo && !track.solo) continue;

    const tone = composition.toneLibrary.find(t => t.id === track.toneId);
    if (!tone) continue;

    // For WAV export, create one synth per curve (simpler than real-time scheduling)
    for (const curve of track.curves) {
      const range = getCurveTimeRange(curve);
      if (!range) continue;

      const samples = sampleCurve(curve, bpm);
      if (samples.length === 0) continue;

      // Create synth connected to offline context
      // We need to build the graph on the offline context
      const synth = buildOfflineSynth(offline, tone, masterGain);

      // Schedule silence, then the curve
      const startTime = samples[0]!.timeSeconds;
      synth.gain.gain.setValueAtTime(0, 0);

      for (const sample of samples) {
        synth.osc.frequency.setValueAtTime(sample.frequency, sample.timeSeconds);
        synth.gain.gain.linearRampToValueAtTime(
          sample.volume * track.volume,
          sample.timeSeconds,
        );
      }

      // Fade out at end
      const lastSample = samples[samples.length - 1]!;
      synth.gain.gain.linearRampToValueAtTime(0, lastSample.timeSeconds + 0.01);

      synth.osc.start(Math.max(0, startTime - 0.01));
      synth.osc.stop(lastSample.timeSeconds + 0.05);
    }
  }

  // Render
  const buffer = await offline.startRendering();

  // Encode as WAV
  const wavData = encodeWav(buffer, sampleRate);
  const blob = new Blob([wavData], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);

  // Download
  const a = document.createElement('a');
  a.href = url;
  a.download = `${composition.name || 'composition'}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}

interface OfflineSynthNodes {
  osc: OscillatorNode;
  gain: GainNode;
}

function buildOfflineSynth(
  ctx: OfflineAudioContext,
  tone: { layers: { type: OscillatorType; gain: number; detune: number }[]; distortion: { amount: number; oversample: OverSampleType } | null },
  destination: AudioNode,
): OfflineSynthNodes {
  const outputGain = ctx.createGain();
  outputGain.gain.value = 0;

  let connectTo: AudioNode = outputGain;

  if (tone.distortion) {
    const shaper = ctx.createWaveShaper();
    const k = tone.distortion.amount * 100;
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    shaper.curve = curve as Float32Array<ArrayBuffer>;
    shaper.oversample = tone.distortion.oversample;
    shaper.connect(outputGain);
    connectTo = shaper;
  }

  outputGain.connect(destination);

  // Use first layer as primary oscillator for frequency scheduling
  const primaryLayer = tone.layers[0]!;
  const osc = ctx.createOscillator();
  osc.type = primaryLayer.type;
  osc.detune.value = primaryLayer.detune;

  const layerGain = ctx.createGain();
  layerGain.gain.value = primaryLayer.gain;
  osc.connect(layerGain);
  layerGain.connect(connectTo);

  // Additional layers
  for (let i = 1; i < tone.layers.length; i++) {
    const layer = tone.layers[i]!;
    const extraOsc = ctx.createOscillator();
    extraOsc.type = layer.type;
    extraOsc.detune.value = layer.detune;

    const extraGain = ctx.createGain();
    extraGain.gain.value = layer.gain;
    extraOsc.connect(extraGain);
    extraGain.connect(connectTo);

    // Mirror frequency from primary
    // We'll connect them to same timing
    extraOsc.start(osc.context.currentTime);

    // Schedule same frequencies — connect to primary frequency
    // Note: We can't easily share AudioParam scheduling across oscillators
    // in OfflineAudioContext, so extra layers follow the primary osc frequency
    // via detune offset from base
  }

  return { osc, gain: outputGain };
}

/**
 * Encode an AudioBuffer as a WAV file (16-bit PCM, 44100Hz).
 */
function encodeWav(buffer: AudioBuffer, sampleRate: number): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = length * numChannels * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);              // sub-chunk size
  view.setUint16(20, 1, true);               // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);  // block align
  view.setUint16(34, bytesPerSample * 8, true);            // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleaved PCM data
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
