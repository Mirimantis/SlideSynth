import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  hapticClick, hapticStep, resetHaptics, clampHapticMs, canVibrate,
  HAPTIC_MS_DEFAULT, HAPTIC_MS_MAX, HAPTIC_MS_MIN, HAPTIC_RANGE_PX,
} from './haptics';
import { nearestSnapLine, type SnapConfig } from '../utils/snap';

const chromatic: SnapConfig = {
  enabled: true,
  subdivisionsPerBeat: 1,
  pitchTargets: Array.from({ length: 30 }, (_, i) => 6000 + i * 100),
};

describe('nearestSnapLine (13.35)', () => {
  it('finds the nearest line within range, or none', () => {
    expect(nearestSnapLine(6108, chromatic, 10)).toBe(6100);
    expect(nearestSnapLine(6092, chromatic, 10)).toBe(6100);
    expect(nearestSnapLine(6150, chromatic, 10)).toBeNull();
  });

  it('finds lines with Snap off too, and guides', () => {
    expect(nearestSnapLine(6203, { ...chromatic, enabled: false }, 10)).toBe(6200);
    const guided: SnapConfig = { ...chromatic, pitchTargets: null, guideYTargets: [6333] };
    expect(nearestSnapLine(6340, guided, 10)).toBe(6333);
  });
});

describe('hapticStep (13.35)', () => {
  // 1 px per cent, so the pixel ranges read directly.
  const px = 1;
  /** Walk a finger through these pitches; the moves that click. */
  function walk(path: number[]): number[] {
    let held: number | null = null;
    const clicks: number[] = [];
    for (const wy of path) {
      const step = hapticStep(wy, held, nearestSnapLine(wy, chromatic, HAPTIC_RANGE_PX / px), px);
      held = step.line;
      if (step.click) clicks.push(wy);
    }
    return clicks;
  }

  it('clicks on coming within range of a line, without having to cross it', () => {
    expect(walk([6070, 6085, 6092, 6095])).toEqual([6092]);
  });

  it('wavering near a line clicks once', () => {
    expect(walk([6090, 6102, 6097, 6104, 6088, 6111, 6093])).toEqual([6090]);
  });

  it('clicks again after leaving and coming back', () => {
    expect(walk([6095, 6120, 6094])).toEqual([6095, 6094]);
  });

  it('clicks for each line on a glide', () => {
    expect(walk([6000, 6050, 6100, 6150, 6200, 6250, 6300])).toEqual([6000, 6100, 6200, 6300]);
  });
});

describe('hapticClick (13.35)', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetHaptics();
    vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('vibrates for the click length, and not again within the gap', () => {
    expect(hapticClick(25, 1000)).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(25);
    expect(hapticClick(25, 1010)).toBe(false);
    expect(hapticClick(25, 1040)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a device that cannot vibrate', () => {
    vi.stubGlobal('navigator', {});
    expect(canVibrate()).toBe(false);
    expect(hapticClick(25, 5000)).toBe(false);
  });

  it('keeps the click length in range: 20 to 40 ms, 25 by default', () => {
    expect(HAPTIC_MS_DEFAULT).toBe(25);
    expect(clampHapticMs(Number.NaN)).toBe(HAPTIC_MS_DEFAULT);
    expect(clampHapticMs(500)).toBe(HAPTIC_MS_MAX);
    expect(clampHapticMs(10)).toBe(HAPTIC_MS_MIN);
    expect(HAPTIC_MS_MIN).toBe(20);
  });
});
