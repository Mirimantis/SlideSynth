import type { AppState } from '../types';
import { forcesScrollView, isRolling } from './transport';

/**
 * The single definition of "does the left mouse button perform or edit?"
 * (BACKLOG 14.1). Both canvas mouse paths — the perform handler in main.ts and
 * the tool handlers in interaction.ts — must ask this, or a click can do both
 * at once. Pure so it can be tested. BACKLOG 15.2's single input router will be
 * its only caller.
 */

/** Scroll Canvas effective value: the user's Lock Rail toggle, forced on while
 *  counting in, recording, jamming, or holding a queued one-pass record — so the
 *  view doesn't switch modes at the moment capture starts. */
export function effectiveScrollCanvas(st: AppState): boolean {
  return st.scrollCanvasEnabled || forcesScrollView(st.transport);
}

/** True when the transport is rolling in the scrolling view, where the left
 *  button sounds the rail planchette instead of driving the edit tools. */
export function isPerformInputActive(st: AppState): boolean {
  return isRolling(st.transport) && effectiveScrollCanvas(st);
}
