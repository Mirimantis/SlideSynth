import type { AppState } from '../types';

/**
 * The single definition of "does the left mouse button perform or edit?"
 * (BACKLOG 14.1). Both canvas mouse paths — the perform handler in main.ts and
 * the tool handlers in interaction.ts — must ask this, or a click can do both
 * at once. Pure so it can be tested; the transport's running state is passed in
 * because the playback engine, not the store, is authoritative for it.
 *
 * Interim home until the transport/perform state machine (BACKLOG 15.2).
 */

/** Scroll Canvas effective value: the user's Lock Rail toggle, forced on while
 *  recording, jamming, or holding a queued / running one-pass record (10.5) —
 *  so the view doesn't switch modes at the moment capture starts. */
export function effectiveScrollCanvas(st: AppState): boolean {
  return st.scrollCanvasEnabled
    || st.performance.recordArmed
    || st.performance.jamActive
    || st.performance.passRecordState !== 'off';
}

/** True when the transport is rolling in the scrolling view, where the left
 *  button sounds the rail planchette instead of driving the edit tools. */
export function isPerformInputActive(st: AppState, transportRolling: boolean): boolean {
  return transportRolling && effectiveScrollCanvas(st);
}
