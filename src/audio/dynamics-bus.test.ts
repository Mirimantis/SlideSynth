import { describe, it, expect } from 'vitest';
import { createDynamicsBus, isDynamicsSource, SWELL_REST } from './dynamics-bus';
import { DEFAULT_VOLUME } from '../model/lane';

/** Advance a bus by `ms` in `steps` equal ticks, starting from a settled clock. */
function run(bus: ReturnType<typeof createDynamicsBus>, ms: number, steps: number, startAt = 1000) {
  bus.tick(startAt); // first tick only establishes the clock
  for (let i = 1; i <= steps; i++) bus.tick(startAt + (ms * i) / steps);
  return bus.getValue();
}

describe('dynamics bus — fixed source', () => {
  it('returns the pre-bus constant regardless of the swell gate', () => {
    const bus = createDynamicsBus('fixed');
    expect(bus.getValue()).toBe(DEFAULT_VOLUME);
    bus.setSwellHeld(true);
    run(bus, 1000, 10);
    // The gate is ignored entirely under `fixed` — this is what makes the
    // source the exact behaviour recording had before the bus existed.
    expect(bus.isSwellHeld()).toBe(false);
    expect(bus.getValue()).toBe(DEFAULT_VOLUME);
  });

  it('reports itself as not driving, so renderers keep their pre-bus look', () => {
    expect(createDynamicsBus('fixed').isDriven()).toBe(false);
    expect(createDynamicsBus('key-swell').isDriven()).toBe(true);
  });
});

describe('dynamics bus — key swell', () => {
  it('rests at the floor until the key is held', () => {
    const bus = createDynamicsBus('key-swell');
    expect(bus.getValue()).toBe(SWELL_REST);
    expect(run(bus, 500, 30)).toBe(SWELL_REST);
  });

  it('rises monotonically toward full while held', () => {
    const bus = createDynamicsBus('key-swell');
    bus.setSwellHeld(true);
    bus.tick(0);
    let prev = bus.getValue();
    for (let i = 1; i <= 30; i++) {
      bus.tick(i * 16);
      const v = bus.getValue();
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(prev).toBeGreaterThan(0.95);
  });

  it('decays back to rest on release', () => {
    const bus = createDynamicsBus('key-swell');
    bus.setSwellHeld(true);
    run(bus, 600, 40);
    expect(bus.getValue()).toBeGreaterThan(0.95);

    bus.setSwellHeld(false);
    run(bus, 1500, 90, 2000);
    expect(bus.getValue()).toBeCloseTo(SWELL_REST, 3);
  });

  it('is frame-rate independent — one long tick matches many short ones', () => {
    const coarse = createDynamicsBus('key-swell');
    const fine = createDynamicsBus('key-swell');
    coarse.setSwellHeld(true);
    fine.setSwellHeld(true);
    // 100 ms is the bus's dt clamp, so this is the largest step it will honour.
    expect(run(coarse, 100, 1)).toBeCloseTo(run(fine, 100, 10), 6);
  });

  it('ignores the huge dt of a frame after the tab was suspended', () => {
    const bus = createDynamicsBus('key-swell');
    bus.setSwellHeld(true);
    bus.tick(0);
    bus.tick(30_000); // tab woke up after 30 s
    // Clamped to one 100 ms step rather than snapping straight to full.
    expect(bus.getValue()).toBeLessThan(0.95);
    expect(bus.getValue()).toBeGreaterThan(SWELL_REST);
  });

  it('reset() drops the gate and returns to rest', () => {
    const bus = createDynamicsBus('key-swell');
    bus.setSwellHeld(true);
    run(bus, 600, 40);
    bus.reset();
    expect(bus.isSwellHeld()).toBe(false);
    expect(bus.getValue()).toBe(SWELL_REST);
  });

  it('switching source starts the new one from rest', () => {
    const bus = createDynamicsBus('key-swell');
    bus.setSwellHeld(true);
    run(bus, 600, 40);
    bus.setSource('fixed');
    expect(bus.getValue()).toBe(DEFAULT_VOLUME);
    bus.setSource('key-swell');
    expect(bus.getValue()).toBe(SWELL_REST);
    expect(bus.isSwellHeld()).toBe(false);
  });
});

describe('isDynamicsSource', () => {
  it('accepts known sources and rejects stale/unknown stored values', () => {
    expect(isDynamicsSource('fixed')).toBe(true);
    expect(isDynamicsSource('key-swell')).toBe(true);
    expect(isDynamicsSource('breath')).toBe(false);
    expect(isDynamicsSource('')).toBe(false);
  });
});
