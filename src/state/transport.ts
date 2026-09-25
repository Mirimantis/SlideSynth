import type { PassRecordState, PerformancePhase, TransportState } from '../types';

/**
 * The transport / perform state machine (BACKLOG 15.2).
 *
 * One value answers "what is the transport doing": `mode` (stopped, paused,
 * counting in to a record, or rolling), `clock` (plain Play, which ends at the
 * end of the content, or the open-ended clock Play runs in Perform) and
 * `capture` (what a rolling transport is recording). It replaces five flags
 * that used to be set in hand-written combinations by six different functions.
 *
 * Jam used to be its own mode with its own clock (BACKLOG 10.1). Since 16.2 it
 * is simply Play in Perform: the caller says whether a Play is open-ended.
 *
 * This module is pure: `transition` decides the next state and nothing else.
 * The controller in main.ts runs the side effects of each change (audio,
 * committing curves, toasts), so every rule about which state follows which is
 * here, in one table, and tested.
 *
 * Invariants: stopped and paused capture nothing on the play clock; countdown
 * is always an armed record on the play clock.
 */

export const TRANSPORT_STOPPED: TransportState = {
  mode: 'stopped',
  clock: 'play',
  capture: 'none',
  countdownStartedAt: 0,
};

export type TransportEvent =
  /** Play button, or Space tap while stopped / paused. `openEnded` in
   *  Perform: the clock runs until stopped instead of ending with the content. */
  | { type: 'play'; openEnded: boolean }
  /** Pause button, or Space tap while rolling. */
  | { type: 'pause' }
  /** Stop button, AFK timeout, file open, or the transport reaching its end. */
  | { type: 'stop' }
  /** Escape: stops a count-in or a recording; otherwise does nothing. */
  | { type: 'escape' }
  /** R — open-ended record. */
  | { type: 'toggle-record'; audioNow: number }
  /** Shift+R — record exactly the next full loop pass (BACKLOG 10.5). */
  | { type: 'toggle-pass-record' }
  /** Perform was entered while rolling: the clock becomes open-ended. Leaving
   *  Perform sends nothing, so a running clock isn't cut short. */
  | { type: 'open-clock' }
  /** The record count-in finished. */
  | { type: 'countdown-elapsed' }
  /** The playhead wrapped from loop-out back to loop-in. */
  | { type: 'loop-wrap' };

const rolling = (clock: TransportState['clock'], capture: TransportState['capture']): TransportState => ({
  mode: 'playing',
  clock,
  capture,
  countdownStartedAt: 0,
});

/** The next transport state. Returns `s` itself when the event doesn't apply,
 *  so callers can tell "ignored" apart from a change by identity. */
export function transition(s: TransportState, e: TransportEvent): TransportState {
  switch (e.type) {
    case 'play':
      if (s.mode === 'stopped' || s.mode === 'paused') return rolling(e.openEnded ? 'open' : 'play', 'none');
      return s;

    case 'pause':
      if (s.mode !== 'playing') return s;
      // Playback, open-ended or not, pauses; Play resumes it with whichever
      // clock the mode then calls for. A recording or a queued pass-record
      // ends instead: capture has no paused state.
      if (s.capture === 'none') return { ...TRANSPORT_STOPPED, mode: 'paused' };
      return TRANSPORT_STOPPED;

    case 'stop':
      return s.mode === 'stopped' ? s : TRANSPORT_STOPPED;

    case 'escape':
      if (s.mode === 'countdown' || isRecordArmed(s)) return TRANSPORT_STOPPED;
      return s;

    case 'toggle-record':
      switch (s.mode) {
        case 'countdown':
          return TRANSPORT_STOPPED; // cancel the count-in
        case 'playing':
          // A running recording (open-ended or a pass) stops outright. A
          // queued pass is taken over by the open-ended record, so the pass's
          // end-of-loop disarm can't silently stop what the user just started.
          if (s.capture === 'armed' || s.capture === 'pass-recording') return TRANSPORT_STOPPED;
          return { ...s, capture: 'armed' };
        default:
          return { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: e.audioNow };
      }

    case 'toggle-pass-record':
      if (s.capture === 'pass-queued' || s.capture === 'pass-recording') return { ...s, capture: 'none' };
      // An open-ended recording already owns capture; Shift+R leaves it alone.
      if (s.mode === 'playing' && s.capture === 'armed') return s;
      // Rolling → wait for the next loop point so the pass is whole. From
      // anything else the transport starts at the loop point, so the first
      // pass is whole already and records immediately.
      if (s.mode === 'playing') return { ...s, capture: 'pass-queued' };
      return rolling('play', 'pass-recording');

    case 'open-clock':
      return s.mode === 'playing' && s.clock === 'play' ? { ...s, clock: 'open' } : s;

    case 'countdown-elapsed':
      return s.mode === 'countdown' ? rolling('play', 'armed') : s;

    case 'loop-wrap':
      if (s.capture === 'pass-queued') return { ...s, capture: 'pass-recording' };
      if (s.capture === 'pass-recording') return { ...s, capture: 'none' };
      return s;
  }
}

// ── Derived views ─────────────────────────────────────────────────

export const isRolling = (s: TransportState): boolean => s.mode === 'playing';

/** Record is armed: counting in, recording open-ended, or recording a pass.
 *  (Matches the old `performance.recordArmed` flag.) */
export const isRecordArmed = (s: TransportState): boolean =>
  s.mode === 'countdown'
  || (s.mode === 'playing' && (s.capture === 'armed' || s.capture === 'pass-recording'));

/** Rolling and writing gestures into curves right now. */
export const isCapturing = (s: TransportState): boolean =>
  s.mode === 'playing' && (s.capture === 'armed' || s.capture === 'pass-recording');

/** Rolling on the open-ended clock: Play in Perform, which used to be a jam. */
export const isOpenEnded = (s: TransportState): boolean => s.mode === 'playing' && s.clock === 'open';

/** The one-pass record state (BACKLOG 10.5), for the Record button's amber
 *  queued look. */
export const passRecordState = (s: TransportState): PassRecordState =>
  s.capture === 'pass-queued' ? 'queued' : s.capture === 'pass-recording' ? 'recording' : 'off';

/** Phase for the performance engine's tick: count-in, rolling (loop-wrap
 *  detection + idle timeout run), or idle. Every rolling transport is
 *  'playing', so a phrase held across the loop seam is always sealed there. */
export const performPhase = (s: TransportState): PerformancePhase =>
  s.mode === 'countdown' ? 'countdown' : s.mode === 'playing' ? 'playing' : 'idle';

/** Capture-owned sessions keep the scrolling rail view even if Perform is
 *  left mid-recording, so the view never jumps while capture runs. */
export const forcesScrollView = (s: TransportState): boolean =>
  isRecordArmed(s) || s.capture === 'pass-queued';
