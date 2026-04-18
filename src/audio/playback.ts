import type { Composition } from '../types';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { sampleCurve, getCurveTimeRange } from './curve-sampler';
import { SCHEDULER_INTERVAL_MS, SCHEDULER_LOOKAHEAD_S } from '../constants';
import { getCompositionLength } from '../model/composition';

interface TrackPlayback {
  trackId: string;
  trackGain: GainNode;
  curveSynths: Map<string, ToneSynth>;
  lastScheduledTime: number;
}

interface PlaybackEngine {
  play(composition: Composition, startBeat: number): void;
  pause(): void;
  stop(): void;
  getPositionBeats(): number;
  isPlaying(): boolean;
  setLoop(enabled: boolean): void;
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
  let loopEnabled = false;

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
        // Muted: silence via track gain
        tp.trackGain.gain.setValueAtTime(0, now);
        tp.lastScheduledTime = scheduleUntil;
        continue;
      }

      // Check solo logic: if any track has solo, only play solo tracks
      const hasSolo = currentComposition.tracks.some(t => t.solo);
      if (hasSolo && !track.solo) {
        tp.trackGain.gain.setValueAtTime(0, now);
        tp.lastScheduledTime = scheduleUntil;
        continue;
      }

      // Ensure track gain reflects current volume
      tp.trackGain.gain.setValueAtTime(track.volume, now);

      // Convert schedule window to beats
      const fromBeat = startBeatOffset + (tp.lastScheduledTime - startAudioTime) / beatsToSec;
      const toBeat = startBeatOffset + (scheduleUntil - startAudioTime) / beatsToSec;

      // Schedule each curve on its own synth
      for (const curve of track.curves) {
        const synth = tp.curveSynths.get(curve.id);
        if (!synth) continue;

        const range = getCurveTimeRange(curve);
        if (!range) continue;
        if (range.end < fromBeat || range.start > toBeat) continue;

        const samples = sampleCurve(curve, currentBpm, fromBeat, toBeat);
        for (const sample of samples) {
          // Convert sample time (absolute seconds from beat 0) to AudioContext time
          const audioTime = startAudioTime + (sample.timeSeconds - startBeatOffset * beatsToSec);
          if (audioTime <= tp.lastScheduledTime) continue;
          if (audioTime > scheduleUntil) continue;

          synth.setFrequency(sample.frequency, audioTime);
          synth.setVolume(sample.volume, audioTime);
        }

        // Handle gaps: silence before and after curves
        const curveStartSec = startAudioTime + (range.start - startBeatOffset) * beatsToSec;
        const curveEndSec = startAudioTime + (range.end - startBeatOffset) * beatsToSec;

        if (curveStartSec > tp.lastScheduledTime && curveStartSec <= scheduleUntil) {
          // Fade in at curve start
          synth.setVolume(0, curveStartSec - 0.005);
        }
        if (curveEndSec > tp.lastScheduledTime && curveEndSec <= scheduleUntil) {
          // Fade out at curve end
          synth.setVolume(0, curveEndSec + 0.005);
        }
      }

      tp.lastScheduledTime = scheduleUntil;
    }

    // Update position callback
    const currentPosition = getPositionBeats();
    onPositionUpdate(currentPosition);

    // End of composition (position of rightmost point across all curves)
    if (currentComposition) {
      const endBeat = getCompositionLength(currentComposition);
      if (currentPosition >= endBeat) {
        if (loopEnabled) {
          // Restart from the beginning
          const comp = currentComposition;
          stop();
          play(comp, 0);
          onPositionUpdate(0);
        } else {
          stop();
        }
      }
    }
  }

  function createTrackSynths(composition: Composition): void {
    disposeTrackSynths();
    const ctx = getAudioContext();

    for (const track of composition.tracks) {
      const tone = composition.toneLibrary.find(t => t.id === track.toneId);
      if (!tone) continue;

      // Per-track gain node carries track volume and mute/solo
      const trackGain = ctx.createGain();
      trackGain.gain.value = track.volume;
      trackGain.connect(getMasterGain());

      // One synth per curve
      const curveSynths = new Map<string, ToneSynth>();
      for (const curve of track.curves) {
        const synth = createToneSynth(tone);
        synth.connect(trackGain);
        synth.setVolume(0);
        synth.start();
        curveSynths.set(curve.id, synth);
      }

      trackPlaybacks.push({
        trackId: track.id,
        trackGain,
        curveSynths,
        lastScheduledTime: 0,
      });
    }
  }

  function disposeTrackSynths(): void {
    for (const tp of trackPlaybacks) {
      for (const synth of tp.curveSynths.values()) {
        try {
          synth.setVolume(0);
          synth.stop();
        } catch {
          // Oscillator may already be stopped
        }
      }
      tp.curveSynths.clear();
      tp.trackGain.disconnect();
    }
    trackPlaybacks = [];
  }

  function play(composition: Composition, startBeat: number): void {
    if (playing) stop();

    // Nothing to play in an empty composition
    if (getCompositionLength(composition) <= 0) {
      onPositionUpdate(0);
      return;
    }

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
    setLoop(enabled: boolean) { loopEnabled = enabled; },
  };
}
