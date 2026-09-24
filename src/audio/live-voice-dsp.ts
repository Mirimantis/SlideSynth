/**
 * The live voice's control signals, computed per sample (BACKLOG 15.7).
 *
 * The main thread sends pitch and gain *targets* as they arrive: at mouse or
 * frame rate, irregularly spaced. This turns them into smooth audio-rate
 * frequency and gain signals, which drive the voice's native oscillators and
 * output gain directly. The oscillators stay native, so a live note sounds
 * exactly like the same curve in playback and WAV export.
 *
 * Pitch arrives in Hz (the app's centsToFrequency stays the one tuning
 * function) and glides in log-frequency, so a glide is even in cents: an
 * octave up takes as long as an octave down.
 *
 * Pure and dependency-free: the AudioWorklet processor runs it, and the tests
 * run it directly.
 */

/** The AudioWorklet processor's registered name. Kept here, not in the
 *  worklet file, so the main thread can use it without loading that file. */
export const LIVE_VOICE_PROCESSOR = 'live-voice';

/** Messages from the main thread. */
export type LiveVoiceMessage =
  /** Glide toward a pitch. */
  | { type: 'pitch'; hz: number }
  /** Ramp gain linearly to `value` over `seconds`. */
  | { type: 'gain'; value: number; seconds: number }
  /** The voice is done; the processor stops and its node can be collected. */
  | { type: 'end' };

export interface LiveVoiceOptions {
  /** Starting pitch in Hz, so the first sample is already in tune. */
  hz: number;
  /** One-pole time constant for pitch glides, in seconds. */
  pitchGlideSeconds: number;
  /** Fade in from silence to this gain over `fadeInSeconds`, from the first
   *  sample — no wait for a message. */
  gain: number;
  fadeInSeconds: number;
}

export class LiveVoiceState {
  /** log2 of the current and target frequency. */
  private pitch: number;
  private targetPitch: number;
  private readonly pitchCoeff: number;
  private gain = 0;
  private gainTarget = 0;
  /** Gain change per sample while a ramp runs; 0 when settled. */
  private gainStep = 0;
  ended = false;

  constructor(opts: LiveVoiceOptions, private readonly sampleRate: number) {
    this.pitch = this.targetPitch = Math.log2(opts.hz);
    // Per-sample one-pole coefficient: after `tau` seconds the pitch has
    // covered 1 − 1/e of the way to its target, like setTargetAtTime.
    this.pitchCoeff = 1 - Math.exp(-1 / (opts.pitchGlideSeconds * sampleRate));
    this.receive({ type: 'gain', value: opts.gain, seconds: opts.fadeInSeconds });
  }

  receive(msg: LiveVoiceMessage): void {
    switch (msg.type) {
      case 'pitch':
        if (msg.hz > 0) this.targetPitch = Math.log2(msg.hz);
        break;
      case 'gain': {
        this.gainTarget = Math.max(0, Math.min(1, msg.value));
        const samples = Math.max(1, Math.round(msg.seconds * this.sampleRate));
        this.gainStep = (this.gainTarget - this.gain) / samples;
        if (this.gainStep === 0) this.gain = this.gainTarget;
        break;
      }
      case 'end':
        this.ended = true;
        break;
    }
  }

  /** Fill one render quantum: frequency in Hz and gain (0–1) per sample. */
  render(frequency: Float32Array, gain: Float32Array): void {
    const k = this.pitchCoeff;
    for (let i = 0; i < frequency.length; i++) {
      this.pitch += (this.targetPitch - this.pitch) * k;
      frequency[i] = 2 ** this.pitch;

      if (this.gainStep !== 0) {
        this.gain += this.gainStep;
        // Land exactly on the target, whichever side it was approached from.
        if ((this.gainStep > 0 && this.gain >= this.gainTarget) || (this.gainStep < 0 && this.gain <= this.gainTarget)) {
          this.gain = this.gainTarget;
          this.gainStep = 0;
        }
      }
      gain[i] = this.gain;
    }
  }
}
