/**
 * The canvas input router (BACKLOG 15.2).
 *
 * One set of Pointer Events listeners per canvas decides, once per press, who
 * owns the gesture — live performance, panning, or the edit tools — and sends
 * every move and the release of that press to the same owner. Before this,
 * perform, pan and the tools each listened to raw mouse events, raced each
 * other through capture/bubble ordering, and each re-derived "is this press
 * mine?" differently (a Draw click during Jam both sounded a note and placed a
 * point; Alt-drag on a transform box both panned and duplicated).
 *
 * Pointer capture keeps a gesture's moves and release coming to the canvas
 * even when the pointer leaves it, which replaces the window-level listeners
 * and ends drags that used to stick when released outside the canvas.
 */

export type PressOwner = 'perform' | 'pan' | 'tool';

export interface PressContext {
  /** PointerEvent.button: 0 left, 1 middle, 2 right. */
  button: number;
  altKey: boolean;
  /** Perform mode: the left button plays (BACKLOG 16.2). */
  performing: boolean;
  /** The press landed on the rulers at the top of the canvas. */
  inRuler: boolean;
  /** A recording is running, so the rulers don't scrub or move loop markers
   *  under it. */
  rulerLocked: boolean;
  /** The tools claim this Alt press (Alt-drag duplicate on a transform box). */
  toolWantsAlt: boolean;
}

/** Who owns a new press — the whole routing policy, pure so it can be tested. */
export function routePress(c: PressContext): PressOwner | null {
  if (c.button === 1) return 'pan';
  if (c.button !== 0) return null;
  // Alt+left pans, except Alt-drag duplicate on a transform box while editing.
  if (c.altKey) return c.toolWantsAlt && !c.performing ? 'tool' : 'pan';
  // The rulers scrub and drag loop markers in either mode (the tools handle
  // that), except under a running recording.
  if (c.inRuler) return c.rulerLocked ? null : 'tool';
  return c.performing ? 'perform' : 'tool';
}

export interface GestureHandlers {
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
}

export interface InputRouterConfig {
  canvas: HTMLCanvasElement;
  isPerforming(): boolean;
  isInRuler(e: PointerEvent): boolean;
  /** See PressContext.rulerLocked. Defaults to never locked. */
  isRulerLocked?(): boolean;
  /** `track` sees every pointer move (the rail planchette and pitch HUD follow
   *  the cursor in every mode); `leave` fires when the pointer leaves with no
   *  press in progress. */
  perform?: GestureHandlers & { track(e: PointerEvent): void; leave(): void };
  pan?: GestureHandlers;
  tool: GestureHandlers & {
    enter?(): void;
    leave?(): void;
    wantsAltPress?(e: PointerEvent): boolean;
  };
}

export interface InputRouter {
  /** Owner of the press in progress, or null between presses. */
  activeOwner(): PressOwner | null;
  dispose(): void;
}

export function createInputRouter(cfg: InputRouterConfig): InputRouter {
  const { canvas } = cfg;
  let active: { owner: PressOwner; pointerId: number } | null = null;
  let pointerInside = false;

  function handlersFor(owner: PressOwner): GestureHandlers | undefined {
    return owner === 'perform' ? cfg.perform : owner === 'pan' ? cfg.pan : cfg.tool;
  }

  function endGesture(e: PointerEvent): void {
    if (!active || e.pointerId !== active.pointerId) return;
    const { owner } = active;
    active = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    handlersFor(owner)?.up(e);
    // A press that ended outside the canvas owes the leave it held back.
    const r = canvas.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside && pointerInside) {
      pointerInside = false;
      cfg.tool.leave?.();
      cfg.perform?.leave();
    }
  }

  const onDown = (e: PointerEvent) => {
    if (active) return;
    const performing = cfg.isPerforming();
    const owner = routePress({
      button: e.button,
      altKey: e.altKey,
      performing,
      inRuler: cfg.isInRuler(e),
      rulerLocked: cfg.isRulerLocked?.() ?? false,
      toolWantsAlt: !performing && e.altKey && (cfg.tool.wantsAltPress?.(e) ?? false),
    });
    const handlers = owner ? handlersFor(owner) : undefined;
    if (!owner || !handlers) return;
    active = { owner, pointerId: e.pointerId };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (released in the same instant, or a
      // synthetic event). The press still works — it just isn't captured.
    }
    // No text selection or focus shuffle from a canvas drag.
    e.preventDefault();
    handlers.down(e);
  };

  const onMove = (e: PointerEvent) => {
    cfg.perform?.track(e);
    if (active) {
      if (e.pointerId === active.pointerId) handlersFor(active.owner)?.move(e);
      return;
    }
    if (!cfg.isPerforming()) cfg.tool.move(e);
  };

  const onEnter = () => {
    pointerInside = true;
    cfg.tool.enter?.();
  };

  const onLeave = () => {
    // During a captured press the pointer "stays" on the canvas; the leave is
    // delivered when the press ends outside (endGesture).
    if (active) return;
    pointerInside = false;
    cfg.tool.leave?.();
    cfg.perform?.leave();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  // Capture lost without a pointerup (e.g. the window lost focus mid-drag).
  canvas.addEventListener('lostpointercapture', endGesture);
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);

  return {
    activeOwner: () => active?.owner ?? null,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', endGesture);
      canvas.removeEventListener('pointercancel', endGesture);
      canvas.removeEventListener('lostpointercapture', endGesture);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}
