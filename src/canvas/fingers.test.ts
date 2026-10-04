import { describe, it, expect } from 'vitest';
import { allocateFingerVoice, edgeScrollStep, isFingerVoice, MAX_FINGERS } from './fingers';

describe('allocateFingerVoice (13.33)', () => {
  it('hands out the lowest free voice, reusing a lifted finger’s', () => {
    expect(allocateFingerVoice([])).toBe('touch-1');
    expect(allocateFingerVoice(['touch-1', 'touch-2'])).toBe('touch-3');
    expect(allocateFingerVoice(['touch-1', 'touch-3'])).toBe('touch-2');
  });

  it('ignores voices that aren’t fingers', () => {
    expect(allocateFingerVoice(['primary', 'harmony-0', 'midi-60'])).toBe('touch-1');
  });

  it('runs out after nine extra fingers: the primary is the tenth', () => {
    const nine = Array.from({ length: MAX_FINGERS - 1 }, (_, i) => `touch-${i + 1}`);
    expect(allocateFingerVoice(nine)).toBeNull();
  });

  it('tells finger voices from the rest', () => {
    expect(isFingerVoice('touch-4')).toBe(true);
    expect(isFingerVoice('primary')).toBe(false);
    expect(isFingerVoice('midi-60')).toBe(false);
  });
});

describe('edgeScrollStep (13.33)', () => {
  const top = 20;
  const bottom = 500;
  const step = (ys: number[]) => edgeScrollStep(ys, top, bottom, 30, 4);

  it('doesn’t scroll with every finger away from the edges', () => {
    expect(step([])).toBe(0);
    expect(step([100, 300])).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster at the edge', () => {
    expect(step([top + 15])).toBeCloseTo(2);
    expect(step([top])).toBeCloseTo(4);
    expect(step([bottom - 15])).toBeCloseTo(-2);
    expect(step([bottom + 50])).toBeCloseTo(-4);
  });

  it('lets the finger nearest an edge set the speed', () => {
    expect(step([top + 15, top + 3, 250])).toBeCloseTo(3.6);
  });

  it('cancels out with fingers at both edges', () => {
    expect(step([top + 5, bottom - 5])).toBe(0);
  });
});
