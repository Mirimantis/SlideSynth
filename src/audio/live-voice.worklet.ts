/**
 * AudioWorklet processor for the live voice (BACKLOG 15.7). Runs on the audio
 * thread: receives pitch and gain targets on its port and writes the smoothed
 * control signals (live-voice-dsp.ts) to two mono outputs — 0: frequency in
 * Hz, 1: gain — which live-voice.ts connects to the voice's oscillator
 * frequencies and output gain.
 *
 * Loaded with `?worker&url` so Vite bundles it (and its one import) into a
 * standalone script for audioWorklet.addModule.
 */
import { LIVE_VOICE_PROCESSOR, LiveVoiceState, type LiveVoiceMessage, type LiveVoiceOptions } from './live-voice-dsp';

// AudioWorkletGlobalScope isn't in TypeScript's DOM lib.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions: LiveVoiceOptions }) => AudioWorkletProcessor): void;

class LiveVoiceProcessor extends AudioWorkletProcessor {
  private readonly voice: LiveVoiceState;

  constructor(options: { processorOptions: LiveVoiceOptions }) {
    super(options);
    this.voice = new LiveVoiceState(options.processorOptions, sampleRate);
    this.port.onmessage = (e: MessageEvent<LiveVoiceMessage>) => this.voice.receive(e.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const frequency = outputs[0]?.[0];
    const gain = outputs[1]?.[0];
    if (frequency && gain) this.voice.render(frequency, gain);
    // Returning false lets the node be garbage-collected once released.
    return !this.voice.ended;
  }
}

registerProcessor(LIVE_VOICE_PROCESSOR, LiveVoiceProcessor);
