import { describe, it, expect } from 'vitest';
import type { TransportState } from '../types';
import {
  TRANSPORT_STOPPED, transition, type TransportEvent,
  isRecordArmed, isCapturing, isJamming, passRecordState, performPhase, forcesScrollView,
} from './transport';

const S = TRANSPORT_STOPPED;
const PAUSED: TransportState = { ...S, mode: 'paused' };
const COUNTDOWN: TransportState = { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: 5 };
const roll = (clock: TransportState['clock'], capture: TransportState['capture']): TransportState =>
  ({ mode: 'playing', clock, capture, countdownStartedAt: 0 });

const PLAY = roll('play', 'none');
const JAM = roll('jam', 'none');
const REC = roll('play', 'armed');
const JAM_REC = roll('jam', 'armed');
const QUEUED = roll('play', 'pass-queued');
const JAM_QUEUED = roll('jam', 'pass-queued');
const PASS = roll('play', 'pass-recording');

const R: TransportEvent = { type: 'toggle-record', audioNow: 42 };

/** [from, event, expected] — every state × every event that changes something,
 *  plus the ignored ones that matter. `'same'` means the event is ignored and
 *  the identical object comes back. */
const table: [string, TransportState, TransportEvent, TransportState | 'same'][] = [
  // play
  ['stopped + play', S, { type: 'play' }, PLAY],
  ['paused + play resumes', PAUSED, { type: 'play' }, PLAY],
  ['playing + play', PLAY, { type: 'play' }, 'same'],
  ['countdown + play', COUNTDOWN, { type: 'play' }, 'same'],
  // pause
  ['plain play + pause', PLAY, { type: 'pause' }, PAUSED],
  ['jam + pause stops', JAM, { type: 'pause' }, S],
  ['recording + pause stops', REC, { type: 'pause' }, S],
  ['queued pass + pause stops', QUEUED, { type: 'pause' }, S],
  ['stopped + pause', S, { type: 'pause' }, 'same'],
  ['countdown + pause', COUNTDOWN, { type: 'pause' }, 'same'],
  // stop
  ['playing + stop', PLAY, { type: 'stop' }, S],
  ['paused + stop', PAUSED, { type: 'stop' }, S],
  ['countdown + stop', COUNTDOWN, { type: 'stop' }, S],
  ['pass + stop', PASS, { type: 'stop' }, S],
  ['stopped + stop', S, { type: 'stop' }, 'same'],
  // escape
  ['countdown + esc', COUNTDOWN, { type: 'escape' }, S],
  ['recording + esc', REC, { type: 'escape' }, S],
  ['pass recording + esc', PASS, { type: 'escape' }, S],
  ['jam + esc', JAM, { type: 'escape' }, S],
  ['plain play + esc', PLAY, { type: 'escape' }, 'same'],
  ['queued pass on plain play + esc', QUEUED, { type: 'escape' }, 'same'],
  // R
  ['stopped + R counts in', S, R, COUNTDOWN_AT(42)],
  ['paused + R counts in', PAUSED, R, COUNTDOWN_AT(42)],
  ['countdown + R cancels', COUNTDOWN, R, S],
  ['plain play + R arms now', PLAY, R, REC],
  ['jam + R arms now, keeps the jam clock', JAM, R, JAM_REC],
  ['queued pass + R takes over', QUEUED, R, REC],
  ['recording + R stops', REC, R, S],
  ['pass recording + R stops', PASS, R, S],
  // Shift+R
  ['stopped + Shift+R records the first pass', S, { type: 'toggle-pass-record' }, PASS],
  ['paused + Shift+R', PAUSED, { type: 'toggle-pass-record' }, PASS],
  ['countdown + Shift+R', COUNTDOWN, { type: 'toggle-pass-record' }, PASS],
  ['plain play + Shift+R queues', PLAY, { type: 'toggle-pass-record' }, QUEUED],
  ['jam + Shift+R queues, keeps the jam clock', JAM, { type: 'toggle-pass-record' }, JAM_QUEUED],
  ['queued + Shift+R cancels', QUEUED, { type: 'toggle-pass-record' }, PLAY],
  ['pass recording + Shift+R cancels', PASS, { type: 'toggle-pass-record' }, PLAY],
  ['open recording + Shift+R', REC, { type: 'toggle-pass-record' }, 'same'],
  // J
  ['stopped + J', S, { type: 'toggle-jam' }, JAM],
  ['paused + J', PAUSED, { type: 'toggle-jam' }, JAM],
  ['plain play + J converts to jam', PLAY, { type: 'toggle-jam' }, JAM],
  ['queued pass + J converts to jam', QUEUED, { type: 'toggle-jam' }, JAM_QUEUED],
  ['jam + J stops', JAM, { type: 'toggle-jam' }, S],
  ['jam recording + J stops', JAM_REC, { type: 'toggle-jam' }, S],
  ['countdown + J', COUNTDOWN, { type: 'toggle-jam' }, 'same'],
  ['recording + J', REC, { type: 'toggle-jam' }, 'same'],
  ['pass recording + J', PASS, { type: 'toggle-jam' }, 'same'],
  // count-in
  ['countdown elapses into recording', COUNTDOWN, { type: 'countdown-elapsed' }, REC],
  ['stale countdown-elapsed', PLAY, { type: 'countdown-elapsed' }, 'same'],
  // loop wrap
  ['wrap starts a queued pass', QUEUED, { type: 'loop-wrap' }, PASS],
  ['wrap ends a pass', PASS, { type: 'loop-wrap' }, PLAY],
  ['wrap keeps the jam clock', JAM_QUEUED, { type: 'loop-wrap' }, roll('jam', 'pass-recording')],
  ['wrap during plain play', PLAY, { type: 'loop-wrap' }, 'same'],
  ['wrap during open recording', REC, { type: 'loop-wrap' }, 'same'],
];

function COUNTDOWN_AT(t: number): TransportState {
  return { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: t };
}

describe('transport transitions (BACKLOG 15.2)', () => {
  it.each(table)('%s', (_label, from, event, expected) => {
    const next = transition(from, event);
    if (expected === 'same') expect(next).toBe(from);
    else expect(next).toEqual(expected);
  });

  it('only ever produces states that satisfy the invariants', () => {
    const states = [S, PAUSED, COUNTDOWN, PLAY, JAM, REC, JAM_REC, QUEUED, JAM_QUEUED, PASS];
    const events: TransportEvent[] = [
      { type: 'play' }, { type: 'pause' }, { type: 'stop' }, { type: 'escape' }, R,
      { type: 'toggle-pass-record' }, { type: 'toggle-jam' }, { type: 'countdown-elapsed' }, { type: 'loop-wrap' },
    ];
    for (const s of states) {
      for (const e of events) {
        const n = transition(s, e);
        if (n.mode === 'stopped' || n.mode === 'paused') {
          expect(n.capture).toBe('none');
          expect(n.clock).toBe('play');
        }
        if (n.mode === 'countdown') {
          expect(n.capture).toBe('armed');
          expect(n.clock).toBe('play');
        }
      }
    }
  });
});

describe('derived views', () => {
  it('matches the old flag semantics', () => {
    expect([S, PAUSED, COUNTDOWN, PLAY, JAM, REC, QUEUED, PASS].map(isRecordArmed))
      .toEqual([false, false, true, false, false, true, false, true]);
    expect([COUNTDOWN, REC, PASS, QUEUED].map(isCapturing)).toEqual([false, true, true, false]);
    expect([PLAY, JAM, JAM_REC, S].map(isJamming)).toEqual([false, true, true, false]);
    expect([PLAY, QUEUED, PASS].map(passRecordState)).toEqual(['off', 'queued', 'recording']);
  });

  it('plain Play is a rolling phase, so the loop seam is handled there too', () => {
    expect([S, PAUSED, COUNTDOWN, PLAY, JAM].map(performPhase))
      .toEqual(['idle', 'idle', 'countdown', 'playing', 'playing']);
  });

  it('capture sessions force the scrolling view; plain Play does not', () => {
    expect([S, PLAY, JAM, COUNTDOWN, REC, QUEUED, PASS].map(forcesScrollView))
      .toEqual([false, false, true, true, true, true, true]);
  });
});
