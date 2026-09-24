import type { ToneDefinition } from '../types';
import { getAudioContext, onAudioContextCreated } from './engine';
import { createToneGraph, createToneSynth } from './tone-synth';
import { LIVE_VOICE_PROCESSOR, type LiveVoiceMessage, type LiveVoiceOptions } from './live-voice-dsp';
import workletUrl from './live-voice.worklet.ts?worker&url';

/**
 * Live voices (BACKLOG 15.7): what sounds while you perform, preview, play a
 * Prism chord or a MIDI note. Pitch and gain targets arrive at mouse or frame
 * rate; an AudioWorklet smooths them per sample on the audio thread and drives
 * the tone's native oscillators and output gain directly, so there's no
 * automation timeline and no 60 Hz staircase.
 *
 * If the worklet can't load (no AudioWorklet in an insecure context, or not
 * loaded yet on the very first note), the voice falls back to main-thread
 * glides with setTargetAtTime, the 14.3 interim.
 */

/** Time constant for live pitch glides. Updates arrive ~8–17 ms apart; gliding
 *  toward each one instead of stepping hides the steps with only a few ms of
 *  lag. */
export const LIVE_PITCH_GLIDE_S = 0.008;
/** How long after a fade-out is sent the oscillators stop. On the audio thread
 *  the fade starts when the message arrives, a little after it's sent. */
const STOP_MARGIN_S = 0.03;

/** Where new live voices are smoothed. 'loading' until the worklet module is
 *  in (voices use the fallback meanwhile); 'main thread' if it can't load. */
export type LiveVoiceMode = 'loading' | 'audio thread' | 'main thread';
let mode: LiveVoiceMode = 'loading';

/** For the Perf HUD. */
export function liveVoiceMode(): LiveVoiceMode {
  return mode;
}

onAudioContextCreated(ctx => {
  if (!ctx.audioWorklet) {
    mode = 'main thread';
    return;
  }
  ctx.audioWorklet.addModule(workletUrl).then(
    () => { mode = 'audio thread'; },
    err => {
      mode = 'main thread';
      console.warn('Live voice worklet unavailable; using main-thread glides.', err);
    },
  );
});

export interface LiveVoice {
  /** Glide toward a pitch in Hz. */
  glideTo(hz: number): void;
  /** Ramp gain linearly to `value` (0–1) over `seconds`. */
  rampGain(value: number, seconds: number): void;
  /** Fade out over `seconds`, then stop and disconnect. Idempotent. */
  release(seconds: number): void;
  /** Whether this voice is smoothed on the audio thread (vs. the fallback). */
  readonly onAudioThread: boolean;
}

export interface LiveVoiceStart {
  hz: number;
  /** Gain to fade in to, from silence. */
  gain: number;
  fadeInSeconds: number;
}

export function createLiveVoice(tone: ToneDefinition, start: LiveVoiceStart, dest: AudioNode): LiveVoice {
  return mode === 'audio thread' ? audioThreadVoice(tone, start, dest) : mainThreadVoice(tone, start, dest);
}

function audioThreadVoice(tone: ToneDefinition, start: LiveVoiceStart, dest: AudioNode): LiveVoice {
  const ctx = getAudioContext();
  const graph = createToneGraph(tone);
  const options: LiveVoiceOptions = { ...start, pitchGlideSeconds: LIVE_PITCH_GLIDE_S };
  const control = new AudioWorkletNode(ctx, LIVE_VOICE_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 2,
    outputChannelCount: [1, 1],
    processorOptions: options,
  });
  // An AudioParam adds its inputs to its own value, so zero the values and let
  // the worklet's outputs be the whole signal: 0 → every oscillator's
  // frequency (each layer's detune still applies), 1 → the output gain.
  for (const osc of graph.oscillators) {
    osc.frequency.value = 0;
    control.connect(osc.frequency, 0);
  }
  control.connect(graph.outputGain.gain, 1);
  graph.outputGain.connect(dest);
  graph.start();

  const send = (msg: LiveVoiceMessage) => control.port.postMessage(msg);
  let released = false;
  return {
    onAudioThread: true,
    glideTo: hz => send({ type: 'pitch', hz }),
    rampGain: (value, seconds) => send({ type: 'gain', value, seconds }),
    release(seconds) {
      if (released) return;
      released = true;
      send({ type: 'gain', value: 0, seconds });
      graph.stop(ctx.currentTime + seconds + STOP_MARGIN_S);
      setTimeout(() => {
        send({ type: 'end' });
        control.disconnect();
        control.port.close();
        graph.outputGain.disconnect();
      }, (seconds + STOP_MARGIN_S) * 1000 + 50);
    },
  };
}

function mainThreadVoice(tone: ToneDefinition, start: LiveVoiceStart, dest: AudioNode): LiveVoice {
  const ctx = getAudioContext();
  const synth = createToneSynth(tone);
  synth.connect(dest);
  synth.start();
  synth.setFrequency(start.hz);
  synth.setVolume(0);
  synth.setVolume(start.gain, ctx.currentTime + start.fadeInSeconds);
  let released = false;
  return {
    onAudioThread: false,
    glideTo: hz => synth.glideFrequency(hz, LIVE_PITCH_GLIDE_S),
    rampGain: (value, seconds) => synth.setVolume(value, ctx.currentTime + seconds),
    release(seconds) {
      if (released) return;
      released = true;
      const now = ctx.currentTime;
      synth.setVolume(0, now + seconds);
      synth.stop(now + seconds + 0.01);
    },
  };
}
