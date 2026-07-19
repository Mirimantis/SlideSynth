import { describe, it, expect, vi } from 'vitest';
import { createPerformanceEngine, type TickArgs } from './performance-engine';

const CONFIG = {
  countdownSeconds: 3,
  afkTimeoutMs: 60_000,
  recordingBufferMax: 3600,
  loopWrapThresholdBeats: 0.5,
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
    // Well past the armed AFK window, still inside the jam window.
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
