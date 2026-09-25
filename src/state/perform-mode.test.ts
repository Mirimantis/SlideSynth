import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { effectiveScrollCanvas, isPerformInputActive } from './perform-mode';
import { TRANSPORT_STOPPED } from './transport';
import type { TransportState } from '../types';

const roll = (clock: TransportState['clock'], capture: TransportState['capture']): TransportState =>
  ({ mode: 'playing', clock, capture, countdownStartedAt: 0 });

const EVERY_TRANSPORT: [string, TransportState][] = [
  ['stopped', TRANSPORT_STOPPED],
  ['paused', { ...TRANSPORT_STOPPED, mode: 'paused' }],
  ['counting in', { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: 1 }],
  ['playing', roll('play', 'none')],
  ['playing open-ended', roll('open', 'none')],
  ['recording', roll('play', 'armed')],
  ['pass queued', roll('play', 'pass-queued')],
];

describe('perform-mode (BACKLOG 14.1, 16.2)', () => {
  beforeEach(() => {
    store.setScrollCanvas(false);
    store.setPerformMode(false);
    store.setTransport(TRANSPORT_STOPPED);
  });

  // The 14.1 bug was two definitions of "performing" disagreeing. Since 16.2
  // there's nothing to disagree about: the mode alone decides.
  it.each(EVERY_TRANSPORT)('the left button plays in Perform and edits outside it, while %s', (_label, t) => {
    store.setTransport(t);
    store.setScrollCanvas(true);
    expect(isPerformInputActive(store.getState())).toBe(false);
    store.setPerformMode(true);
    expect(isPerformInputActive(store.getState())).toBe(true);
  });

  it('Perform always shows the rail view', () => {
    store.setPerformMode(true);
    expect(effectiveScrollCanvas(store.getState())).toBe(true);
  });

  it('compose mode shows the rail view only when asked to scroll', () => {
    store.setTransport(roll('play', 'none'));
    expect(effectiveScrollCanvas(store.getState())).toBe(false);
    store.setScrollCanvas(true);
    expect(effectiveScrollCanvas(store.getState())).toBe(true);
  });

  it.each([
    ['counting in', { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: 1 } as TransportState],
    ['recording', roll('play', 'armed')],
    ['pass queued', roll('play', 'pass-queued')],
    ['pass recording', roll('play', 'pass-recording')],
  ])('keeps the rail view while %s, even outside Perform', (_label, t) => {
    store.setTransport(t);
    expect(effectiveScrollCanvas(store.getState())).toBe(true);
  });
});
