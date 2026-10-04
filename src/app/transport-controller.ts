/**
 * The transport controller (BACKLOG 15.2; split out of main.ts in 15.3).
 *
 * Every transport change goes through `transport(event)`: the pure state
 * machine in state/transport.ts picks the next state, the store takes it, and
 * the effects do what the change means for audio, capture and the view.
 * Buttons, hotkeys, the count-in, loop wraps, the AFK timer and the playback
 * engine running out all dispatch events rather than setting flags.
 */

import { store } from '../state/store';
import { TRANSPORT_STOPPED, transition, isRolling, isCapturing, type TransportEvent } from '../state/transport';
import type { TransportState } from '../types';
import { ensureResumed, getAudioContext } from '../audio/engine';
import type { PlaybackEngine } from '../audio/playback';
import type { PreviewManager } from '../audio/preview';
import type { DynamicsBus } from '../audio/dynamics-bus';
import type { Performer } from '../perform/performer';
import type { Viewport } from '../canvas/viewport';
import { scrollViewportToBeat } from '../canvas/scrolling-play';
import { getCompositionLength } from '../model/composition';
import { OPEN_END_BEAT } from '../constants';
import { showToast } from '../ui/toast';
import { markBgDirty } from './redraw';

export interface TransportControllerDeps {
  playback: PlaybackEngine;
  performer: Performer;
  preview: PreviewManager;
  dynamics: DynamicsBus;
  viewport: Viewport;
  canvasContainer: HTMLElement;
  /** Stop a hold-A audition if one is sounding: playback takes the audio. */
  endAudition(): void;
  effectiveScrollCanvas(): boolean;
  /** The beat under the rail. */
  railBeat(): number;
  /** Enter or leave Perform; false if refused. */
  setPerformMode(on: boolean): boolean;
}

export function createTransportController(deps: TransportControllerDeps) {
  const { playback, performer, preview, dynamics, viewport, canvasContainer } = deps;
  const composeEngine = performer.engine;

  /** True while `transport()` applies a change — see the playback engine's
   *  position callback. */
  let applyingTransport = false;

  function transport(event: TransportEvent): void {
    const prev = store.getState().transport;
    const next = transition(prev, event);
    if (next === prev) return;
    // Commit first: the effects (and anything they trigger) read the new mode.
    store.setTransport(next);
    applyingTransport = true;
    try {
      applyTransportEffects(prev, next, event);
    } finally {
      applyingTransport = false;
    }
  }

  function applyTransportEffects(prev: TransportState, next: TransportState, event: TransportEvent): void {
    switch (next.mode) {
      case 'stopped':
        endPerformSession(prev);
        return;
      case 'paused':
        playback.pause();
        return;
      case 'countdown':
        ensureResumed();
        composeEngine.startSession(performance.now());
        return;
      case 'playing':
        break;
    }

    if (prev.mode !== 'playing') {
      // Starting to roll: from stopped, paused, or the end of a count-in.
      ensureResumed();
      if (!startRolling(next)) {
        store.setTransport(TRANSPORT_STOPPED);
        endPerformSession(next);
        return;
      }
      composeEngine.startSession(performance.now());
      performer.resetLayerSession();
      if (next.capture === 'pass-recording') showToast('Recording this pass', 1500);
      return;
    }

    // Already rolling: the clock or capture changed. The play-range watch in
    // main.ts re-opens the range for open-ended plays and recordings.
    if (prev.clock !== next.clock) {
      // Entering Perform opens a running playback's clock: a fresh session, so
      // its idle timer starts now and the next pass opens a new layer.
      ensureResumed();
      composeEngine.startSession(performance.now());
      performer.resetLayerSession();
    }
    if (next.capture === 'armed' && prev.capture !== 'armed') {
      ensureResumed();
      composeEngine.startSession(performance.now());
    }
    if (next.capture === 'pass-queued' && prev.capture === 'none') {
      composeEngine.startSession(performance.now());
      showToast('Armed — recording starts at the loop point', 2500);
    }
    if (event.type === 'loop-wrap') {
      if (next.capture === 'pass-recording') showToast('Recording this pass', 1500);
      else if (prev.capture === 'pass-recording') showToast('Pass recorded', 2000);
    }
    if (event.type === 'toggle-pass-record' && next.capture === 'none') {
      // Cancelling a pass commits whatever it already captured, like stopping
      // an ordinary recording.
      if (prev.capture === 'pass-recording') {
        if (composeEngine.isLmbDown()) performer.finalizeComposeRecordedCurves();
        performer.finalizeAllInFlightMidiVoices({ keepPlanchette: true });
        performer.sealFingerTakes(true);
      }
      showToast('Pass record cancelled', 2000);
    }
  }

  /** The engine's play range `[wrapTo, end]` for a rolling transport. Loop on:
   *  the loop markers. Loop off: plain Play ends with the content; Play in
   *  Perform and every kind of capture keep scrolling open-ended. */
  function playRangeFor(t: TransportState): [number, number] {
    const st = store.getState();
    const c = st.composition;
    if (st.loopEnabled) return [c.loopStartBeats, c.loopEndBeats];
    const openEnded = t.clock === 'open' || t.capture !== 'none';
    return [0, openEnded ? OPEN_END_BEAT : getCompositionLength(c)];
  }

  /** Run the engine from `pos` for transport `t` — pulled into the loop when
   *  Loop is on. False if the engine declined (empty or inverted range). */
  function playEngineFrom(t: TransportState, pos: number): boolean {
    const st = store.getState();
    const [wrapTo, end] = playRangeFor(t);
    const startBeat = st.loopEnabled && (pos < wrapTo || pos >= end) ? wrapTo : pos;
    playback.play(st.composition, startBeat, end, wrapTo);
    return playback.isPlaying();
  }

  /**
   * Start the transport for a session that's beginning to roll. Play starts where
   * the user is looking: under the rail in the scrolling view, else at the stored
   * playhead. A loop pass always starts at loop-in so the pass is whole. Returns
   * false if the engine declined.
   */
  function startRolling(next: TransportState): boolean {
    deps.endAudition();
    const st = store.getState();
    const pos = next.capture === 'pass-recording'
      ? st.composition.loopStartBeats
      : deps.effectiveScrollCanvas() ? deps.railBeat() : st.playback.positionBeats;
    if (!playEngineFrom(next, pos)) {
      if (next.capture === 'pass-recording') showToast('Set a loop range first', 2500);
      return false;
    }
    // Snap the viewport on the first frame of scrolling playback so there's no
    // flash of the old static offset before the render loop takes over.
    if (deps.effectiveScrollCanvas()) {
      const r = canvasContainer.getBoundingClientRect();
      scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
      markBgDirty();
    }
    return true;
  }

  /** Tear down whatever session `prev` was running: commit what it captured,
   *  silence it, and stop the transport. */
  function endPerformSession(prev: TransportState): void {
    // Seal in-flight phrases before teardown so a gesture interrupted by Stop
    // stays keepable (the buffer survives the session — BACKLOG 10.2).
    performer.closeLmbPhrases();
    if (isCapturing(prev) && composeEngine.isLmbDown()) {
      performer.finalizeComposeRecordedCurves();
    }
    // Finalize any in-flight MIDI voices before tearing down — otherwise their
    // buffers would be discarded by composeEngine.stopSession() below.
    performer.finalizeAllInFlightMidiVoices();
    // Extra fingers (13.33) too; they play again once lifted and put back.
    performer.releaseAllFingers(isCapturing(prev));
    if (composeEngine.isLmbDown()) {
      performer.stopComposePerformSounding();
    }
    preview.stopDrawPreview('primary');
    playback.stop();
    composeEngine.stopSession();
    // The next session starts from rest, not from wherever the swell was left.
    dynamics.reset();
    performer.resetLayerSession();
    store.setPerformLmbSounding(false);
  }

  /** Play from stopped or paused. In Perform the clock is open-ended: it runs
   *  until you stop it, which is what Jam used to be (BACKLOG 16.2). */
  function play(): void {
    transport({ type: 'play', openEnded: store.getState().performMode });
  }

  /** Space: pause playback (a recording stops instead), cancel a count-in, or
   *  start playing. */
  function playPause() {
    const t = store.getState().transport;
    if (isRolling(t)) transport({ type: 'pause' });
    else if (t.mode === 'countdown') transport({ type: 'escape' });
    else play();
  }

  /** R / the Record button. Needs a track to record onto. */
  function toggleRecord(): void {
    if (store.getState().selectedTrackId === null) return;
    // Recording is a performance: it enters Perform (BACKLOG 16.2).
    if (!deps.setPerformMode(true)) return;
    transport({ type: 'toggle-record', audioNow: getAudioContext().currentTime, countIn: store.getState().countInEnabled });
  }

  /** Shift+R / Shift+click Record: record exactly the next full loop pass
   *  (BACKLOG 10.5) — the structured counterpart to retrospective keep. */
  function toggleRecordNextPass(): void {
    const st = store.getState();
    const t = st.transport;
    const cancelling = t.capture === 'pass-queued' || t.capture === 'pass-recording';
    if (!cancelling) {
      if (st.selectedTrackId === null) return;
      if (isRolling(t) && t.capture === 'armed') {
        showToast('Already recording — press R to stop', 2000);
        return;
      }
      // A "pass" is defined by the loop, so turn Loop on rather than refusing —
      // but say so, since it changes the transport out from under the user.
      if (!st.loopEnabled) {
        store.setLoopEnabled(true);
        showToast('Record next Pass: Loop On', 2000);
      }
      if (!deps.setPerformMode(true)) return;
    }
    transport({ type: 'toggle-pass-record' });
  }

  return {
    transport,
    play,
    playPause,
    /** Restart the engine from `pos` for a rolling transport (after a ruler
     *  scrub): through the same range logic as Play, so a looped playback keeps looping. */
    playEngineFrom,
    /** A transport change is being applied (see the engine's position callback). */
    isApplying: () => applyingTransport,
    playRangeFor,
    toggleRecord,
    toggleRecordNextPass,
  };
}

export type TransportController = ReturnType<typeof createTransportController>;
