import type { ToneDefinition, Composition } from '../types';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { evaluateCurveAtBeat } from './curve-sampler';
import { noteToFrequency } from '../constants';

const RAMP_IN = 0.01;   // seconds — fade-in to avoid click
const RAMP_OUT = 0.015;  // seconds — fade-out to avoid click
const PREVIEW_VOLUME = 0.6;

interface ScrubTrackEntry {
  synth: ToneSynth;
  trackGain: GainNode;
}

export interface PreviewManager {
  startDrawPreview(tone: ToneDefinition, noteNumber: number): void;
  updateDrawPitch(noteNumber: number): void;
  stopDrawPreview(): void;
  isDrawPreviewActive(): boolean;

  startScrubPreview(composition: Composition): void;
  updateScrubPosition(beat: number, composition: Composition): void;
  stopScrubPreview(): void;
  isScrubPreviewActive(): boolean;

  stopAll(): void;
}

export function createPreviewManager(): PreviewManager {
  let drawSynth: ToneSynth | null = null;
  const scrubEntries = new Map<string, ScrubTrackEntry>();

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

  function stopDrawPreview() {
    if (!drawSynth) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    drawSynth.setVolume(0, now + RAMP_OUT);
    drawSynth.stop(now + RAMP_OUT + 0.01);
    drawSynth = null;
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
    startDrawPreview(tone: ToneDefinition, noteNumber: number) {
      stopDrawPreview();
      ensureResumed();
      const ctx = getAudioContext();
      const synth = createToneSynth(tone);
      synth.connect(getPreviewGain());
      synth.start();
      synth.setFrequency(noteToFrequency(noteNumber));
      // Ramp from 0 to preview volume
      synth.setVolume(0);
      synth.setVolume(PREVIEW_VOLUME, ctx.currentTime + RAMP_IN);
      drawSynth = synth;
    },

    updateDrawPitch(noteNumber: number) {
      if (drawSynth) {
        drawSynth.setFrequency(noteToFrequency(noteNumber));
      }
    },

    stopDrawPreview,

    isDrawPreviewActive() {
      return drawSynth !== null;
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
            entry.synth.setFrequency(noteToFrequency(sample.noteNumber));
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
      stopDrawPreview();
      stopScrubPreview();
    },
  };
}
