/**
 * Drag-to-resize for the Parameters Graph below the canvas (split out of
 * main.ts in 15.3). The height is a CSS variable, remembered between visits.
 */

const PARAM_HEIGHT_KEY = 'slidesynth.paramGraphHeight';
const PARAM_MIN_H = 60;
const PARAM_MAX_SAVED_H = 600;
/** Main canvas kept above the graph while dragging. */
const MIN_CANVAS_ABOVE = 120;

function setParamGraphHeight(px: number): void {
  document.documentElement.style.setProperty('--param-graph-height', `${Math.round(px)}px`);
}

/** Restore a saved height (call before the first canvas sizing), and let the
 *  handle drag it. `onResize` runs on every height change. */
export function installParamGraphResize(handle: HTMLElement, centerStack: HTMLElement, onResize: () => void): void {
  try {
    const saved = Number(localStorage.getItem(PARAM_HEIGHT_KEY));
    if (Number.isFinite(saved) && saved >= PARAM_MIN_H && saved <= PARAM_MAX_SAVED_H) setParamGraphHeight(saved);
  } catch { /* storage unavailable: the default height */ }

  let resizing = false;
  handle.addEventListener('mousedown', (e) => {
    resizing = true;
    handle.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const stack = centerStack.getBoundingClientRect();
    const maxH = Math.max(PARAM_MIN_H, stack.height - MIN_CANVAS_ABOVE);
    setParamGraphHeight(Math.max(PARAM_MIN_H, Math.min(maxH, stack.bottom - e.clientY)));
    onResize();
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('dragging');
    const px = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--param-graph-height').trim(), 10);
    if (px) { try { localStorage.setItem(PARAM_HEIGHT_KEY, String(px)); } catch { /* ignore */ } }
  });
}
