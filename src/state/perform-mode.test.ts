import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { effectiveScrollCanvas, isPerformInputActive } from './perform-mode';

describe('perform-mode (BACKLOG 14.1)', () => {
  beforeEach(() => {
    store.setScrollCanvas(false);
    store.setPerformArmed(false);
    store.setJamActive(false);
    store.setPassRecordState('off');
  });

  it('edits when Lock Rail is off and nothing forces the scrolling view', () => {
    expect(effectiveScrollCanvas(store.getState())).toBe(false);
    expect(isPerformInputActive(store.getState(), true)).toBe(false);
  });

  it('performs while playing with Lock Rail on', () => {
    store.setScrollCanvas(true);
    expect(isPerformInputActive(store.getState(), true)).toBe(true);
  });

  it('never performs while the transport is stopped', () => {
    store.setScrollCanvas(true);
    store.setJamActive(true);
    expect(isPerformInputActive(store.getState(), false)).toBe(false);
  });

  // The 14.1 bug: with Lock Rail off, jam and one-pass record still force the
  // scrolling view, so the edit tools must stand down too.
  it.each([
    ['jamming', () => store.setJamActive(true)],
    ['record-armed', () => store.setPerformArmed(true)],
    ['pass record queued', () => store.setPassRecordState('queued')],
    ['pass recording', () => store.setPassRecordState('recording')],
  ])('performs with Lock Rail off while %s', (_label, arm) => {
    arm();
    expect(effectiveScrollCanvas(store.getState())).toBe(true);
    expect(isPerformInputActive(store.getState(), true)).toBe(true);
  });
});
