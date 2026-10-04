/**
 * Haptic clicks (BACKLOG 13.35): a tiny vibration when a finger comes onto a
 * snap line while performing. The browser's Vibration API works in Chrome on
 * Android; iPhones and desktops don't have it, so there it does nothing.
 */

/** Click length range and default, in milliseconds (set in testing: nothing
 *  shorter than 20 ms could be felt). */
export const HAPTIC_MS_MIN = 20;
export const HAPTIC_MS_MAX = 40;
export const HAPTIC_MS_DEFAULT = 25;
/** A finger this near a line, in screen pixels, is on it: that's a click. */
export const HAPTIC_RANGE_PX = 10;
/** It must get this far away again before the same line can click again, so
 *  a finger resting at the edge of the range doesn't chatter. */
export const HAPTIC_RELEASE_PX = 15;
/** Closest two clicks may come, in ms: a fast sweep across many lines reads
 *  as a train of clicks, not one long buzz. */
const HAPTIC_MIN_GAP_MS = 30;

export function clampHapticMs(ms: number): number {
  if (!Number.isFinite(ms)) return HAPTIC_MS_DEFAULT;
  return Math.round(Math.max(HAPTIC_MS_MIN, Math.min(HAPTIC_MS_MAX, ms)));
}

/** Whether this device can vibrate at all. */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

let lastClickAt = -Infinity;

/** One click, unless one was just given. `now` is in ms (performance.now()). */
export function hapticClick(ms: number, now: number): boolean {
  if (!canVibrate() || now - lastClickAt < HAPTIC_MIN_GAP_MS) return false;
  lastClickAt = now;
  try {
    return navigator.vibrate(clampHapticMs(ms));
  } catch {
    return false;
  }
}

/** For tests: forget the last click. */
export function resetHaptics(): void {
  lastClickAt = -Infinity;
}

/**
 * Which line a finger is on, for clicking (13.35, reworked in testing:
 * clicking on crossings missed notes the finger reached without quite
 * crossing, and clicked over and over on a line it wavered across). A click
 * when the finger comes within HAPTIC_RANGE_PX of a line; none again for that
 * line until it has gone HAPTIC_RELEASE_PX away. Returns the line it's on
 * after this move (pass it back next move) and whether to click.
 *  - `held`: the line the last move left it on, or null.
 *  - `nearest`: the nearest line within HAPTIC_RANGE_PX now, or null.
 *  - `pxPerUnit`: screen pixels per pitch unit (the viewport's zoom).
 */
export function hapticStep(
  wy: number, held: number | null, nearest: number | null, pxPerUnit: number,
): { line: number | null; click: boolean } {
  if (held !== null && Math.abs(wy - held) * pxPerUnit <= HAPTIC_RELEASE_PX) {
    return { line: held, click: false };
  }
  return nearest !== null ? { line: nearest, click: true } : { line: null, click: false };
}
