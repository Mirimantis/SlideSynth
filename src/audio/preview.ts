import type { ToneDefinition, Composition, VoiceId } from '../types';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { evaluateCurveAtBeat } from './curve-sampler';
import { centsToFrequency } from '../constants';

const RAMP_IN = 0.01;   // seconds — fade-in to avoid click
const RAMP_OUT = 0.015;  // seconds — fade-out to avoid click
const PREVIEW_VOLUME = 0.6;
/** Gain a fully-swelled dynamics-bus value maps to (BACKLOG 11.1). Chosen so
 *  the bus's `fixed` source (DEFAULT_VOLUME = 0.8) lands on exactly
 *  PREVIEW_VOLUME — perform loudness is unchanged from before the bus, and a
 *  full swell has a little headroom above it. */
const PERFORM_FULL_GAIN = 0.75;
/** Per-frame `setVoiceVolume` calls that move the value less than this are
 *  dropped, so a steady dynamics value doesn't schedule 60 AudioParam ramps a
 *  second per voice. */
const DYNAMICS_EPSILON = 0.005;
/** Ramp length for a dynamics update — long enough to avoid zipper noise,
 *  short enough that the swell tracks the key. */
const DYNAMICS_RAMP = 0.02;

const DEFAULT_VOICE: VoiceId = 'primary';

interface ScrubTrackEntry {
  synth: ToneSynth;
  trackGain: GainNode;
}

export interface PreviewManager {
  /** `dynamics` (0–1, from the dynamics bus) sets the starting loudness; omit
   *  it for the idle Spacebar preview, which sounds at a fixed level. */
  startDrawPreview(tone: ToneDefinition, noteNumber: number, voiceId?: VoiceId, dynamics?: number): void;
  updateDrawPitch(noteNumber: number, voiceId?: VoiceId): void;
  /** Ride a sounding voice's loudness from the dynamics bus (BACKLOG 11.1).
   *  Called per frame while performing; no-op for voices that aren't sounding
   *  and for values that haven't moved. */
  setVoiceVolume(voiceId: VoiceId, dynamics: number): void;
  stopDrawPreview(voiceId?: VoiceId): void;
  isDrawPreviewActive(voiceId?: VoiceId): boolean;

  startScrubPreview(composition: Composition): void;
  updateScrubPosition(beat: number, composition: Composition): void;
  stopScrubPreview(): void;
  isScrubPreviewActive(): boolean;

  stopAll(): void;
}

export function createPreviewManager(): PreviewManager {
  const drawSynths = new Map<VoiceId, ToneSynth>();
  /** Last gain actually scheduled per draw voice — the epsilon guard's baseline. */
  const drawGains = new Map<VoiceId, number>();
  const scrubEntries = new Map<string, ScrubTrackEntry>();

  /** Map a dynamics-bus value (0–1) to output gain. */
  function gainForDynamics(dynamics: number): number {
    return Math.max(0, Math.min(1, dynamics)) * PERFORM_FULL_GAIN;
  }

  // Shared preview gain node (created lazily)
  let previewGain: GainNode | null = null;
  function getPreviewGain(): GainNode {
    if (!previewGain) {
      const ctx = getAudioContext();
      previewGain = ctx.createGain();
      previewGain.gain.value = 1;
      previewGain.connect(getMasterGain());
    }
    return previewGain;
  }

  function stopDrawPreviewFor(voiceId: VoiceId) {
    const synth = drawSynths.get(voiceId);
    if (!synth) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    synth.setVolume(0, now + RAMP_OUT);
    synth.stop(now + RAMP_OUT + 0.01);
    drawSynths.delete(voiceId);
    drawGains.delete(voiceId);
  }

  function stopAllDrawPreviews() {
    for (const voiceId of [...drawSynths.keys()]) {
      stopDrawPreviewFor(voiceId);
    }
  }

  function stopScrubPreview() {
    if (scrubEntries.size === 0) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    for (const entry of scrubEntries.values()) {
      entry.synth.setVolume(0, now + RAMP_OUT);
      entry.synth.stop(now + RAMP_OUT + 0.01);
      entry.trackGain.disconnect();
    }
    scrubEntries.clear();
  }

  return {
    startDrawPreview(tone: ToneDefinition, noteNumber: number, voiceId: VoiceId = DEFAULT_VOICE, dynamics?: number) {
      stopDrawPreviewFor(voiceId);
      ensureResumed();
      const ctx = getAudioContext();
      const synth = createToneSynth(tone);
      synth.connect(getPreviewGain());
      synth.start();
      synth.setFrequency(centsToFrequency(noteNumber));
      // Ramp from 0 to the starting level: the bus value when performing, the
      // fixed preview level for the idle Spacebar path.
      const gain = dynamics === undefined ? PREVIEW_VOLUME : gainForDynamics(dynamics);
      synth.setVolume(0);
      synth.setVolume(gain, ctx.currentTime + RAMP_IN);
      drawSynths.set(voiceId, synth);
      drawGains.set(voiceId, gain);
    },

    updateDrawPitch(noteNumber: number, voiceId: VoiceId = DEFAULT_VOICE) {
      const synth = drawSynths.get(voiceId);
      if (synth) {
        synth.setFrequency(centsToFrequency(noteNumber));
      }
    },

    setVoiceVolume(voiceId: VoiceId, dynamics: number) {
      const synth = drawSynths.get(voiceId);
      if (!synth) return;
      const gain = gainForDynamics(dynamics);
      const last = drawGains.get(voiceId);
      if (last !== undefined && Math.abs(gain - last) < DYNAMICS_EPSILON) return;
      synth.setVolume(gain, getAudioContext().currentTime + DYNAMICS_RAMP);
      drawGains.set(voiceId, gain);
    },

    stopDrawPreview(voiceId: VoiceId = DEFAULT_VOICE) {
      stopDrawPreviewFor(voiceId);
    },

    isDrawPreviewActive(voiceId?: VoiceId) {
      if (voiceId === undefined) return drawSynths.size > 0;
      return drawSynths.has(voiceId);
    },

    startScrubPreview(composition: Composition) {
      stopScrubPreview();
      ensureResumed();
      const ctx = getAudioContext();
      const dest = getPreviewGain();
      const hasSolo = composition.tracks.some(t => t.solo);

      for (const track of composition.tracks) {
        if (track.muted) continue;
        if (hasSolo && !track.solo) continue;

        const tone = composition.toneLibrary.find(t => t.id === track.toneId);
        if (!tone) continue;

        const trackGain = ctx.createGain();
        trackGain.gain.value = track.volume;
        trackGain.connect(dest);

        const synth = createToneSynth(tone);
        synth.connect(trackGain);
        synth.start();
        synth.setVolume(0); // silent until updateScrubPosition provides data

        scrubEntries.set(track.id, { synth, trackGain });
      }
    },

    updateScrubPosition(beat: number, composition: Composition) {
      for (const [trackId, entry] of scrubEntries) {
        const track = composition.tracks.find(t => t.id === trackId);
        if (!track) {
          entry.synth.setVolume(0);
          continue;
        }

        // Find the first curve that covers this beat
        let found = false;
        for (const curve of track.curves) {
          const sample = evaluateCurveAtBeat(curve, beat);
          if (sample) {
            entry.synth.setFrequency(centsToFrequency(sample.noteNumber));
            entry.synth.setVolume(sample.volume * PREVIEW_VOLUME);
            found = true;
            break;
          }
        }
        if (!found) {
          entry.synth.setVolume(0);
        }
      }
    },

    stopScrubPreview,

    isScrubPreviewActive() {
      return scrubEntries.size > 0;
    },

    stopAll() {
      stopAllDrawPreviews();
      stopScrubPreview();
    },
  };
}
