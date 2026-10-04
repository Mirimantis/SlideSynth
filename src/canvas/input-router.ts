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
 *
 * One press at a time, except in Perform on a touch screen (13.33): while a
 * finger plays, more fingers can join, each its own gesture to the end.
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

/**
 * Whether a press that comes while another is in progress joins it as an
 * extra finger (13.33): only a touch, only while the press in progress is a
 * performance, and only where a press of its own would perform (not on the
 * rulers). Everything else is ignored, as before.
 */
export function joinsAsFinger(activeOwner: PressOwner, pointerType: string, owner: PressOwner | null): boolean {
  return activeOwner === 'perform' && pointerType === 'touch' && owner === 'perform';
}

/**
 * Where a pointer move goes. An extra finger moves only its own voice. While a
 * press is in progress, only that press's pointer moves anything: another
 * pointer (a finger the performance didn't take, past the limit or under
 * Prism Draw) used to drag the primary's planchette, and its chord, to wherever
 * it moved. Between presses a mouse or pen hovers; a touch has no hover, so a
 * finger that isn't playing moves nothing.
 */
export function routeMove(c: {
  isFinger: boolean; activePointerId: number | null; pointerId: number; pointerType: string;
}): 'finger' | 'press' | 'hover' | null {
  if (c.isFinger) return 'finger';
  if (c.activePointerId !== null) return c.pointerId === c.activePointerId ? 'press' : null;
  return c.pointerType === 'touch' ? null : 'hover';
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
   *  press in progress. `finger` takes the extra fingers of a multitouch
   *  performance (13.33): its `down` says whether it took the finger (it
   *  won't past the limit), and only a finger it took gets moves and an up. */
  perform?: GestureHandlers & {
    track(e: PointerEvent): void;
    leave(): void;
    finger?: { down(e: PointerEvent): boolean; move(e: PointerEvent): void; up(e: PointerEvent): void };
  };
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
  /** Extra fingers playing beside the press in progress (13.33). They stay
   *  until they lift, even if the press they joined ends first. */
  const fingers = new Set<number>();
  let pointerInside = false;

  function capture(e: PointerEvent): void {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (released in the same instant, or a
      // synthetic event). The press still works — it just isn't captured.
    }
  }

  function handlersFor(owner: PressOwner): GestureHandlers | undefined {
    return owner === 'perform' ? cfg.perform : owner === 'pan' ? cfg.pan : cfg.tool;
  }

  function endGesture(e: PointerEvent): void {
    if (fingers.delete(e.pointerId)) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      cfg.perform?.finger?.up(e);
      return;
    }
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
    if (fingers.has(e.pointerId)) return;
    const performing = cfg.isPerforming();
    const owner = routePress({
      button: e.button,
      altKey: e.altKey,
      performing,
      inRuler: cfg.isInRuler(e),
      rulerLocked: cfg.isRulerLocked?.() ?? false,
      toolWantsAlt: !performing && e.altKey && (cfg.tool.wantsAltPress?.(e) ?? false),
    });
    if (active) {
      const finger = cfg.perform?.finger;
      if (!finger || !joinsAsFinger(active.owner, e.pointerType, owner) || !finger.down(e)) return;
      fingers.add(e.pointerId);
      capture(e);
      e.preventDefault();
      return;
    }
    const handlers = owner ? handlersFor(owner) : undefined;
    if (!owner || !handlers) return;
    active = { owner, pointerId: e.pointerId };
    capture(e);
    // No text selection or focus shuffle from a canvas drag.
    e.preventDefault();
    handlers.down(e);
  };

  const onMove = (e: PointerEvent) => {
    const to = routeMove({
      isFinger: fingers.has(e.pointerId),
      activePointerId: active?.pointerId ?? null,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
    });
    if (to === 'finger') {
      cfg.perform?.finger?.move(e);
    } else if (to === 'press') {
      cfg.perform?.track(e);
      handlersFor(active!.owner)?.move(e);
    } else if (to === 'hover') {
      cfg.perform?.track(e);
      if (!cfg.isPerforming()) cfg.tool.move(e);
    }
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
