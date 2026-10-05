/**
 * Wiring the canvases' input (split out of main.ts in 15.3): one input router
 * per canvas (BACKLOG 15.2), a redraw on any input, and the right-click menu.
 *
 * The router decides once per press who owns the gesture — perform, pan, or
 * the edit tools — and pointer capture keeps the whole press with that owner,
 * on or off the canvas. See input-router.ts.
 */

import { store } from '../state/store';
import { forcesScrollView } from '../state/transport';
import { commandSpec, primaryShortcut, type CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';
import { openContextMenu, type ContextMenuItem } from '../ui/context-menu';
import { requestRedraw } from '../app/redraw';
import { createInputRouter, type GestureHandlers, type InputRouterConfig } from './input-router';
import { RULER_HEIGHT } from './interaction';

/** The commands on the canvas's right-click menu. */
const CONTEXT_MENU: readonly CommandId[] = ['edit.smooth', 'edit.sharpen', 'edit.simplify', 'edit.join', 'edit.group', 'edit.ungroup'];

export function installCanvasInput(deps: {
  fgCanvas: HTMLCanvasElement;
  paramCanvas: HTMLCanvasElement;
  isPerforming(): boolean;
  perform: NonNullable<InputRouterConfig['perform']>;
  /** The edit tools on each canvas. */
  tool: InputRouterConfig['tool'];
  paramTool: InputRouterConfig['tool'];
  /** Pan gestures, one per canvas. */
  pan: GestureHandlers;
  paramPan: GestureHandlers;
  commands: CommandRegistry;
}): void {
  const { fgCanvas, paramCanvas, commands } = deps;

  createInputRouter({
    canvas: fgCanvas,
    isPerforming: deps.isPerforming,
    isInRuler: e => e.clientY - fgCanvas.getBoundingClientRect().top < RULER_HEIGHT,
    isRulerLocked: () => forcesScrollView(store.getState().transport),
    perform: deps.perform,
    pan: deps.pan,
    tool: deps.tool,
  });

  createInputRouter({
    canvas: paramCanvas,
    isPerforming: () => false,
    isInRuler: () => false,
    pan: deps.paramPan,
    tool: deps.paramTool,
  });

  // Input moves state the store doesn't hold (cursor position, drags, marquee,
  // hover, hold-A audition), so any of it asks for a redraw (15.5). Capture
  // phase, so this runs even when a handler stops propagation.
  for (const el of [fgCanvas, paramCanvas]) {
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerenter', 'pointerleave', 'lostpointercapture', 'wheel', 'dblclick', 'contextmenu']) {
      el.addEventListener(type, requestRedraw, { capture: true, passive: true });
    }
  }
  for (const type of ['keydown', 'keyup', 'blur']) {
    window.addEventListener(type, requestRedraw, { capture: true });
  }

  // Right-click action menu. Disabled during Compose Performance (recording / sounding)
  // because curves being captured shouldn't be mutated out from under the engine.
  fgCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (deps.isPerforming()) return;
    const item = (id: CommandId): ContextMenuItem => ({
      label: commandSpec(id).label,
      shortcut: primaryShortcut(id),
      disabled: !commands.enabled(id),
      onClick: () => commands.run(id),
    });
    openContextMenu(e.pageX, e.pageY, CONTEXT_MENU.map(item));
  });
}
