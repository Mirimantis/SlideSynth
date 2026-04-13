import type { ToneDefinition, Composition } from '../types';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { evaluateCurveAtBeat } from './curve-sampler';
import { noteToFrequency } from '../constants';

const RAMP_IN = 0.01;   // seconds — fade-in to avoid click
const RAMP_OUT = 0.015;  // seconds — fade-out to avoid click
const PREVIEW_VOLUME = 0.6;

interface ScrubCurveEntry {
  synth: ToneSynth;
  trackGain: GainNode;
  trackId: string;
  curveId: string;
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

  startChordPreview(tone: ToneDefinition, notes: number[]): void;
  updateChordNotes(tone: ToneDefinition, notes: number[]): void;
  stopChordPreview(): void;
  isChordPreviewActive(): boolean;

  stopAll(): void;
}

const MAX_CHORD_VOICES = 8;

export function createPreviewManager(): PreviewManager {
  let drawSynth: ToneSynth | null = null;
  let scrubEntries: ScrubCurveEntry[] = [];
  let chordSynths: ToneSynth[] = [];

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

  function stopChordPreview() {
    if (chordSynths.length === 0) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    for (const synth of chordSynths) {
      synth.setVolume(0, now + RAMP_OUT);
      synth.stop(now + RAMP_OUT + 0.01);
    }
    chordSynths = [];
  }

  function stopScrubPreview() {
    if (scrubEntries.length === 0) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const disconnected = new Set<GainNode>();
    for (const entry of scrubEntries) {
      entry.synth.setVolume(0, now + RAMP_OUT);
      entry.synth.stop(now + RAMP_OUT + 0.01);
      if (!disconnected.has(entry.trackGain)) {
        entry.trackGain.disconnect();
        disconnected.add(entry.trackGain);
      }
    }
    scrubEntries = [];
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

        // One gain node per track, one synth per curve
        const trackGain = ctx.createGain();
        trackGain.gain.value = track.volume;
        trackGain.connect(dest);

        for (const curve of track.curves) {
          const synth = createToneSynth(tone);
          synth.connect(trackGain);
          synth.start();
          synth.setVolume(0); // silent until updateScrubPosition provides data
          scrubEntries.push({ synth, trackGain, trackId: track.id, curveId: curve.id });
        }
      }
    },

    updateScrubPosition(beat: number, composition: Composition) {
      for (const entry of scrubEntries) {
        const track = composition.tracks.find(t => t.id === entry.trackId);
        if (!track) {
          entry.synth.setVolume(0);
          continue;
        }

        const curve = track.curves.find(c => c.id === entry.curveId);
        if (!curve) {
          entry.synth.setVolume(0);
          continue;
        }

        const sample = evaluateCurveAtBeat(curve, beat);
        if (sample) {
          entry.synth.setFrequency(noteToFrequency(sample.noteNumber));
          entry.synth.setVolume(sample.volume * PREVIEW_VOLUME);
        } else {
          entry.synth.setVolume(0);
        }
      }
    },

    stopScrubPreview,

    isScrubPreviewActive() {
      return scrubEntries.length > 0;
    },

    startChordPreview(tone: ToneDefinition, notes: number[]) {
      stopChordPreview();
      ensureResumed();
      const ctx = getAudioContext();
      const dest = getPreviewGain();
      const voiceCount = Math.min(notes.length, MAX_CHORD_VOICES);
      const perVoiceVol = PREVIEW_VOLUME / Math.sqrt(voiceCount);

      for (let i = 0; i < voiceCount; i++) {
        const synth = createToneSynth(tone);
        synth.connect(dest);
        synth.start();
        synth.setFrequency(noteToFrequency(notes[i]!));
        synth.setVolume(0);
        synth.setVolume(perVoiceVol, ctx.currentTime + RAMP_IN);
        chordSynths.push(synth);
      }
    },

    updateChordNotes(tone: ToneDefinition, notes: number[]) {
      const voiceCount = Math.min(notes.length, MAX_CHORD_VOICES);
      // If voice count changed, rebuild
      if (chordSynths.length !== voiceCount) {
        // Re-pitch is not enough, rebuild
        this.startChordPreview(tone, notes);
        return;
      }
      // Re-pitch existing synths
      for (let i = 0; i < voiceCount; i++) {
        chordSynths[i]!.setFrequency(noteToFrequency(notes[i]!));
      }
    },

    stopChordPreview,

    isChordPreviewActive() {
      return chordSynths.length > 0;
    },

    stopAll() {
      stopDrawPreview();
      stopScrubPreview();
      stopChordPreview();
    },
  };
}
