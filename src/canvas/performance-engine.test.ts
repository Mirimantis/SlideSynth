import { describe, it, expect, vi } from 'vitest';
import { createPerformanceEngine, type TickArgs, type PerformanceEngine } from './performance-engine';

const CONFIG = {
  countdownSeconds: 3,
  afkTimeoutMs: 60_000,
  recordingBufferMax: 3600,
  loopWrapThresholdBeats: 0.5,
  keepBufferMs: 30_000,
};

function makeTickArgs(overrides: Partial<TickArgs> = {}): TickArgs {
  return {
    now: 0,
    audioNow: 0,
    isPlaying: true,
    phase: 'playing',
    idleTimeoutMs: Infinity,
    countdownStartedAt: 0,
    playbackBeat: 0,
    onCountdownElapsed: () => {},
    onLoopWrap: () => {},
    onAfkTimeout: () => {},
    ...overrides,
  };
}

/** Play a complete phrase: open, capture a rising gesture long enough to fit a
 *  curve, then close it at `closedAtMs`. */
function playPhrase(
  engine: PerformanceEngine,
  voiceId: string,
  startBeat: number,
  closedAtMs: number,
): void {
  engine.beginPhrase(voiceId, closedAtMs);
  for (let i = 0; i <= 4; i++) {
    engine.captureSample(voiceId, { beat: startBeat + i * 0.25, note: 6000 + i * 50, volume: 0.8 });
  }
  engine.closePhrase(voiceId, closedAtMs);
}

describe('performance engine — phrase capture', () => {
  it('begin → capture → close yields one keepable phrase', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    expect(engine.getKeepablePhraseCount()).toBe(1);
    expect(engine.getKeepableVoiceIds()).toEqual(['primary']);
  });

  it('opens a phrase defensively when capture arrives without begin', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.captureSample('primary', { beat: 0, note: 6000, volume: 0.8 });
    engine.captureSample('primary', { beat: 1, note: 6200, volume: 0.8 });
    engine.closePhrase('primary', 1000);
    expect(engine.getKeepablePhraseCount()).toBe(1);
  });

  it('drops out-of-order samples within a phrase', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.beginPhrase('primary', 0);
    engine.captureSample('primary', { beat: 1, note: 6000, volume: 0.8 });
    engine.captureSample('primary', { beat: 0.5, note: 6100, volume: 0.8 }); // backwards — ignored
    engine.captureSample('primary', { beat: 2, note: 6200, volume: 0.8 });
    const buffers = engine.getRecordingBuffers();
    expect(buffers.get('primary')?.map(s => s.beat)).toEqual([1, 2]);
  });

  it('exposes only the open phrase to the trail renderer', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    expect(engine.getRecordingBuffers().has('primary')).toBe(false);
    engine.beginPhrase('primary', 1100);
    engine.captureSample('primary', { beat: 4, note: 6000, volume: 0.8 });
    expect(engine.getRecordingBuffers().get('primary')?.length).toBe(1);
  });
});

describe('performance engine — retrospective keep', () => {
  it('keeps the newest closed phrase, and repeat keeps walk backward', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);   // phrase A
    playPhrase(engine, 'primary', 4, 2000);   // phrase B (newest)
    expect(engine.getKeepablePhraseCount()).toBe(2);

    const first = engine.keepCurve('primary');
    expect(first).not.toBeNull();
    // Newest first: phrase B started at beat 4.
    expect(first!.lanes[0]!.points[0]!.position.x).toBeCloseTo(4);

    const second = engine.keepCurve('primary');
    expect(second).not.toBeNull();
    expect(second!.lanes[0]!.points[0]!.position.x).toBeCloseTo(0);

    expect(engine.keepCurve('primary')).toBeNull();
    expect(engine.getKeepablePhraseCount()).toBe(0);
  });

  it('keeps an in-progress phrase and splits it so capture continues', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.beginPhrase('primary', 0);
    for (let i = 0; i <= 4; i++) {
      engine.captureSample('primary', { beat: i * 0.25, note: 6000 + i * 50, volume: 0.8 });
    }
    // Held gestures are keepable without releasing first.
    expect(engine.getKeepablePhraseCount()).toBe(1);
    const kept = engine.keepCurve('primary');
    expect(kept).not.toBeNull();

    // The gesture is still sounding: further samples land in a fresh phrase,
    // seeded so the continuation starts where the kept curve ended.
    const trail = engine.getRecordingBuffers().get('primary');
    expect(trail?.length).toBe(1);
    expect(trail![0]!.beat).toBeCloseTo(1);
    for (let i = 1; i <= 4; i++) {
      engine.captureSample('primary', { beat: 1 + i * 0.25, note: 6200 + i * 50, volume: 0.8 });
    }
    engine.closePhrase('primary', 500);
    const rest = engine.keepCurve('primary');
    expect(rest).not.toBeNull();
    // Continuation picks up where the kept part ended — nothing dropped.
    expect(rest!.lanes[0]!.points[0]!.position.x).toBeCloseTo(1);
  });

  it('a line held across a loop wrap keeps both halves, newest first', () => {
    // The reported bug: holding LMB through the loop point left the post-wrap
    // half open, so Keep skipped it and took the sealed pre-wrap half instead.
    const engine = createPerformanceEngine(CONFIG);
    engine.beginPhrase('primary', 0);
    for (let i = 0; i <= 4; i++) {
      engine.captureSample('primary', { beat: 6 + i * 0.25, note: 6000 + i * 40, volume: 0.8 });
    }
    engine.closePhrase('primary', 1000);           // loop wrap seals the pre-wrap half
    for (let i = 0; i <= 4; i++) {                 // still held; capture resumes at loop-in
      engine.captureSample('primary', { beat: i * 0.25, note: 6300 + i * 40, volume: 0.8 });
    }
    expect(engine.getKeepablePhraseCount()).toBe(2);

    const postWrap = engine.keepCurve('primary');  // in-progress half — newest
    expect(postWrap).not.toBeNull();
    expect(postWrap!.lanes[0]!.points[0]!.position.x).toBeCloseTo(0);

    const preWrap = engine.keepCurve('primary');   // sealed half
    expect(preWrap).not.toBeNull();
    expect(preWrap!.lanes[0]!.points[0]!.position.x).toBeCloseTo(6);
  });

  it('steps over scraps too short to fit and lands on real material', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);        // real phrase
    engine.beginPhrase('primary', 1100);           // scrap: two samples, ~0 beats long
    engine.captureSample('primary', { beat: 9, note: 6000, volume: 0.8 });
    engine.captureSample('primary', { beat: 9.001, note: 6001, volume: 0.8 });
    engine.closePhrase('primary', 1200);
    const kept = engine.keepCurve('primary');
    expect(kept).not.toBeNull();
    expect(kept!.lanes[0]!.points[0]!.position.x).toBeCloseTo(0);
  });

  it('a kept phrase is not keepable again', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    engine.keepCurve('primary');
    expect(engine.getKeepablePhraseCount()).toBe(0);
    expect(engine.getKeepableVoiceIds()).toEqual([]);
  });

  it('reports keepable voices per voice for multi-voice gestures', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    playPhrase(engine, 'harmony-0', 0, 1000);
    expect(engine.getKeepableVoiceIds().sort()).toEqual(['harmony-0', 'primary']);
    expect(engine.getKeepablePhraseCount()).toBe(2);
  });
});

describe('performance engine — armed finalize', () => {
  it('finalizes only the current phrase, not earlier buffered history', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.startSession(0);
    playPhrase(engine, 'primary', 0, 1000);   // earlier, un-kept history
    playPhrase(engine, 'primary', 8, 2000);   // the gesture just released
    const curve = engine.finalizeCurve('primary', () => {});
    expect(curve).not.toBeNull();
    const xs = curve!.lanes[0]!.points.map(p => p.position.x);
    // Must start at the released gesture's beat — not sweep up the earlier phrase.
    expect(xs[0]).toBeCloseTo(8);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8);
  });

  it('fires the history callback once per session', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onFirstCommit = vi.fn();
    engine.startSession(0);
    playPhrase(engine, 'primary', 0, 1000);
    engine.finalizeCurve('primary', onFirstCommit);
    playPhrase(engine, 'primary', 8, 2000);
    engine.finalizeCurve('primary', onFirstCommit);
    expect(onFirstCommit).toHaveBeenCalledTimes(1);
  });
});

describe('performance engine — buffer lifecycle', () => {
  it('evicts phrases older than the keep window', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    engine.tick(makeTickArgs({ now: 20_000 }));
    expect(engine.getKeepablePhraseCount()).toBe(1);
    engine.tick(makeTickArgs({ now: 40_000 }));
    expect(engine.getKeepablePhraseCount()).toBe(0);
  });

  it('never evicts an in-progress phrase', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.beginPhrase('primary', 0);
    engine.captureSample('primary', { beat: 0, note: 6000, volume: 0.8 });
    engine.captureSample('primary', { beat: 1, note: 6200, volume: 0.8 });
    engine.tick(makeTickArgs({ now: 10_000_000 }));
    engine.closePhrase('primary', 10_000_001);
    expect(engine.getKeepablePhraseCount()).toBe(1);
  });

  it('keeps phrases across stopSession so keep still works after Stop', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    engine.stopSession();
    expect(engine.getKeepablePhraseCount()).toBe(1);
    expect(engine.keepCurve('primary')).not.toBeNull();
  });

  it('stopSession closes an in-flight phrase, making it keepable', () => {
    const engine = createPerformanceEngine(CONFIG);
    engine.beginPhrase('primary', 0);
    for (let i = 0; i <= 4; i++) {
      engine.captureSample('primary', { beat: i * 0.25, note: 6000 + i * 50, volume: 0.8 });
    }
    engine.stopSession();
    expect(engine.getKeepablePhraseCount()).toBe(1);
  });

  it('clearAllPhrases drops everything', () => {
    const engine = createPerformanceEngine(CONFIG);
    playPhrase(engine, 'primary', 0, 1000);
    playPhrase(engine, 'harmony-0', 0, 1000);
    engine.clearAllPhrases();
    expect(engine.getKeepablePhraseCount()).toBe(0);
  });
});

describe('performance engine — idle timeout', () => {
  it('fires onAfkTimeout once idle exceeds the caller-supplied window', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 59_999, idleTimeoutMs: 60_000, onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
    engine.tick(makeTickArgs({ now: 60_001, idleTimeoutMs: 60_000, onAfkTimeout }));
    expect(onAfkTimeout).toHaveBeenCalledTimes(1);
  });

  it('uses a longer window when the caller supplies one (un-armed jam)', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 400_000, idleTimeoutMs: 600_000, onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
    engine.tick(makeTickArgs({ now: 600_001, idleTimeoutMs: 600_000, onAfkTimeout }));
    expect(onAfkTimeout).toHaveBeenCalledTimes(1);
  });

  it('never fires with idleTimeoutMs = Infinity', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 10_000_000, idleTimeoutMs: Infinity, onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
  });

  it('markActivity resets the idle window', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    engine.startSession(0);
    engine.markActivity(50_000);
    engine.tick(makeTickArgs({ now: 100_000, idleTimeoutMs: 60_000, onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
    engine.tick(makeTickArgs({ now: 110_001, idleTimeoutMs: 60_000, onAfkTimeout }));
    expect(onAfkTimeout).toHaveBeenCalledTimes(1);
  });

  it('captureSample counts as activity', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(55_000);
    engine.startSession(0);
    engine.captureSample('primary', { beat: 1, note: 6000, volume: 0.8 });
    nowSpy.mockRestore();
    engine.tick(makeTickArgs({ now: 100_000, idleTimeoutMs: 60_000, onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
  });

  it('does not fire while paused or outside the playing phase', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onAfkTimeout = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 100_000, idleTimeoutMs: 60_000, isPlaying: false, onAfkTimeout }));
    engine.tick(makeTickArgs({ now: 100_000, idleTimeoutMs: 60_000, phase: 'idle', onAfkTimeout }));
    expect(onAfkTimeout).not.toHaveBeenCalled();
  });
});

describe('performance engine — loop wrap', () => {
  it('fires onLoopWrap when the beat jumps back past the threshold', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onLoopWrap = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 1, playbackBeat: 7.9, onLoopWrap }));
    engine.tick(makeTickArgs({ now: 2, playbackBeat: 0.1, onLoopWrap }));
    expect(onLoopWrap).toHaveBeenCalledTimes(1);
  });

  it('ignores small backwards jitter within the threshold', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onLoopWrap = vi.fn();
    engine.startSession(0);
    engine.tick(makeTickArgs({ now: 1, playbackBeat: 4.0, onLoopWrap }));
    engine.tick(makeTickArgs({ now: 2, playbackBeat: 3.8, onLoopWrap }));
    expect(onLoopWrap).not.toHaveBeenCalled();
  });

  it('a phrase closed at the seam and reopened keeps as two separate phrases', () => {
    const engine = createPerformanceEngine(CONFIG);
    // Pre-wrap side of a held gesture.
    engine.beginPhrase('primary', 0);
    for (let i = 0; i <= 4; i++) {
      engine.captureSample('primary', { beat: 7 + i * 0.2, note: 6000 + i * 40, volume: 0.8 });
    }
    engine.closePhrase('primary', 1000);       // loop wrap seals it
    // Post-wrap side: capture resumes from the loop-in beat under the same voice.
    for (let i = 0; i <= 4; i++) {
      engine.captureSample('primary', { beat: i * 0.2, note: 6200 + i * 40, volume: 0.8 });
    }
    engine.closePhrase('primary', 2000);
    expect(engine.getKeepablePhraseCount()).toBe(2);
    // Neither phrase carries the backwards beat jump.
    const post = engine.keepCurve('primary')!;
    const pre = engine.keepCurve('primary')!;
    const postXs = post.lanes[0]!.points.map(p => p.position.x);
    const preXs = pre.lanes[0]!.points.map(p => p.position.x);
    expect(Math.max(...postXs)).toBeLessThan(Math.min(...preXs));
    for (const xs of [postXs, preXs]) {
      for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });
});

describe('performance engine — countdown', () => {
  it('fires onCountdownElapsed after countdownSeconds of audio time', () => {
    const engine = createPerformanceEngine(CONFIG);
    const onCountdownElapsed = vi.fn();
    engine.tick(makeTickArgs({ phase: 'countdown', audioNow: 2.9, countdownStartedAt: 0, onCountdownElapsed }));
    expect(onCountdownElapsed).not.toHaveBeenCalled();
    engine.tick(makeTickArgs({ phase: 'countdown', audioNow: 3.0, countdownStartedAt: 0, onCountdownElapsed }));
    expect(onCountdownElapsed).toHaveBeenCalledTimes(1);
  });
});
