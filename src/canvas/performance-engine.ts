import type { VoiceId, BezierCurve, PerformancePhase } from '../types';
import { curveFromRecording, type RecordedSample } from '../model/curve';

export interface PerformanceEngineConfig {
  countdownSeconds: number;
  afkTimeoutMs: number;
  recordingBufferMax: number;
  loopWrapThresholdBeats: number;
}

export interface TickArgs {
  now: number;                  // performance.now()
  audioNow: number;             // audio context currentTime
  isPlaying: boolean;
  phase: PerformancePhase;
  recordArmed: boolean;
  countdownStartedAt: number;
  playbackBeat: number;
  onCountdownElapsed: () => void;
  onLoopWrap: () => void;
  onAfkTimeout: () => void;
}

export interface PerformanceEngine {
  onLmbDown(now: number): void;
  onLmbUp(): void;
  isLmbDown(): boolean;

  markActivity(now: number): void;

  /** Reset per-session flags (sessionHistorySnapshotted, lastTickBeat). Called on arm / re-arm. */
  startSession(now: number): void;
  /** Full teardown: clear buffers, drop lmbDown, reset session flags. Called on stop. */
  stopSession(): void;

  captureSample(voiceId: VoiceId, sample: RecordedSample): void;
  /**
   * Convert buffered samples → curve, clear the buffer, return the curve for the caller
   * to push onto a track. Fires `onFirstCommit` once per session before returning the
   * first non-null curve (so the caller can snapshot history exactly once).
   * Returns null if the gesture was too short or there are < 2 samples.
   */
  finalizeCurve(voiceId: VoiceId, onFirstCommit: () => void): BezierCurve | null;
  clearBuffer(voiceId: VoiceId): void;

  tick(args: TickArgs): void;

  getLastLoopWrapAt(): number;
  getCountdownLabel(audioNow: number, phase: PerformancePhase, countdownStartedAt: number): string;
}

export function createPerformanceEngine(config: PerformanceEngineConfig): PerformanceEngine {
  const recordingBuffers = new Map<VoiceId, RecordedSample[]>();
  let sessionHistorySnapshotted = false;
  let lastTickBeat: number | null = null;
  let lastLoopWrapAt = 0;
  let lmbDown = false;
  let lastActivityAt = 0;

  function getBuffer(voiceId: VoiceId): RecordedSample[] {
    let buf = recordingBuffers.get(voiceId);
    if (!buf) {
      buf = [];
      recordingBuffers.set(voiceId, buf);
    }
    return buf;
  }

  return {
    onLmbDown(now) {
      lmbDown = true;
      lastActivityAt = now;
    },

    onLmbUp() {
      lmbDown = false;
    },

    isLmbDown() {
      return lmbDown;
    },

    markActivity(now) {
      lastActivityAt = now;
    },

    startSession(now) {
      sessionHistorySnapshotted = false;
      lastTickBeat = null;
      lastActivityAt = now;
    },

    stopSession() {
      recordingBuffers.clear();
      sessionHistorySnapshotted = false;
      lastTickBeat = null;
      lmbDown = false;
    },

    captureSample(voiceId, sample) {
      const buf = getBuffer(voiceId);
      const last = buf[buf.length - 1];
      if (last && sample.beat <= last.beat) return;
      buf.push(sample);
      while (buf.length > config.recordingBufferMax) buf.shift();
      lastActivityAt = performance.now();
    },

    finalizeCurve(voiceId, onFirstCommit) {
      const buf = getBuffer(voiceId);
      const samples = buf.slice();
      buf.length = 0;
      if (samples.length < 2) return null;
      const curve = curveFromRecording(samples);
      if (!curve) return null;
      if (!sessionHistorySnapshotted) {
        onFirstCommit();
        sessionHistorySnapshotted = true;
      }
      return curve;
    },

    clearBuffer(voiceId) {
      const buf = recordingBuffers.get(voiceId);
      if (buf) buf.length = 0;
    },

    tick(args) {
      if (args.phase === 'countdown') {
        const elapsed = args.audioNow - args.countdownStartedAt;
        if (elapsed >= config.countdownSeconds) {
          args.onCountdownElapsed();
        }
        return;
      }

      if (args.phase === 'playing' && args.isPlaying) {
        const beat = args.playbackBeat;
        if (lastTickBeat != null && beat < lastTickBeat - config.loopWrapThresholdBeats) {
          lastLoopWrapAt = args.now;
          args.onLoopWrap();
        }
        lastTickBeat = beat;

        if (args.recordArmed && args.now - lastActivityAt > config.afkTimeoutMs) {
          args.onAfkTimeout();
        }
      }
    },

    getLastLoopWrapAt() {
      return lastLoopWrapAt;
    },

    getCountdownLabel(audioNow, phase, countdownStartedAt) {
      if (phase !== 'countdown') return '';
      const remaining = config.countdownSeconds - (audioNow - countdownStartedAt);
      if (remaining <= 0) return 'Go';
      if (remaining <= 1) return '1';
      if (remaining <= 2) return '2';
      return String(config.countdownSeconds);
    },
  };
}
