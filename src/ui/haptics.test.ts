import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hapticClick, resetHaptics, clampHapticMs, canVibrate, HAPTIC_MS_DEFAULT, HAPTIC_MS_MAX } from './haptics';
import { snapLinesCrossed, type SnapConfig } from '../utils/snap';

const chromatic: SnapConfig = {
  enabled: true,
  subdivisionsPerBeat: 1,
  pitchTargets: Array.from({ length: 30 }, (_, i) => 6000 + i * 100),
};

describe('snapLinesCrossed (13.35)', () => {
  it('counts the lines passed going up and going down', () => {
    expect(snapLinesCrossed(6050, 6250, chromatic)).toBe(2);
    expect(snapLinesCrossed(6250, 6050, chromatic)).toBe(2);
    expect(snapLinesCrossed(6010, 6090, chromatic)).toBe(0);
  });

  it('counts a line touched and then left once', () => {
    expect(snapLinesCrossed(6050, 6100, chromatic)).toBe(1);
    expect(snapLinesCrossed(6100, 6150, chromatic)).toBe(0);
    expect(snapLinesCrossed(6100, 6050, chromatic)).toBe(0);
  });

  it('counts guides as lines, and nothing with Snap off', () => {
    const guided: SnapConfig = { ...chromatic, pitchTargets: null, guideYTargets: [6333] };
    expect(snapLinesCrossed(6300, 6400, guided)).toBe(1);
    expect(snapLinesCrossed(6050, 6250, { ...chromatic, enabled: false })).toBe(0);
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
    expect(hapticClick(12, 1000)).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(12);
    expect(hapticClick(12, 1010)).toBe(false);
    expect(hapticClick(12, 1040)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a device that cannot vibrate', () => {
    vi.stubGlobal('navigator', {});
    expect(canVibrate()).toBe(false);
    expect(hapticClick(10, 5000)).toBe(false);
  });

  it('keeps the click length in range', () => {
    expect(clampHapticMs(Number.NaN)).toBe(HAPTIC_MS_DEFAULT);
    expect(clampHapticMs(500)).toBe(HAPTIC_MS_MAX);
    expect(clampHapticMs(0.4)).toBe(1);
  });
});
