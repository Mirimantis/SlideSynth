import { describe, it, expect } from 'vitest';
import type { TransportState } from '../types';
import {
  TRANSPORT_STOPPED, transition, type TransportEvent,
  isRecordArmed, isCapturing, isOpenEnded, passRecordState, performPhase, forcesScrollView,
} from './transport';

const S = TRANSPORT_STOPPED;
const PAUSED: TransportState = { ...S, mode: 'paused' };
const COUNTDOWN: TransportState = { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: 5 };
const roll = (clock: TransportState['clock'], capture: TransportState['capture']): TransportState =>
  ({ mode: 'playing', clock, capture, countdownStartedAt: 0 });

const PLAY = roll('play', 'none');
/** Play in Perform: the open-ended clock (was Jam). */
const OPEN = roll('open', 'none');
const REC = roll('play', 'armed');
const OPEN_REC = roll('open', 'armed');
const QUEUED = roll('play', 'pass-queued');
const OPEN_QUEUED = roll('open', 'pass-queued');
const PASS = roll('play', 'pass-recording');

const R: TransportEvent = { type: 'toggle-record', audioNow: 42 };
const PLAY_EV: TransportEvent = { type: 'play', openEnded: false };
const PLAY_OPEN: TransportEvent = { type: 'play', openEnded: true };

/** [from, event, expected] — every state × every event that changes something,
 *  plus the ignored ones that matter. `'same'` means the event is ignored and
 *  the identical object comes back. */
const table: [string, TransportState, TransportEvent, TransportState | 'same'][] = [
  // play
  ['stopped + play', S, PLAY_EV, PLAY],
  ['stopped + play in Perform is open-ended', S, PLAY_OPEN, OPEN],
  ['paused + play resumes', PAUSED, PLAY_EV, PLAY],
  ['paused + play in Perform resumes open-ended', PAUSED, PLAY_OPEN, OPEN],
  ['playing + play', PLAY, PLAY_EV, 'same'],
  ['countdown + play', COUNTDOWN, PLAY_OPEN, 'same'],
  // pause
  ['plain play + pause', PLAY, { type: 'pause' }, PAUSED],
  ['open-ended play + pause really pauses', OPEN, { type: 'pause' }, PAUSED],
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
  ['open-ended play + esc', OPEN, { type: 'escape' }, 'same'],
  ['plain play + esc', PLAY, { type: 'escape' }, 'same'],
  ['queued pass on plain play + esc', QUEUED, { type: 'escape' }, 'same'],
  // R
  ['stopped + R counts in', S, R, COUNTDOWN_AT(42)],
  ['paused + R counts in', PAUSED, R, COUNTDOWN_AT(42)],
  ['countdown + R cancels', COUNTDOWN, R, S],
  ['plain play + R arms now', PLAY, R, REC],
  ['open-ended play + R arms now, keeps the clock', OPEN, R, OPEN_REC],
  ['queued pass + R takes over', QUEUED, R, REC],
  ['recording + R stops', REC, R, S],
  ['pass recording + R stops', PASS, R, S],
  // Shift+R
  ['stopped + Shift+R records the first pass', S, { type: 'toggle-pass-record' }, PASS],
  ['paused + Shift+R', PAUSED, { type: 'toggle-pass-record' }, PASS],
  ['countdown + Shift+R', COUNTDOWN, { type: 'toggle-pass-record' }, PASS],
  ['plain play + Shift+R queues', PLAY, { type: 'toggle-pass-record' }, QUEUED],
  ['open-ended play + Shift+R queues, keeps the clock', OPEN, { type: 'toggle-pass-record' }, OPEN_QUEUED],
  ['queued + Shift+R cancels', QUEUED, { type: 'toggle-pass-record' }, PLAY],
  ['pass recording + Shift+R cancels', PASS, { type: 'toggle-pass-record' }, PLAY],
  ['open recording + Shift+R', REC, { type: 'toggle-pass-record' }, 'same'],
  // Entering Perform while rolling
  ['plain play opens its clock', PLAY, { type: 'open-clock' }, OPEN],
  ['queued pass opens its clock', QUEUED, { type: 'open-clock' }, OPEN_QUEUED],
  ['recording opens its clock', REC, { type: 'open-clock' }, OPEN_REC],
  ['already open', OPEN, { type: 'open-clock' }, 'same'],
  ['stopped', S, { type: 'open-clock' }, 'same'],
  ['paused', PAUSED, { type: 'open-clock' }, 'same'],
  ['countdown', COUNTDOWN, { type: 'open-clock' }, 'same'],
  // count-in
  ['countdown elapses into recording', COUNTDOWN, { type: 'countdown-elapsed' }, REC],
  ['stale countdown-elapsed', PLAY, { type: 'countdown-elapsed' }, 'same'],
  // loop wrap
  ['wrap starts a queued pass', QUEUED, { type: 'loop-wrap' }, PASS],
  ['wrap ends a pass', PASS, { type: 'loop-wrap' }, PLAY],
  ['wrap keeps the open clock', OPEN_QUEUED, { type: 'loop-wrap' }, roll('open', 'pass-recording')],
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
    const states = [S, PAUSED, COUNTDOWN, PLAY, OPEN, REC, OPEN_REC, QUEUED, OPEN_QUEUED, PASS];
    const events: TransportEvent[] = [
      PLAY_EV, PLAY_OPEN, { type: 'pause' }, { type: 'stop' }, { type: 'escape' }, R,
      { type: 'toggle-pass-record' }, { type: 'open-clock' }, { type: 'countdown-elapsed' }, { type: 'loop-wrap' },
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
    expect([S, PAUSED, COUNTDOWN, PLAY, OPEN, REC, QUEUED, PASS].map(isRecordArmed))
      .toEqual([false, false, true, false, false, true, false, true]);
    expect([COUNTDOWN, REC, PASS, QUEUED].map(isCapturing)).toEqual([false, true, true, false]);
    expect([PLAY, OPEN, OPEN_REC, S, PAUSED].map(isOpenEnded)).toEqual([false, true, true, false, false]);
    expect([PLAY, QUEUED, PASS].map(passRecordState)).toEqual(['off', 'queued', 'recording']);
  });

  it('plain Play is a rolling phase, so the loop seam is handled there too', () => {
    expect([S, PAUSED, COUNTDOWN, PLAY, OPEN].map(performPhase))
      .toEqual(['idle', 'idle', 'countdown', 'playing', 'playing']);
  });

  it('capture sessions force the scrolling view; playback alone does not', () => {
    expect([S, PLAY, OPEN, COUNTDOWN, REC, QUEUED, PASS].map(forcesScrollView))
      .toEqual([false, false, false, true, true, true, true]);
  });
});
