import type { Composition } from '../types';
import { getAudioContext, getMasterGain, ensureResumed } from './engine';
import { createToneSynth, type ToneSynth } from './tone-synth';
import { sampleCurve, getCurveTimeRange } from './curve-sampler';
import { computeVoiceAssignment } from './voice-allocation';
import { SCHEDULER_INTERVAL_MS, SCHEDULER_LOOKAHEAD_S } from '../constants';
import { getCompositionLength } from '../model/composition';

interface TrackPlayback {
  trackId: string;
  toneId: string;
  trackGain: GainNode;
  /** Voice pool, sized to the track's max simultaneous curve overlap. */
  voices: ToneSynth[];
  /** curve id -> voice index, recomputed each reconcile. */
  assignment: Map<string, number>;
  lastScheduledTime: number;
}

export interface PlaybackEngine {
  /**
   * @param startBeat where the playhead enters playback (may be anywhere in the loop range).
   * @param endBeat loop/auto-stop boundary; defaults to composition length.
   * @param loopStart where loop restarts jump to; defaults to 0. This is separate
   * from `startBeat` so resuming from a paused position doesn't corrupt the loop start.
   */
  play(composition: Composition, startBeat: number, endBeat?: number, loopStart?: number): void;
  pause(): void;
  stop(): void;
  getPositionBeats(): number;
  isPlaying(): boolean;
  setLoop(enabled: boolean): void;
  isLoopEnabled(): boolean;
  /** Update the active loop/auto-stop range mid-playback (e.g. when selection changes). */
  setPlayRange(loopStart: number, loopEnd: number): void;
  /**
   * Register a hook called once per scheduler tick with the current scheduling
   * window in beats and a helper to convert any beat in that window to audio time.
   * Used by the metronome to schedule clicks alongside tone playback.
   */
  setSchedulerHook(hook: ((fromBeat: number, toBeat: number, composition: Composition, beatToAudioTime: (beat: number) => number) => void) | null): void;
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
  let playStartBeat = 0;
  let playEndBeat = 0;
  let schedulerHook: ((fromBeat: number, toBeat: number, composition: Composition, beatToAudioTime: (beat: number) => number) => void) | null = null;
  /** Earliest beat not yet covered by the scheduler hook (tracks the shared
   *  scheduling window so downstream consumers like the metronome can advance
   *  a monotonic cursor). */
  let hookFromBeat = 0;

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

      // Schedule each curve on its assigned pool voice
      for (const curve of track.curves) {
        const voiceIndex = tp.assignment.get(curve.id);
        const synth = voiceIndex !== undefined ? tp.voices[voiceIndex] : undefined;
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

    // Run scheduler hook (metronome etc.) over the same [hookFromBeat, toBeat)
    // window. hookFromBeat advances monotonically with scheduleUntil.
    if (schedulerHook && currentComposition) {
      const hookToBeat = startBeatOffset + (scheduleUntil - startAudioTime) / beatsToSec;
      const comp = currentComposition;
      const localBeatsToSec = beatsToSec;
      const localStartAudio = startAudioTime;
      const localStartBeat = startBeatOffset;
      const beatToAudioTime = (beat: number): number =>
        localStartAudio + (beat - localStartBeat) * localBeatsToSec;
      schedulerHook(hookFromBeat, hookToBeat, comp, beatToAudioTime);
      hookFromBeat = hookToBeat;
    }

    // Update position callback
    const currentPosition = getPositionBeats();
    onPositionUpdate(currentPosition);

    // End of play range (selection end, or composition end if no selection)
    if (currentComposition && currentPosition >= playEndBeat) {
      if (loopEnabled) {
        const comp = currentComposition;
        const loopStart = playStartBeat;
        const loopEnd = playEndBeat;
        // Reuses the voice pool instead of tearing it down — see
        // reconcileTrackPools/silenceAllVoices in play().
        play(comp, loopStart, loopEnd, loopStart);
        onPositionUpdate(loopStart);
      } else {
        stop();
      }
    }
  }

  function disposePool(tp: TrackPlayback): void {
    for (const synth of tp.voices) {
      try {
        synth.setVolume(0);
        synth.stop();
      } catch {
        // Oscillator may already be stopped
      }
    }
    tp.voices = [];
    tp.trackGain.disconnect();
  }

  function disposeTrackSynths(): void {
    for (const tp of trackPlaybacks) disposePool(tp);
    trackPlaybacks = [];
  }

  /**
   * Build/update the per-track voice pools from the current composition,
   * reusing pools across calls instead of tearing them down — used for both
   * a fresh play() and loop restarts. Pools are sized to each track's max
   * simultaneous curve overlap (computeVoiceAssignment) and only ever grow.
   */
  function reconcileTrackPools(composition: Composition): void {
    const ctx = getAudioContext();
    const existingById = new Map(trackPlaybacks.map(tp => [tp.trackId, tp]));
    const next: TrackPlayback[] = [];

    for (const track of composition.tracks) {
      const tone = composition.toneLibrary.find(t => t.id === track.toneId);
      if (!tone) continue;

      let tp = existingById.get(track.id);
      existingById.delete(track.id);

      if (tp && tp.toneId !== track.toneId) {
        disposePool(tp);
        tp = undefined;
      }

      if (!tp) {
        const trackGain = ctx.createGain();
        trackGain.gain.value = track.volume;
        trackGain.connect(getMasterGain());
        tp = { trackId: track.id, toneId: track.toneId, trackGain, voices: [], assignment: new Map(), lastScheduledTime: 0 };
      }

      const { assignment, voiceCount } = computeVoiceAssignment(track.curves);
      while (tp.voices.length < voiceCount) {
        const synth = createToneSynth(tone);
        synth.connect(tp.trackGain);
        synth.setVolume(0);
        synth.start();
        tp.voices.push(synth);
      }
      tp.assignment = assignment;

      next.push(tp);
    }

    // Tracks no longer present in the composition (deleted mid-session).
    for (const stale of existingById.values()) disposePool(stale);

    trackPlaybacks = next;
  }

  /** Hard-silence every pooled voice, wiping stale future automation left
   *  over from the previous loop iteration before scheduling resumes. */
  function silenceAllVoices(atTime: number): void {
    for (const tp of trackPlaybacks) {
      for (const voice of tp.voices) voice.silence(atTime);
    }
  }

  function play(composition: Composition, startBeat: number, endBeat?: number, loopStart?: number): void {
    // Nothing to play in an empty composition — unless the caller explicitly asked for a
    // range (e.g. Glissandograph recording, which needs to scroll/record into an empty canvas).
    const compLength = getCompositionLength(composition);
    if (compLength <= 0 && endBeat === undefined) {
      if (playing) stop();
      onPositionUpdate(0);
      return;
    }

    const resolvedEnd = endBeat ?? compLength;
    const resolvedLoopStart = loopStart ?? 0;
    if (resolvedEnd <= startBeat) {
      if (playing) stop();
      onPositionUpdate(startBeat);
      return;
    }

    ensureResumed();
    const ctx = getAudioContext();

    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }

    currentComposition = composition;
    currentBpm = composition.bpm;
    startBeatOffset = startBeat;
    startAudioTime = ctx.currentTime;
    playStartBeat = resolvedLoopStart;
    playEndBeat = resolvedEnd;
    playing = true;

    // Reuses existing pools where possible (same track id + tone), growing
    // them as needed rather than tearing everything down — this is what
    // makes loop restarts (and same-composition re-play/scrub) cheap.
    reconcileTrackPools(composition);
    silenceAllVoices(startAudioTime);

    // Set initial lastScheduledTime
    for (const tp of trackPlaybacks) {
      tp.lastScheduledTime = startAudioTime;
    }

    // Align scheduler hook cursor to the play-start beat.
    hookFromBeat = startBeat;

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
    isLoopEnabled: () => loopEnabled,
    setPlayRange(startBeat: number, endBeat: number) {
      if (endBeat <= startBeat) return;
      playStartBeat = startBeat;
      playEndBeat = endBeat;
    },
    setSchedulerHook(hook) {
      schedulerHook = hook;
    },
  };
}
