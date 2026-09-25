import type { AppState } from '../types';
import { forcesScrollView } from './transport';

/**
 * The single definition of "does the left mouse button perform or edit?"
 * (BACKLOG 14.1). Both canvas mouse paths — the perform handler in main.ts and
 * the tool handlers in interaction.ts — must ask this, or a click can do both
 * at once. Pure so it can be tested. BACKLOG 15.2's single input router will be
 * its only caller.
 */

/** Whether the rail view is showing: always in Perform, in compose mode when
 *  the user scrolls the canvas during playback, and while a recording runs
 *  (so leaving Perform mid-take doesn't jump the view). */
export function effectiveScrollCanvas(st: AppState): boolean {
  return st.performMode || st.scrollCanvasEnabled || forcesScrollView(st.transport);
}

/** True when the left button sounds the rail planchette instead of driving the
 *  edit tools: exactly when Perform mode is on (BACKLOG 16.2). Rolling, that's
 *  a performance; stopped, it auditions. */
export function isPerformInputActive(st: AppState): boolean {
  return st.performMode;
}
