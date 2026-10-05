/**
 * Panning and wheel zoom on the canvases (split out of main.ts in 15.3).
 */

import type { GestureHandlers } from './input-router';
import type { Viewport } from './viewport';

export interface PanZoomDeps {
  viewport: Viewport;
  canvasContainer: HTMLElement;
  /** The view scrolls with playback now: it owns the X offset and zoom. */
  isScrollingPlayback(): boolean;
  /** Lowest offsetX the view may pan to (negative in the rail view). */
  minPanOffsetX(canvasWidth: number): number;
  /** The view moved. */
  onChange(): void;
}

/** Middle-drag (or Alt+left) pan, shared by the staff and the Parameters Graph
 *  — the graph's pan moves the shared X and the pitch Y (its own Y axis is a
 *  fixed 0..1). The canvas input routers decide when a press pans. */
export function createPanGesture(el: HTMLElement, deps: PanZoomDeps): GestureHandlers {
  const { viewport } = deps;
  let last = { x: 0, y: 0 };
  return {
    down(e) {
      last = { x: e.clientX, y: e.clientY };
      el.style.cursor = 'grabbing';
    },
    move(e) {
      // During scrolling playback the X offset is owned by the scroll formula —
      // a user pan in X would fight it each frame. Allow only Y.
      const dx = deps.isScrollingPlayback() ? 0 : (e.clientX - last.x);
      const dy = e.clientY - last.y;
      viewport.panBy(dx, dy);
      const rect = deps.canvasContainer.getBoundingClientRect();
      // When Scroll Canvas is on, the rail is pinned at canvas-centre. Allow offsetX
      // to go negative by half the canvas width so the user can pan beat 0 all the
      // way over to the rail — matches the scrolling-play clamp.
      viewport.clampOffset(rect.width, rect.height, deps.minPanOffsetX(rect.width));
      last = { x: e.clientX, y: e.clientY };
      deps.onChange();
    },
    up() {
      el.style.cursor = '';
    },
  };
}

/** The wheel zooms pitch about the cursor; Ctrl+wheel zooms time. */
export function installWheelZoom(canvas: HTMLElement, deps: PanZoomDeps): void {
  const { viewport } = deps;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    // During scrolling Playback, Ctrl+wheel X-zoom would be overwritten by the
    // scroll formula next frame; suppress so the interaction stays honest.
    if (deps.isScrollingPlayback() && e.ctrlKey) return;

    if (e.ctrlKey) {
      viewport.zoomXAt(factor, sx);
    } else {
      viewport.zoomYAt(factor, sy);
    }

    const rect2 = deps.canvasContainer.getBoundingClientRect();
    // Respect the negative-X margin when Scroll Canvas is on so zoom doesn't
    // push beat 0 away from the rail.
    viewport.clampOffset(rect2.width, rect2.height, deps.minPanOffsetX(rect2.width));
    deps.onChange();
  }, { passive: false });
}
