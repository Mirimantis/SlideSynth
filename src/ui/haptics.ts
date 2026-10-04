/**
 * Haptic clicks (BACKLOG 13.35): a tiny vibration when a finger crosses a
 * snap line while performing. The browser's Vibration API works in Chrome on
 * Android; iPhones and desktops don't have it, so there it does nothing.
 */

/** Click length range and default, in milliseconds. Some phones round very
 *  short pulses up or skip them, so the length is a setting. */
export const HAPTIC_MS_MIN = 1;
export const HAPTIC_MS_MAX = 40;
export const HAPTIC_MS_DEFAULT = 10;
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
