import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMagneticState, updateMagnetic, resetMagnetic, clampMagneticSpeed, stepMagneticSpeed,
  DEFAULT_MAGNETIC_SPEED, MAGNETIC_SPEED_MAX, MAGNETIC_SPEED_MIN,
} from './snap-magnetic';
import { migrateSnapSettings } from '../export/json-export';
import { loadUserSnapPresets, presetMatches, snapshotPreset, BUILTIN_SNAP_PRESETS, USER_SNAP_PRESETS_STORAGE_KEY } from './snap-presets';

/** The last element (the project's lib predates Array.prototype.at). */
const last = <T>(a: readonly T[]): T | undefined => a[a.length - 1];

/** A glide from one note toward the next: the cursor jumps 500 ¢ and the
 *  planchette chases it into the target's well. Returns the pitch per frame. */
function chase(beatsPerFrame: number, speed: number, frames: number, damping = 6): number[] {
  const state = createMagneticState();
  const attractor = { target: 6500, radius: 100 };
  updateMagnetic(state, 6000, 0, 0.85, 50, damping, null, speed);
  const out: number[] = [];
  for (let f = 1; f <= frames; f++) {
    out.push(updateMagnetic(state, 6500, f * beatsPerFrame, 0.85, 50, damping, attractor, speed));
  }
  return out;
}

// Kernel tests (BACKLOG 15.8): the physics every runtime must reproduce.
describe('Gravity physics', () => {
  /** Run `frames` updates `dt` beats apart toward a fixed cursor; returns the pitches. */
  function run(opts: {
    cursor: number; start?: number; strength?: number; springK?: number; damping?: number;
    attractor?: { target: number; radius: number } | null; dt?: number; frames: number;
  }): number[] {
    const state = createMagneticState();
    updateMagnetic(state, opts.start ?? opts.cursor, 0, 0, 0, 0, null);
    const out: number[] = [];
    const dt = opts.dt ?? 1 / 30;
    for (let f = 1; f <= opts.frames; f++) {
      out.push(updateMagnetic(state, opts.cursor, f * dt, opts.strength ?? 0, opts.springK ?? 50,
        opts.damping ?? 10, opts.attractor ?? null, 1));
    }
    return out;
  }

  it('starts at the cursor, at rest', () => {
    const state = createMagneticState();
    expect(updateMagnetic(state, 6123, 5, 1, 50, 6, { target: 6100, radius: 100 })).toBe(6123);
    expect(state.velocity).toBe(0);
  });

  it('follows the cursor on the spring alone, settling on it', () => {
    const pitches = run({ start: 6000, cursor: 6300, frames: 300 });
    expect(pitches[0]).toBeGreaterThan(6000);
    expect(pitches[0]).toBeLessThan(6300);
    expect(pitches[pitches.length - 1]).toBeCloseTo(6300, 0);
  });

  it('settles on the snap line, not the cursor, when it pulls', () => {
    const attractor = { target: 6400, radius: 100 };
    const pulled = run({ start: 6430, cursor: 6430, strength: 1, attractor, frames: 300 });
    const settled = pulled[pulled.length - 1]!;
    expect(settled).toBeLessThan(6430);
    expect(settled).toBeGreaterThan(6400);
    // With no strength the line does nothing.
    const inert = run({ start: 6430, cursor: 6430, strength: 0, attractor, frames: 50 });
    for (const p of inert) expect(p).toBeCloseTo(6430, 9);
  });

  it('settles exactly on the line when the cursor doesn’t pull (spring 0)', () => {
    const attractor = { target: 6400, radius: 100 };
    const pitches = run({ start: 6430, cursor: 6430, strength: 1, springK: 0, damping: 15, attractor, frames: 600 });
    expect(pitches[pitches.length - 1]).toBeCloseTo(6400, 1);
  });

  it('doesn’t pull from outside the well', () => {
    const attractor = { target: 6400, radius: 50 };
    const pitches = run({ start: 6480, cursor: 6480, strength: 1, attractor, frames: 50 });
    for (const p of pitches) expect(p).toBeCloseTo(6480, 9);
  });

  it('moves nearly the same at any frame rate, and settles in the same place', () => {
    // 60 fps and 480 fps at 120 bpm (30 and 240 frames a beat). The sub-step
    // follows the frame, so an underdamped glide differs mid-way by up to
    // ~14 of its 250 cents (measured 2026-10-04); where it settles doesn't.
    const attractor = { target: 6200, radius: 100 };
    const glide = (framesPerBeat: number, beats: number) =>
      run({ start: 6000, cursor: 6250, strength: 0.7, springK: 40, damping: 6, attractor, dt: 1 / framesPerBeat, frames: framesPerBeat * beats });
    const slow = glide(30, 2);
    const fast = glide(240, 2);
    for (let i = 0; i < slow.length; i++) {
      expect(Math.abs(slow[i]! - fast[(i + 1) * 8 - 1]!)).toBeLessThan(20);
    }
    expect(last(glide(30, 8))).toBeCloseTo(last(glide(240, 8))!, 0);
  });

  it('loses time on frames longer than 0.1 beats (slower than 20 fps at 120 bpm)', () => {
    // The catch-up cap applies per frame, so a very slow frame rate glides slower.
    const glide = (framesPerBeat: number) =>
      run({ start: 6000, cursor: 6250, damping: 15, dt: 1 / framesPerBeat, frames: framesPerBeat / 2 });
    expect(last(glide(4))!).toBeLessThan(last(glide(32))! - 10);
  });

  it('runs at most 0.1 beats of catch-up after a pause, and nothing for time going backward', () => {
    const paused = createMagneticState();
    const short = createMagneticState();
    for (const s of [paused, short]) updateMagnetic(s, 6000, 0, 0, 0, 0, null);
    expect(updateMagnetic(paused, 6500, 50, 0, 50, 10, null)).toBeCloseTo(updateMagnetic(short, 6500, 0.1, 0, 50, 10, null), 9);
    const p = paused.pitch;
    expect(updateMagnetic(paused, 7000, 40, 0, 50, 10, null)).toBe(p);
  });

  it('caps velocity so a wild input can’t blow up', () => {
    const state = createMagneticState();
    updateMagnetic(state, 0, 0, 0, 0, 0, null);
    for (let f = 1; f <= 20; f++) updateMagnetic(state, 1e9, f * 0.1, 0, 1e6, 0, null);
    expect(Math.abs(state.velocity)).toBeLessThanOrEqual(20000);
    expect(Number.isFinite(state.pitch!)).toBe(true);
  });

  it('starts over from the cursor after a reset', () => {
    const state = createMagneticState();
    updateMagnetic(state, 6000, 0, 0, 0, 0, null);
    updateMagnetic(state, 6500, 0.1, 0, 50, 10, null);
    resetMagnetic(state);
    expect(updateMagnetic(state, 7000, 0.2, 0, 50, 10, null)).toBe(7000);
  });
});

describe('Gravity Speed (13.36)', () => {
  it('at 2× matches the same frames at double the tempo exactly', () => {
    // 60 fps at 120 bpm is 1/30 beat a frame; at 240 bpm, 1/15.
    const fast = chase(1 / 30, 2, 40);
    const doubleTempo = chase(1 / 15, 1, 40);
    for (let i = 0; i < 40; i++) expect(fast[i]).toBeCloseTo(doubleTempo[i]!, 9);
  });

  it('gets there sooner when faster', () => {
    const reach = (pitches: number[]) => pitches.findIndex(p => Math.abs(p - 6500) < 5);
    expect(reach(chase(1 / 30, 3, 120))).toBeLessThan(reach(chase(1 / 30, 1, 120)));
  });

  it('stays stable at the top speed', () => {
    const pitches = chase(1 / 30, MAGNETIC_SPEED_MAX, 300, 15);
    for (const p of pitches) expect(Number.isFinite(p)).toBe(true);
    expect(pitches[pitches.length - 1]).toBeCloseTo(6500, 0);
  });

  it('defaults to 1× and clamps to its range', () => {
    expect(chase(1 / 30, DEFAULT_MAGNETIC_SPEED, 20)).toEqual(chase(1 / 30, 1, 20));
    expect(clampMagneticSpeed(undefined)).toBe(1);
    expect(clampMagneticSpeed(Number.NaN)).toBe(1);
    expect(clampMagneticSpeed(100)).toBe(MAGNETIC_SPEED_MAX);
    expect(clampMagneticSpeed(0)).toBe(MAGNETIC_SPEED_MIN);
  });
});

describe('the Speed slider\'s steps', () => {
  it('moves in tenths from 1× up and twentieths below', () => {
    expect(stepMagneticSpeed(1.03)).toBe(1);
    expect(stepMagneticSpeed(1.23)).toBeCloseTo(1.2, 9);
    expect(stepMagneticSpeed(1.27)).toBeCloseTo(1.3, 9);
    expect(stepMagneticSpeed(3.42)).toBeCloseTo(3.4, 9);
    expect(stepMagneticSpeed(0.62)).toBeCloseTo(0.6, 9);
    expect(stepMagneticSpeed(0.38)).toBeCloseTo(0.4, 9);
    expect(stepMagneticSpeed(0.26)).toBe(0.25);
  });

  it('every slider position lands on a value that reads cleanly', () => {
    for (let v = -2; v <= 2 + 1e-9; v += 0.05) {
      const s = stepMagneticSpeed(2 ** v);
      expect(Math.abs(s * 100 - Math.round(s * 100))).toBeLessThan(1e-6);
    }
  });
});

describe('Gravity Speed in files and presets', () => {
  // Tests run without a browser: a small in-memory localStorage.
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => { items.set(k, v); },
      removeItem: (k: string) => { items.delete(k); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads files from before Speed at 1×, and keeps a saved Speed', () => {
    const before = migrateSnapSettings({ tuning: { kind: 'edo', divisions: 12 }, magneticDamping: 6 });
    expect(before.magneticSpeed).toBe(1);
    expect(migrateSnapSettings({ tuning: { kind: 'edo', divisions: 12 }, magneticSpeed: 2.5 }).magneticSpeed).toBe(2.5);
    expect(migrateSnapSettings({ tuning: { kind: 'edo', divisions: 12 }, magneticSpeed: 'fast' }).magneticSpeed).toBe(1);
  });

  it('reads presets saved before Speed as 1×, and a preset matches only at its Speed', () => {
    localStorage.setItem(USER_SNAP_PRESETS_STORAGE_KEY, JSON.stringify([
      { id: 'user-1', name: 'Old', settings: { magneticStrength: 0.5, magneticSpringK: 20, magneticDamping: 4 } },
    ]));
    const [old] = loadUserSnapPresets();
    expect(old?.settings.magneticSpeed).toBe(1);
    const live = { magneticStrength: 0.5, magneticSpringK: 20, magneticDamping: 4, magneticSpeed: 2 };
    expect(presetMatches(old!, live)).toBe(false);
    expect(presetMatches(snapshotPreset('Fast', live), live)).toBe(true);
    for (const p of BUILTIN_SNAP_PRESETS) expect(p.settings.magneticSpeed).toBe(1);
  });
});
