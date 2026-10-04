import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMagneticState, updateMagnetic, clampMagneticSpeed, stepMagneticSpeed,
  DEFAULT_MAGNETIC_SPEED, MAGNETIC_SPEED_MAX, MAGNETIC_SPEED_MIN,
} from './snap-magnetic';
import { migrateSnapSettings } from '../export/json-export';
import { loadUserSnapPresets, presetMatches, snapshotPreset, BUILTIN_SNAP_PRESETS, USER_SNAP_PRESETS_STORAGE_KEY } from './snap-presets';

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
