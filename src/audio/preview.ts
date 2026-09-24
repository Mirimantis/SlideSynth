import type { ToneDefinition, Composition, VoiceId } from '../types';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { createLiveVoice, type LiveVoice } from './live-voice';
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

/** One track's scrub voices. A curve keeps its voice for as long as it stays
 *  under the scrub position, so overlapping curves (a chord) all sound and
 *  none jumps to another curve's pitch; voices it leaves go back to `spare`. */
interface ScrubTrackEntry {
  tone: ToneDefinition;
  trackGain: GainNode;
  voices: Map<string, ToneSynth>;
  spare: ToneSynth[];
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
  /** Live voices (live-voice.ts): perform, Space preview, Prism harmonies, MIDI. */
  const drawSynths = new Map<VoiceId, LiveVoice>();
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
    const voice = drawSynths.get(voiceId);
    if (!voice) return;
    voice.release(RAMP_OUT);
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
      for (const synth of [...entry.voices.values(), ...entry.spare]) {
        synth.setVolume(0, now + RAMP_OUT);
        synth.stop(now + RAMP_OUT + 0.01);
      }
      entry.trackGain.disconnect();
    }
    scrubEntries.clear();
  }

  /** A silent, running voice for a track's scrub pool. */
  function scrubVoice(entry: ScrubTrackEntry): ToneSynth {
    const reused = entry.spare.pop();
    if (reused) return reused;
    const synth = createToneSynth(entry.tone);
    synth.connect(entry.trackGain);
    synth.start();
    synth.setVolume(0);
    return synth;
  }

  return {
    startDrawPreview(tone: ToneDefinition, noteNumber: number, voiceId: VoiceId = DEFAULT_VOICE, dynamics?: number) {
      stopDrawPreviewFor(voiceId);
      ensureResumed();
      // Fade in from 0 to the starting level: the bus value when performing,
      // the fixed preview level for the idle Spacebar path.
      const gain = dynamics === undefined ? PREVIEW_VOLUME : gainForDynamics(dynamics);
      const voice = createLiveVoice(tone, { hz: centsToFrequency(noteNumber), gain, fadeInSeconds: RAMP_IN }, getPreviewGain());
      drawSynths.set(voiceId, voice);
      drawGains.set(voiceId, gain);
    },

    updateDrawPitch(noteNumber: number, voiceId: VoiceId = DEFAULT_VOICE) {
      drawSynths.get(voiceId)?.glideTo(centsToFrequency(noteNumber));
    },

    setVoiceVolume(voiceId: VoiceId, dynamics: number) {
      const voice = drawSynths.get(voiceId);
      if (!voice) return;
      const gain = gainForDynamics(dynamics);
      const last = drawGains.get(voiceId);
      if (last !== undefined && Math.abs(gain - last) < DYNAMICS_EPSILON) return;
      voice.rampGain(gain, DYNAMICS_RAMP);
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

        // Voices are created on demand by updateScrubPosition, one per curve
        // under the scrub position.
        scrubEntries.set(track.id, { tone, trackGain, voices: new Map(), spare: [] });
      }
    },

    updateScrubPosition(beat: number, composition: Composition) {
      for (const [trackId, entry] of scrubEntries) {
        const track = composition.tracks.find(t => t.id === trackId);

        // Every curve under the scrub position sounds — a chord on one track
        // used to play only its first curve.
        const sounding = new Map<string, { noteNumber: number; volume: number }>();
        for (const curve of track?.curves ?? []) {
          const sample = evaluateCurveAtBeat(curve, beat);
          if (sample) sounding.set(curve.id, sample);
        }

        // Curves the scrub has left: silence their voices and free them.
        for (const [curveId, synth] of entry.voices) {
          if (sounding.has(curveId)) continue;
          synth.setVolume(0);
          entry.voices.delete(curveId);
          entry.spare.push(synth);
        }

        for (const [curveId, sample] of sounding) {
          let synth = entry.voices.get(curveId);
          if (!synth) {
            synth = scrubVoice(entry);
            entry.voices.set(curveId, synth);
          }
          synth.setFrequency(centsToFrequency(sample.noteNumber));
          synth.setVolume(sample.volume * PREVIEW_VOLUME);
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
