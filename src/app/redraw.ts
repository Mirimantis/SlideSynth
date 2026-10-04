/**
 * What needs drawing on the next frame (BACKLOG 15.5, split out of main.ts in
 * 15.3). The canvases redraw only when something changed or is animating:
 *  - the background (staff, rulers) when it's marked dirty, which every
 *    viewport change and grid change does;
 *  - the foreground on any request: store notifications, pointer and key
 *    input, and anything else that moves what it shows.
 */

let bgDirty = true;
let fgDirty = true;

/** The staff or rulers changed (zoom, pan, tempo, pitch grid…). Also redraws
 *  the foreground. */
export function markBgDirty(): void {
  bgDirty = true;
}

/** Ask for a foreground redraw on the next frame. */
export function requestRedraw(): void {
  fgDirty = true;
}

/** Whether anything asked to be drawn since the last frame drew. */
export function redrawPending(): boolean {
  return fgDirty || bgDirty;
}

/** A frame is drawing: clear the foreground request. */
export function clearRedrawRequest(): void {
  fgDirty = false;
}

/** Whether the background needs drawing, clearing the flag: the drawer takes it. */
export function takeBgDirty(): boolean {
  const was = bgDirty;
  bgDirty = false;
  return was;
}
