import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { effectiveScrollCanvas, isPerformInputActive } from './perform-mode';
import { TRANSPORT_STOPPED } from './transport';
import type { TransportState } from '../types';

const roll = (clock: TransportState['clock'], capture: TransportState['capture']): TransportState =>
  ({ mode: 'playing', clock, capture, countdownStartedAt: 0 });

describe('perform-mode (BACKLOG 14.1)', () => {
  beforeEach(() => {
    store.setScrollCanvas(false);
    store.setTransport(TRANSPORT_STOPPED);
  });

  it('edits when Lock Rail is off and nothing forces the scrolling view', () => {
    store.setTransport(roll('play', 'none'));
    expect(effectiveScrollCanvas(store.getState())).toBe(false);
    expect(isPerformInputActive(store.getState())).toBe(false);
  });

  it('performs while playing with Lock Rail on', () => {
    store.setScrollCanvas(true);
    store.setTransport(roll('play', 'none'));
    expect(isPerformInputActive(store.getState())).toBe(true);
  });

  it('never performs while the transport is stopped, paused or counting in', () => {
    store.setScrollCanvas(true);
    for (const t of [
      TRANSPORT_STOPPED,
      { ...TRANSPORT_STOPPED, mode: 'paused' as const },
      { mode: 'countdown' as const, clock: 'play' as const, capture: 'armed' as const, countdownStartedAt: 1 },
    ]) {
      store.setTransport(t);
      expect(isPerformInputActive(store.getState())).toBe(false);
    }
  });

  // The 14.1 bug: with Lock Rail off, jam and one-pass record still force the
  // scrolling view, so the edit tools must stand down too.
  it.each([
    ['jamming', roll('jam', 'none')],
    ['recording', roll('play', 'armed')],
    ['pass record queued', roll('play', 'pass-queued')],
    ['pass recording', roll('play', 'pass-recording')],
  ])('performs with Lock Rail off while %s', (_label, t) => {
    store.setTransport(t);
    expect(effectiveScrollCanvas(store.getState())).toBe(true);
    expect(isPerformInputActive(store.getState())).toBe(true);
  });
});
