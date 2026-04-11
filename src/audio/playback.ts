import type { Composition } from '../types';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { sampleCurve, getCurveTimeRange } from './curve-sampler';
import { SCHEDULER_INTERVAL_MS, SCHEDULER_LOOKAHEAD_S } from '../constants';

interface TrackPlayback {
  trackId: string;
  synth: ToneSynth;
  lastScheduledTime: number;
}

interface PlaybackEngine {
  play(composition: Composition, startBeat: number): void;
  pause(): void;
  stop(): void;
  getPositionBeats(): number;
  isPlaying(): boolean;
}

export function createPlaybackEngine(
  onPositionUpdate: (beats: number) => void,
): PlaybackEngine {
  let playing = false;
  let startAudioTime = 0;    // AudioContext.currentTime when playback started
  let startBeatOffset = 0;   // beat position at playback start
  let currentBpm = 120;
  let schedulerInterval: ReturnType<typeof setInterval> | null = null;
  let trackPlaybacks: TrackPlayback[] = [];
  let currentComposition: Composition | null = null;

  function getPositionBeats(): number {
    if (!playing) return startBeatOffset;
    const ctx = getAudioContext();
    const elapsedSec = ctx.currentTime - startAudioTime;
    return startBeatOffset + elapsedSec * (currentBpm / 60);
  }

  function scheduleAhead(): void {
    if (!playing || !currentComposition) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const scheduleUntil = now + SCHEDULER_LOOKAHEAD_S;
    const beatsToSec = 60 / currentBpm;

    for (const tp of trackPlaybacks) {
      const track = currentComposition.tracks.find(t => t.id === tp.trackId);
      if (!track || track.muted) {
        // Muted: ensure silence
        tp.synth.setVolume(0, now);
        continue;
      }

      // Check solo logic: if any track has solo, only play solo tracks
      const hasSolo = currentComposition.tracks.some(t => t.solo);
      if (hasSolo && !track.solo) {
        tp.synth.setVolume(0, now);
        continue;
      }

      // Convert schedule window to beats
      const fromBeat = startBeatOffset + (tp.lastScheduledTime - startAudioTime) / beatsToSec;
      const toBeat = startBeatOffset + (scheduleUntil - startAudioTime) / beatsToSec;

      // Schedule each curve in this track
      for (const curve of track.curves) {
        const range = getCurveTimeRange(curve);
        if (!range) continue;
        if (range.end < fromBeat || range.start > toBeat) continue;

        const samples = sampleCurve(curve, currentBpm, fromBeat, toBeat);
        for (const sample of samples) {
          // Convert sample time (absolute seconds from beat 0) to AudioContext time
          const audioTime = startAudioTime + (sample.timeSeconds - startBeatOffset * beatsToSec);
          if (audioTime <= tp.lastScheduledTime) continue;
          if (audioTime > scheduleUntil) continue;

          tp.synth.setFrequency(sample.frequency, audioTime);
          tp.synth.setVolume(sample.volume * track.volume, audioTime);
        }

        // Handle gaps: silence before and after curves
        const curveStartSec = startAudioTime + (range.start - startBeatOffset) * beatsToSec;
        const curveEndSec = startAudioTime + (range.end - startBeatOffset) * beatsToSec;

        if (curveStartSec > tp.lastScheduledTime && curveStartSec <= scheduleUntil) {
          // Fade in at curve start
          tp.synth.setVolume(0, curveStartSec - 0.005);
        }
        if (curveEndSec > tp.lastScheduledTime && curveEndSec <= scheduleUntil) {
          // Fade out at curve end
          tp.synth.setVolume(0, curveEndSec + 0.005);
        }
      }

      tp.lastScheduledTime = scheduleUntil;
    }

    // Update position callback
    onPositionUpdate(getPositionBeats());

    // Stop at end
    if (currentComposition && getPositionBeats() >= currentComposition.totalBeats) {
      stop();
    }
  }

  function createTrackSynths(composition: Composition): void {
    disposeTrackSynths();

    for (const track of composition.tracks) {
      const tone = composition.toneLibrary.find(t => t.id === track.toneId);
      if (!tone) continue;

      const synth = createToneSynth(tone);
      synth.connect(getMasterGain());
      synth.setVolume(0);
      synth.start();

      trackPlaybacks.push({
        trackId: track.id,
        synth,
        lastScheduledTime: 0,
      });
    }
  }

  function disposeTrackSynths(): void {
    for (const tp of trackPlaybacks) {
      try {
        tp.synth.setVolume(0);
        tp.synth.stop();
      } catch {
        // Oscillator may already be stopped
      }
    }
    trackPlaybacks = [];
  }

  function play(composition: Composition, startBeat: number): void {
    if (playing) stop();

    ensureResumed();
    const ctx = getAudioContext();

    currentComposition = composition;
    currentBpm = composition.bpm;
    startBeatOffset = startBeat;
    startAudioTime = ctx.currentTime;
    playing = true;

    createTrackSynths(composition);

    // Set initial lastScheduledTime
    for (const tp of trackPlaybacks) {
      tp.lastScheduledTime = startAudioTime;
    }

    // Start scheduler
    schedulerInterval = setInterval(scheduleAhead, SCHEDULER_INTERVAL_MS);
    scheduleAhead(); // immediate first schedule
  }

  function pause(): void {
    if (!playing) return;
    startBeatOffset = getPositionBeats();
    playing = false;
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }
    disposeTrackSynths();
  }

  function stop(): void {
    playing = false;
    startBeatOffset = 0;
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }
    disposeTrackSynths();
    onPositionUpdate(0);
  }

  return {
    play,
    pause,
    stop,
    getPositionBeats,
    isPlaying: () => playing,
  };
}
