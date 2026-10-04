/**
 * Full screen (from multitouch testing, 13.33): the app fills the screen with
 * no browser bars, and on a phone no status or navigation bars either, so an
 * accidental edge swipe brings the bars back instead of leaving the app. The
 * Fullscreen API; iPhones don't have it for a page (iPads do), so there the
 * command is unavailable and its button hidden.
 */

import { signal, type ReadonlySignal } from '@preact/signals';

const isOn = signal(typeof document !== 'undefined' && document.fullscreenElement != null);

/** Whether the app is full screen now. The browser can leave full screen by
 *  itself (Escape, a system gesture), so this follows the browser. */
export const fullscreenOn: ReadonlySignal<boolean> = isOn;

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    isOn.value = document.fullscreenElement != null;
  });
}

/** Whether this browser can make the page full screen. */
export function canFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

export function toggleFullscreen(): void {
  if (!canFullscreen()) return;
  // The returned promise rejects when the browser refuses (no user gesture,
  // a permissions policy); nothing changes then, so there's nothing to undo.
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}
