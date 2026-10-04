/**
 * Browser gestures off across the whole app on a touch screen (from multitouch
 * testing, 13.33). The canvases already take every touch (`touch-action: none`),
 * but a touch that started on a panel or the top bar could still pull to
 * refresh, swipe back, pinch-zoom the page, select text or open the browser's
 * long-press menu. The CSS half is in styles/main.css (`overscroll-behavior`,
 * `touch-action`, `user-select`, `-webkit-touch-callout`); this is the
 * long-press menu.
 *
 * Gestures of the system itself (Android's back and home swipes, a phone's
 * three-finger screenshot, Windows' edge swipes, a Wacom driver's gestures)
 * never reach the page, so no page can stop them: they're turned off in the
 * device's settings, and Full screen (fullscreen.ts) makes edge swipes less
 * likely to leave the app.
 */

/** Text fields keep their long-press menu (paste, select all). */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

export function installTouchGuards(): void {
  // A long press arrives as a contextmenu event; which pointer made it is
  // known from the press that started it. A mouse's right-click keeps the
  // browser's menu everywhere but the canvas (which has its own).
  let lastPointerType = 'mouse';
  document.addEventListener('pointerdown', e => { lastPointerType = e.pointerType; }, { capture: true, passive: true });
  document.addEventListener('contextmenu', e => {
    if (lastPointerType !== 'mouse' && !isEditable(e.target)) e.preventDefault();
  });
}
