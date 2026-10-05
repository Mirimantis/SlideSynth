/**
 * The frame loop (BACKLOG 15.5; split out of main.ts in 15.3).
 *
 * Every animation frame runs tick(), which advances what moves on its own
 * (scroll-follow, perform, dynamics, magnetic physics, recording capture). The
 * canvases are then redrawn only when something changed or is animating, and
 * the scene only reads: it never changes the composition. Idle, a frame costs a
 * few flag checks.
 *
 * "Something changed" is:
 *   • any store notification (via the effect below), including the
 *     canvas-only planchette and playhead values;
 *   • pointer and key input, which moves state the store doesn't hold (cursor,
 *     drags, marquee, hovered handle);
 *   • a dirty background (markBgDirty) — every viewport change sets it.
 * "Animating" covers the transport rolling or armed, a held perform note, and
 * the tail of a pulse or flash.
 *
 * The HUDs over the canvas (pitch, Perf, the count-in and the idle warning)
 * update here too, with what the canvas draws.
 */

import { signal, type ReadonlySignal } from '@preact/signals-core';
import { store } from '../state/store';
import { effect } from '../state/reactive';
import { isRecordArmed } from '../state/transport';
import type { AppState } from '../types';
import { MAX_CANVAS_EXTENT, SCROLL_BUFFER } from '../constants';
import type { PlaybackEngine } from '../audio/playback';
import type { DynamicsBus } from '../audio/dynamics-bus';
import { getAudioContext } from '../audio/engine';
import { liveVoiceMode } from '../audio/live-voice';
import { getActiveSynthCount, getActiveOscillatorCount } from '../audio/tone-synth';
import type { Interaction } from '../canvas/interaction';
import type { Viewport } from '../canvas/viewport';
import type { Scene } from '../canvas/scene';
import { scrollViewportToBeat } from '../canvas/scrolling-play';
import { METRONOME_FLASH_DURATION_MS, LOOP_WRAP_FLASH_MS, PULSE_DURATION_MS } from '../canvas/planchette';
import type { Performer } from '../perform/performer';
import { pitchReadout } from '../ui/pitch-hud';
import { perfReadout } from '../ui/perf-hud';
import { countdownLabel, afkLabel } from '../ui/session-overlays';
import { setReadout, type CanvasHuds } from '../ui/canvas-huds';
import { createFrameTimes } from '../ui/frame-times';
import type { MetronomeFlash } from './metronome';
import { requestRedraw, redrawPending, clearRedrawRequest, markBgDirty } from './redraw';

export interface FrameLoopDeps {
  scene: Scene;
  performer: Performer;
  dynamics: DynamicsBus;
  playback: PlaybackEngine;
  viewport: Viewport;
  canvasContainer: HTMLElement;
  interaction: Interaction;
  effectiveScrollCanvas(): boolean;
  /** Keep a held A's audition in step with what it's over. */
  syncAudition(): void;
  metronomeFlash(): MetronomeFlash;
  /** What the HUDs over the canvas show. */
  huds: CanvasHuds;
}

export function createFrameLoop(deps: FrameLoopDeps) {
  const { scene, performer, dynamics, playback, viewport, canvasContainer, interaction } = deps;
  const composeEngine = performer.engine;

  const { huds } = deps;
  const frameTimes = createFrameTimes();

  /** Phrases the rolling buffer can keep, for the Keep button (BACKLOG 10.2).
   *  Engine state that never notifies the store — sealing a phrase and aging one
   *  out — so it's polled each frame; the signal only wakes the button when the
   *  count actually changes. */
  const keepable = signal(0);
  /** The left button is sounding, so the tool strip can't change tools. Engine
   *  state, polled per frame. */
  const toolsLocked = signal(false);

  effect(() => {
    store.trackAllChannels();
    requestRedraw();
  });
  let wasAnimating = false;

  function isAnimating(state: AppState): boolean {
    if (playback.isPlaying() || composeEngine.isLmbDown()) return true;
    if (state.transport.mode === 'countdown' || isRecordArmed(state.transport)) return true;
    const now = performance.now();
    const flash = deps.metronomeFlash();
    if (flash.at > 0 && now - flash.at < METRONOME_FLASH_DURATION_MS) return true;
    const wrapAt = composeEngine.getLastLoopWrapAt();
    if (wrapAt > 0 && now - wrapAt < LOOP_WRAP_FLASH_MS) return true;
    const wall = Date.now();
    return state.performance.planchettes.some(p => wall - p.lastCrossedAt < PULSE_DURATION_MS);
  }

  function updatePitchHud(state: AppState) {
    const planchette = performer.hudPlanchette(state);
    if (state.pitchHudVisible && planchette?.snappedWorldY != null) {
      // Dynamics is shown whenever a live source is driving the bus, held or not,
      // so the player can see where the swell rests before they lean on it.
      const dyn = dynamics.isDriven() ? dynamics.getValue('primary') : null;
      setReadout(huds.pitch, pitchReadout(state, planchette.snappedWorldY, planchette.cursorWorldY, dyn));
    } else {
      huds.pitch.value = null;
    }
  }

  function updatePerfHud(state: AppState) {
    if (!state.perfHudVisible) return;
    setReadout(huds.perf, perfReadout({
      frameMsP50: frameTimes.percentile(0.5),
      frameMsP99: frameTimes.percentile(0.99),
      synthCount: getActiveSynthCount(),
      oscillatorCount: getActiveOscillatorCount(),
      voiceCount: state.performance.planchettes.length,
      audioBaseLatencyMs: getAudioContext().baseLatency * 1000,
      liveVoiceMode: liveVoiceMode(),
    }));
  }

  function frame() {
    runFrame();
    requestAnimationFrame(frame);
  }

  function runFrame() {
    // Frame-time sample for the Perf HUD's rolling window. Always pushed (the
    // sort cost happens only inside updatePerfHud when the HUD is visible)
    // so toggling the HUD on instantly has 2 s of accurate p50/p99.
    frameTimes.push(performance.now());
    tick();
    deps.syncAudition();

    const state = store.getState();
    keepable.value = composeEngine.getKeepablePhraseCount();
    updatePerfHud(state);
    const animating = isAnimating(state);
    // One more frame after an animation ends clears its last faded step.
    if (redrawPending() || animating || wasAnimating) {
      clearRedrawRequest();
      // Compose UI affordances that follow the same state the canvas draws.
      toolsLocked.value = composeEngine.isLmbDown();
      updatePitchHud(state);
      huds.countdown.value = countdownLabel(state, composeEngine, getAudioContext().currentTime);
      huds.afk.value = afkLabel(state, composeEngine, playback.isPlaying(), performance.now());
      scene.draw();
    }
    wasAnimating = animating;
  }

  /** Per-frame simulation. May update runtime state (viewport, planchettes,
   *  perform capture); drawing happens separately in scene.draw(). */
  function tick() {
    // Reconcile harmony planchettes against current state. Cheap no-op when
    // state hasn't changed; covers playback start/stop, drawMode toggle, and
    // mid-playback chord-spec voice-count changes.
    performer.syncHarmonyPlanchettes();

    // "Scroll Canvas" view: when the toggle is effectively on during Playback,
    // scroll the viewport each frame so the playhead sits centred on the rail.
    // Toggle off → classic static canvas with the playhead moving across.
    // Recording forces the scrolling view on via `effectiveScrollCanvas()`.
    if (deps.effectiveScrollCanvas() && playback.isPlaying()) {
      const rect = canvasContainer.getBoundingClientRect();
      // While recording the in-flight buffer isn't reflected in the composition
      // length yet, so the canvas extent can be shorter than the live playhead —
      // the viewport would clamp and the canvas visually freezes. Bump the extent
      // to stay ahead of the playhead so scroll keeps going until LMB release
      // commits the captured curve (after which the extent follows the composition again).
      const playheadBeat = playback.getPositionBeats();
      const neededExtent = Math.min(MAX_CANVAS_EXTENT, playheadBeat + SCROLL_BUFFER);
      if (viewport.canvasExtent < neededExtent) viewport.canvasExtent = neededExtent;
      scrollViewportToBeat(viewport, playheadBeat, rect.width, rect.height);
      markBgDirty();
    }

    // Compose performance tick: countdown advance, loop-wrap detection, AFK auto-stop.
    performer.tickComposePerform();

    // Dynamics bus: advance the envelope, then ride the sounding voices with it.
    // Must run before captureComposeRecordingSample so this frame's samples carry
    // this frame's value.
    dynamics.tick(performance.now());
    performer.applyDynamicsToSoundingVoices();

    // Y auto-scroll while LMB held in Perform / Record so the user can drag
    // past the visible pitch range without releasing.
    performer.tickPerformYAutoScroll();

    // Per-frame pitch-mode tick — keeps Glide/Magnetic advancing toward the
    // current target even when the mouse is still. No-op when neither mode is
    // active or snap is off.
    performer.tickComposePitchMode();

    // Compose perform: record-sample capture each frame while armed + sounding + playing.
    performer.captureComposeRecordingSample();

    reconcileDrawingCurve();
  }

  /** Let go of a stale in-progress Draw curve. Checked once per frame, after
   *  input handlers have finished, rather than on each store change: a handler
   *  can pass through a moment where the selection doesn't match yet. Three cases:
   *    • the curve was deleted (e.g. undo)
   *    • the user selected a different single curve while in Draw — honor the
   *      new selection so the preview line and the next click both target it
   *    • the active tool isn't Draw anymore (hotkey switch bypasses the
   *      Draw-tool clear) */
  function reconcileDrawingCurve() {
    if (!interaction.drawingCurve) return;
    const state = store.getState();
    const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
    const singleSelectedId = store.getSelectedCurveId();
    const stale =
      !track ||
      !track.curves.includes(interaction.drawingCurve) ||
      state.activeTool !== 'draw' ||
      (singleSelectedId !== null && singleSelectedId !== interaction.drawingCurve.id);
    if (stale) {
      interaction.drawingCurve = null;
      interaction.dragging = null;
      requestRedraw();
    }
  }

  return {
    /** Start the loop. */
    start: () => { requestAnimationFrame(frame); },
    /** One frame, now (the dev harness drives frames with the tab hidden). */
    runFrame,
    keepable: keepable as ReadonlySignal<number>,
    toolsLocked: toolsLocked as ReadonlySignal<boolean>,
  };
}
