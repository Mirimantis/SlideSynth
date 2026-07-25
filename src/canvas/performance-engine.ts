import type { VoiceId, BezierCurve, PerformancePhase } from '../types';
import { curveFromRecording, type RecordedSample } from '../model/curve';

export interface PerformanceEngineConfig {
  countdownSeconds: number;
  afkTimeoutMs: number;
  recordingBufferMax: number;
  loopWrapThresholdBeats: number;
  /** Retention window for closed phrases in the rolling capture buffer
   *  (BACKLOG 10.2). Measured in wall-clock ms, not beats: a loop wrap runs
   *  the beat counter backwards, so beat-based ageing would misbehave at
   *  exactly the moment a looper is busiest. */
  keepBufferMs: number;
}

/** Hard cap on retained phrases per voice — a backstop beside time-based
 *  eviction so a pathological session can't grow the buffer without bound. */
const MAX_PHRASES_PER_VOICE = 32;

/**
 * One sounding span of a single voice: LMB press → release, MIDI noteOn →
 * noteOff, or either side of a loop-wrap split. Phrases are the unit both
 * capture paths operate on — armed release finalizes the phrase it just
 * closed, and retrospective "keep that" finalizes the newest closed phrase
 * that hasn't been committed yet.
 */
export interface RecordedPhrase {
  samples: RecordedSample[];
  /** Still capturing (the voice is currently sounding). */
  open: boolean;
  /** Already turned into a curve — keep skips these, which is what makes
   *  repeat keeps walk backward and armed recording a natural no-op. */
  committed: boolean;
  /** Wall clock at close; 0 while open. Drives eviction. */
  closedAtMs: number;
}

export interface TickArgs {
  now: number;                  // performance.now()
  audioNow: number;             // audio context currentTime
  isPlaying: boolean;
  phase: PerformancePhase;
  /** Idle window before onAfkTimeout fires. The caller picks the timeout for
   *  the current session kind (armed recording vs. un-armed jam); pass
   *  Infinity to disable the idle auto-stop entirely. */
  idleTimeoutMs: number;
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

  /** Reset per-session flags (sessionHistorySnapshotted, lastTickBeat). Called on arm / re-arm.
   *  Deliberately does NOT drop captured phrases: arming mid-jam is a re-arm, and wiping
   *  what the player just performed at that moment would defeat retrospective capture.
   *  Time-based eviction ages the buffer out instead; clearAllPhrases() handles the hard
   *  resets (composition load). */
  startSession(now: number): void;
  /** Full teardown: close open phrases, drop lmbDown, reset session flags. Called on stop.
   *  Retained phrases survive so "keep that" still works just after stopping. */
  stopSession(): void;

  /** Open a capture phrase for a voice (LMB down, MIDI noteOn, loop-wrap reopen). */
  beginPhrase(voiceId: VoiceId, now: number): void;
  /** Close a voice's open phrase (LMB up, noteOff, loop wrap, stop). No-op if none open. */
  closePhrase(voiceId: VoiceId, now: number): void;
  captureSample(voiceId: VoiceId, sample: RecordedSample): void;
  /**
   * Convert the newest uncommitted phrase → curve, mark it committed, and return
   * the curve for the caller to push onto a track. Fires `onFirstCommit` once per
   * session before returning the first non-null curve (so the caller can snapshot
   * history exactly once). Used by the armed-release path, which takes the phrase
   * it just closed. Returns null if the gesture was too short or has < 2 samples.
   */
  finalizeCurve(voiceId: VoiceId, onFirstCommit: () => void): BezierCurve | null;
  /**
   * Retrospective capture (BACKLOG 10.2): convert the newest uncommitted phrase
   * → curve and mark it committed, walking backward on repeat calls. Takes an
   * in-progress phrase too, splitting it so the still-sounding gesture keeps
   * capturing into a fresh phrase — required for lines held across a loop wrap,
   * where the post-wrap half is still open when the player reaches for Keep.
   * Fires no history callback: the caller snapshots once per keep so each kept
   * pass is exactly one undo entry.
   */
  keepCurve(voiceId: VoiceId): BezierCurve | null;
  /** Voices holding a phrase that "keep that" could commit right now. */
  getKeepableVoiceIds(): VoiceId[];
  /** Total keepable phrases across all voices — drives the Keep button's lit state. */
  getKeepablePhraseCount(): number;
  clearBuffer(voiceId: VoiceId): void;
  /** Drop every retained phrase for every voice (composition load / hard reset). */
  clearAllPhrases(): void;
  /** Read-only view of each voice's in-flight (open) phrase samples. Used by the
   *  renderer to draw a live trail behind the planchette while sounding. Closed
   *  phrases are excluded so the trail still vanishes on release, even though the
   *  samples stick around for retrospective capture. */
  getRecordingBuffers(): ReadonlyMap<VoiceId, readonly RecordedSample[]>;

  tick(args: TickArgs): void;

  getLastLoopWrapAt(): number;
  getCountdownLabel(audioNow: number, phase: PerformancePhase, countdownStartedAt: number): string;
  /** Milliseconds since the last activity mark. Drives the AFK warning popup
   *  countdown so it can race the same `afkTimeoutMs` constant the engine uses
   *  to fire `onAfkTimeout`. Returns 0 if no activity has been recorded yet. */
  getIdleMs(now: number): number;
  /** The configured AFK timeout (ms). Exposed so the popup can compute the
   *  remaining-time countdown without duplicating the constant. */
  getAfkTimeoutMs(): number;
}

export function createPerformanceEngine(config: PerformanceEngineConfig): PerformanceEngine {
  const phrases = new Map<VoiceId, RecordedPhrase[]>();
  let sessionHistorySnapshotted = false;
  let lastTickBeat: number | null = null;
  let lastLoopWrapAt = 0;
  let lmbDown = false;
  let lastActivityAt = 0;

  function getPhrases(voiceId: VoiceId): RecordedPhrase[] {
    let list = phrases.get(voiceId);
    if (!list) {
      list = [];
      phrases.set(voiceId, list);
    }
    return list;
  }

  function openPhraseOf(voiceId: VoiceId): RecordedPhrase | null {
    const list = phrases.get(voiceId);
    if (!list) return null;
    const last = list[list.length - 1];
    return last && last.open ? last : null;
  }

  /** Newest uncommitted phrase for a voice, optionally requiring it to be closed. */
  function newestUncommitted(voiceId: VoiceId, requireClosed: boolean): RecordedPhrase | null {
    const list = phrases.get(voiceId);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]!;
      if (p.committed) continue;
      if (requireClosed && p.open) continue;
      return p;
    }
    return null;
  }

  function closeOpenPhrase(voiceId: VoiceId, now: number): void {
    const open = openPhraseOf(voiceId);
    if (!open) return;
    open.open = false;
    open.closedAtMs = now;
  }

  /** A phrase worth keeping: uncommitted and long enough to fit a curve.
   *  In-progress phrases count — a gesture held across a loop wrap (or any
   *  long sustained line) must be keepable without releasing first, or the
   *  part you are still playing is unreachable. */
  function isKeepable(p: RecordedPhrase): boolean {
    return !p.committed && p.samples.length >= 2;
  }

  /** Drop committed and aged-out phrases. Open phrases are never evicted. */
  function evictPhrases(nowMs: number): void {
    for (const [voiceId, list] of phrases) {
      if (list.length === 0) continue;
      let next = list.filter(p =>
        p.open || (!p.committed && nowMs - p.closedAtMs <= config.keepBufferMs),
      );
      if (next.length > MAX_PHRASES_PER_VOICE) {
        next = next.slice(next.length - MAX_PHRASES_PER_VOICE);
      }
      if (next.length === list.length) continue;
      if (next.length === 0) phrases.delete(voiceId);
      else phrases.set(voiceId, next);
    }
  }

  function takeCurve(p: RecordedPhrase | null): BezierCurve | null {
    if (!p) return null;
    const samples = p.samples.slice();
    p.committed = true;
    if (samples.length < 2) return null;
    return curveFromRecording(samples);
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
      const now = performance.now();
      for (const voiceId of phrases.keys()) closeOpenPhrase(voiceId, now);
      sessionHistorySnapshotted = false;
      lastTickBeat = null;
      lmbDown = false;
    },

    beginPhrase(voiceId, now) {
      // Defensive: a stray begin without a matching close shouldn't leave two
      // open phrases on one voice.
      closeOpenPhrase(voiceId, now);
      getPhrases(voiceId).push({ samples: [], open: true, committed: false, closedAtMs: 0 });
    },

    closePhrase(voiceId, now) {
      closeOpenPhrase(voiceId, now);
    },

    captureSample(voiceId, sample) {
      let open = openPhraseOf(voiceId);
      if (!open) {
        // Capture without an explicit begin (defensive) — start a phrase so the
        // samples aren't dropped on the floor.
        open = { samples: [], open: true, committed: false, closedAtMs: 0 };
        getPhrases(voiceId).push(open);
      }
      const buf = open.samples;
      const last = buf[buf.length - 1];
      if (last && sample.beat <= last.beat) return;
      buf.push(sample);
      while (buf.length > config.recordingBufferMax) buf.shift();
      lastActivityAt = performance.now();
    },

    finalizeCurve(voiceId, onFirstCommit) {
      const curve = takeCurve(newestUncommitted(voiceId, false));
      if (!curve) return null;
      if (!sessionHistorySnapshotted) {
        onFirstCommit();
        sessionHistorySnapshotted = true;
      }
      return curve;
    },

    keepCurve(voiceId) {
      const list = phrases.get(voiceId);
      if (!list) return null;
      // Walk newest → oldest. Phrases too short to fit are stepped over rather
      // than silently swallowed, so one press always lands on real material.
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        if (p.committed) continue;
        if (p.samples.length < 2) continue;
        const samples = p.samples.slice();
        const curve = curveFromRecording(samples);
        if (!curve) {
          // Real samples but below the minimum gesture duration — consume it so
          // a repeat press walks past instead of retrying the same scrap.
          p.committed = true;
          continue;
        }
        p.committed = true;
        if (p.open) {
          // The voice is still sounding: seal what we just kept and continue
          // capturing into a fresh phrase, seeded with the last sample so the
          // next curve picks up exactly where this one ended (and the monotonic
          // guard has a baseline). Without this the rest of a held gesture
          // would be written into an already-committed phrase and lost.
          p.open = false;
          p.closedAtMs = performance.now();
          list.push({
            samples: [samples[samples.length - 1]!],
            open: true,
            committed: false,
            closedAtMs: 0,
          });
        }
        return curve;
      }
      return null;
    },

    getKeepableVoiceIds() {
      const out: VoiceId[] = [];
      for (const [voiceId, list] of phrases) {
        if (list.some(isKeepable)) out.push(voiceId);
      }
      return out;
    },

    getKeepablePhraseCount() {
      let count = 0;
      for (const list of phrases.values()) {
        for (const p of list) if (isKeepable(p)) count++;
      }
      return count;
    },

    clearBuffer(voiceId) {
      phrases.delete(voiceId);
    },

    clearAllPhrases() {
      phrases.clear();
    },

    getRecordingBuffers() {
      const view = new Map<VoiceId, readonly RecordedSample[]>();
      for (const [voiceId, list] of phrases) {
        const last = list[list.length - 1];
        if (last && last.open) view.set(voiceId, last.samples);
      }
      return view;
    },

    tick(args) {
      if (args.phase === 'countdown') {
        const elapsed = args.audioNow - args.countdownStartedAt;
        if (elapsed >= config.countdownSeconds) {
          args.onCountdownElapsed();
        }
        return;
      }

      // Age the rolling buffer even when idle, so the Keep indicator goes dark
      // on schedule after a session stops.
      evictPhrases(args.now);

      if (args.phase === 'playing' && args.isPlaying) {
        const beat = args.playbackBeat;
        if (lastTickBeat != null && beat < lastTickBeat - config.loopWrapThresholdBeats) {
          lastLoopWrapAt = args.now;
          args.onLoopWrap();
        }
        lastTickBeat = beat;

        if (Number.isFinite(args.idleTimeoutMs) && args.now - lastActivityAt > args.idleTimeoutMs) {
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

    getIdleMs(now) {
      return lastActivityAt === 0 ? 0 : Math.max(0, now - lastActivityAt);
    },

    getAfkTimeoutMs() {
      return config.afkTimeoutMs;
    },
  };
}
