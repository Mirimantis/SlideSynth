import type { VoiceId, BezierCurve } from '../types';
import type { Viewport } from './viewport';
import type { PlaybackEngine } from '../audio/playback';
import type { PreviewManager } from '../audio/preview';
import { store } from '../state/store';
import { history } from '../state/history';
import { snapToGrid, getAdaptiveSubdivisions } from '../utils/snap';
import { getScaleById } from '../utils/scales';
import { getCompositionLength } from '../model/composition';
import { curveFromRecording, type RecordedSample } from '../model/curve';
import { getAudioContext, ensureResumed } from '../audio/engine';
import { PLANCHETTE_SCREEN_X_RATIO } from './planchette';
import { RULER_HEIGHT } from './interaction';

const PRIMARY_VOICE: VoiceId = 'primary';
const COUNTDOWN_SECONDS = 3;
const AFK_TIMEOUT_MS = 60_000;
const RECORDING_BUFFER_MAX = 3600; // ~1 minute at 60fps
const PLAY_END_BUFFER_BEATS = 10_000; // "effectively infinite" for recording without loop
const LOOP_WRAP_THRESHOLD_BEATS = 0.5; // position jump-backward detection

export interface GlissandographController {
  /** Called every frame from the render loop — drives scrolling viewport + countdown + recording. */
  tick(canvasWidth: number, canvasHeight: number): void;

  onMouseDown(e: MouseEvent, sx: number, sy: number, canvasWidth: number, canvasHeight: number): void;
  onMouseMove(e: MouseEvent, sx: number, sy: number, canvasWidth: number, canvasHeight: number): void;
  onMouseUp(e: MouseEvent): void;
  onMouseLeave(): void;

  startPlayback(): void;
  stop(): void;

  /** R key or Record button. Idle → countdown+armed. Playing → toggle armed mid-play. */
  toggleArmed(): void;

  /** True while phase !== 'idle'. */
  isActive(): boolean;

  /** True while scrolling playback is running. */
  isScrolling(): boolean;

  /** Countdown overlay label: '', '3', '2', '1', or 'Go'. */
  getCountdownLabel(): string;

  /** performance.now() of the last loop-wrap event; drives the planchette pulse. */
  getLastLoopWrapAt(): number;
}

export function createGlissandograph(
  viewport: Viewport,
  playback: PlaybackEngine,
  preview: PreviewManager,
  onViewportChanged: () => void,
): GlissandographController {
  let lmbDown = false;
  // Recording buffer, keyed by voice (MVP only writes to 'primary').
  const recBuffers = new Map<VoiceId, RecordedSample[]>();
  // Set true before the first curve committed in a session so we only snapshot once.
  let sessionHistorySnapshotted = false;
  // Track position across frames for loop-wrap detection.
  let lastTickBeat: number | null = null;
  let lastLoopWrapAt = 0;
  // Cached by tick(); used by beginPlayingPhase so it can compute the planchette world beat.
  let lastCanvasWidth = 0;

  function getPrimaryTrack() {
    const st = store.getState();
    const trackId = st.selectedTrackId;
    if (!trackId) return null;
    return st.composition.tracks.find(t => t.id === trackId) ?? null;
  }

  function getPrimaryTone() {
    const st = store.getState();
    const track = getPrimaryTrack();
    if (!track) return null;
    return st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null;
  }

  function computeCursorPitch(sy: number): { cursorWorldY: number; snappedWorldY: number } {
    const { wy } = viewport.screenToWorld(0, sy);
    const st = store.getState();
    const scale = st.scaleId ? getScaleById(st.scaleId) ?? null : null;
    const snapConfig = {
      enabled: st.snapEnabled,
      subdivisionsPerBeat: getAdaptiveSubdivisions(viewport.state.zoomX),
      scaleRoot: st.scaleRoot,
      scale,
    };
    const snapped = snapToGrid(0, wy, snapConfig);
    return { cursorWorldY: wy, snappedWorldY: snapped.wy };
  }

  function updatePlanchette(sy: number) {
    if (sy < RULER_HEIGHT) {
      store.setPlanchetteY(PRIMARY_VOICE, null, null);
      return;
    }
    const { cursorWorldY, snappedWorldY } = computeCursorPitch(sy);
    const st = store.getState();
    const prev = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    const prevSnapped = prev?.snappedWorldY ?? null;
    store.setPlanchetteY(PRIMARY_VOICE, cursorWorldY, snappedWorldY);
    if (prevSnapped != null && prevSnapped !== snappedWorldY) {
      store.markPlanchetteCrossed(PRIMARY_VOICE, Date.now());
    }
  }

  function planchetteBeat(canvasWidth: number): number {
    const screenX = canvasWidth * PLANCHETTE_SCREEN_X_RATIO;
    return viewport.screenToWorld(screenX, 0).wx;
  }

  function startSounding(canvasWidth: number) {
    const tone = getPrimaryTone();
    if (!tone) return;
    const st = store.getState();
    const planchette = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    if (!planchette || planchette.snappedWorldY == null) return;
    preview.startDrawPreview(tone, planchette.snappedWorldY, PRIMARY_VOICE);
    store.setGlissLmbSounding(true);
    // In idle, honour drawPreviewMode: 'composition' layers a scrub preview of all curves
    // at the planchette's current beat on top of the tone — so the user can hear the chord.
    if (st.glissandograph.phase === 'idle' && st.drawPreviewMode === 'composition') {
      preview.startScrubPreview(st.composition);
      preview.updateScrubPosition(planchetteBeat(canvasWidth), st.composition);
    }
  }

  function updateSounding() {
    const st = store.getState();
    const planchette = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    if (!planchette || planchette.snappedWorldY == null) return;
    if (preview.isDrawPreviewActive(PRIMARY_VOICE)) {
      preview.updateDrawPitch(planchette.snappedWorldY, PRIMARY_VOICE);
    }
    // Planchette X doesn't move on mousemove (only Y does), so no scrub position update.
  }

  function stopSounding() {
    preview.stopDrawPreview(PRIMARY_VOICE);
    if (preview.isScrubPreviewActive()) preview.stopScrubPreview();
    store.setGlissLmbSounding(false);
  }

  function scrollViewportToPlayhead(canvasWidth: number, canvasHeight: number) {
    const beat = playback.getPositionBeats();
    const planchetteScreenX = canvasWidth * PLANCHETTE_SCREEN_X_RATIO;
    viewport.state.offsetX = beat - planchetteScreenX / viewport.state.zoomX;
    const minOffsetX = -planchetteScreenX / viewport.state.zoomX;
    viewport.clampOffset(canvasWidth, canvasHeight, minOffsetX);
    onViewportChanged();
  }

  /** Add a frame sample to the recording buffer if we should be recording right now. */
  function captureRecordingSample() {
    const st = store.getState();
    const g = st.glissandograph;
    if (g.phase !== 'playing' || !g.recordArmed || !lmbDown) return;
    const planchette = g.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    if (!planchette || planchette.snappedWorldY == null) return;

    const buf = recBuffers.get(PRIMARY_VOICE) ?? [];
    const beat = playback.getPositionBeats();
    // Skip samples whose beat didn't advance (shouldn't happen, but defensive).
    const last = buf[buf.length - 1];
    if (last && beat <= last.beat) return;
    buf.push({ beat, note: planchette.snappedWorldY, volume: 0.8 });
    // Cap to avoid unbounded growth on very long holds.
    while (buf.length > RECORDING_BUFFER_MAX) buf.shift();
    recBuffers.set(PRIMARY_VOICE, buf);
    store.setGlissLastActivityAt(performance.now());
  }

  /** Commit the current primary buffer as a curve on the selected track. */
  function finalizeCurrentCurve() {
    const samples = recBuffers.get(PRIMARY_VOICE);
    if (!samples || samples.length < 2) {
      recBuffers.set(PRIMARY_VOICE, []);
      return;
    }
    const track = getPrimaryTrack();
    if (!track) {
      recBuffers.set(PRIMARY_VOICE, []);
      return;
    }
    const curve = curveFromRecording(samples);
    recBuffers.set(PRIMARY_VOICE, []);
    if (!curve) return;

    // One snapshot per recording session, taken lazily before the first commit.
    if (!sessionHistorySnapshotted) {
      history.snapshot();
      sessionHistorySnapshotted = true;
    }
    store.mutate(() => {
      track.curves.push(curve satisfies BezierCurve);
    });
    store.setGlissCurrentCurve(PRIMARY_VOICE, curve.id);
  }

  function beginPlayingPhase() {
    const st = store.getState();
    const comp = st.composition;
    const compLength = getCompositionLength(comp);
    const recording = st.glissandograph.recordArmed;
    const looping = playback.isLoopEnabled();

    // Start beat: whatever the planchette is hovering over right now.
    // Falls back to 0 on the first frame before tick() has run (no canvas width cached).
    const planchetteScreenX = lastCanvasWidth * PLANCHETTE_SCREEN_X_RATIO;
    let startBeat = lastCanvasWidth > 0
      ? Math.max(0, viewport.screenToWorld(planchetteScreenX, 0).wx)
      : Math.max(0, st.playback.positionBeats);

    // With Loop on: use the composition's loop markers as the play range.
    // Clamp startBeat into [loopStart, loopEnd] so wrap behaviour is predictable.
    // With Loop off + recording: extend end-of-range far past current content so
    // the canvas keeps scrolling during recording.
    let endBeat: number;
    let loopStart = 0;
    if (looping) {
      const lStart = comp.loopStartBeats;
      const lEnd = comp.loopEndBeats;
      if (startBeat < lStart || startBeat >= lEnd) startBeat = lStart;
      endBeat = lEnd;
      loopStart = lStart;
    } else if (recording) {
      endBeat = Math.max(compLength, startBeat) + PLAY_END_BUFFER_BEATS;
    } else {
      endBeat = Math.max(compLength, startBeat + 1);
    }

    playback.play(comp, startBeat, endBeat, loopStart);
    store.setPlaybackPosition(startBeat);
    store.setPlaybackState('playing');
    store.setGlissPhase('playing');
    store.setGlissLastActivityAt(performance.now());
    lastTickBeat = null;
  }

  return {
    tick(canvasWidth, canvasHeight) {
      lastCanvasWidth = canvasWidth;
      const st = store.getState();
      const g = st.glissandograph;

      // Countdown → playing transition
      if (g.phase === 'countdown') {
        const elapsed = getAudioContext().currentTime - g.countdownStartedAt;
        if (elapsed >= COUNTDOWN_SECONDS) {
          beginPlayingPhase();
        }
      }

      if (g.phase === 'playing' && playback.isPlaying()) {
        const beat = playback.getPositionBeats();
        // Loop-wrap detection: a backward jump > threshold means playback looped.
        // If we were recording, finalize the current curve so the next pass starts a fresh one.
        if (lastTickBeat != null && beat < lastTickBeat - LOOP_WRAP_THRESHOLD_BEATS) {
          lastLoopWrapAt = performance.now();
          if (g.recordArmed && lmbDown) {
            finalizeCurrentCurve();
          }
        }
        lastTickBeat = beat;

        scrollViewportToPlayhead(canvasWidth, canvasHeight);
        captureRecordingSample();

        // AFK auto-stop during recording
        if (g.recordArmed) {
          const now = performance.now();
          if (now - g.lastActivityAt > AFK_TIMEOUT_MS) {
            this.stop();
          }
        }
      }
    },

    onMouseDown(e, _sx, sy, w, _h) {
      if (e.button !== 0) return;
      if (sy < RULER_HEIGHT) return;
      updatePlanchette(sy);
      lmbDown = true;
      startSounding(w);
      // If recording, the first sample gets captured on the next tick.
    },

    onMouseMove(_e, _sx, sy, _w, _h) {
      updatePlanchette(sy);
      if (lmbDown) updateSounding();
    },

    onMouseUp(e) {
      if (e.button !== 0) return;
      if (!lmbDown) return;
      lmbDown = false;
      stopSounding();
      // If we were recording, finalize the current curve.
      const g = store.getState().glissandograph;
      if (g.phase === 'playing' && g.recordArmed) {
        finalizeCurrentCurve();
      } else {
        recBuffers.set(PRIMARY_VOICE, []);
      }
    },

    onMouseLeave() {
      // Keep sounding even if cursor leaves canvas while LMB held — window mouseup handles release.
    },

    startPlayback() {
      const st = store.getState();
      if (st.glissandograph.phase !== 'idle') return;
      beginPlayingPhase();
    },

    toggleArmed() {
      const st = store.getState();
      const g = st.glissandograph;
      if (g.phase === 'idle') {
        // Arm + start countdown. beginPlayingPhase() fires when countdown elapses.
        // ensureResumed() consumes the user gesture now (click/keypress) so the
        // audio context is running by the time countdown ends, 3 seconds later.
        ensureResumed();
        store.setGlissArmed(true);
        store.setGlissCountdownStartedAt(getAudioContext().currentTime);
        store.setGlissPhase('countdown');
        sessionHistorySnapshotted = false;
      } else if (g.phase === 'countdown') {
        // Cancel back to idle.
        store.setGlissArmed(false);
        store.setGlissCountdownStartedAt(0);
        store.setGlissPhase('idle');
      } else if (g.phase === 'playing') {
        // Toggle armed mid-play; no countdown.
        if (g.recordArmed) {
          // Disarming: finalize any in-progress curve.
          if (lmbDown) finalizeCurrentCurve();
          store.setGlissArmed(false);
        } else {
          store.setGlissArmed(true);
          sessionHistorySnapshotted = false;
          store.setGlissLastActivityAt(performance.now());
        }
      }
    },

    stop() {
      // If we're in the middle of recording a phrase, commit it before tearing down.
      const g = store.getState().glissandograph;
      if (g.phase === 'playing' && g.recordArmed && lmbDown) {
        finalizeCurrentCurve();
      }
      if (lmbDown) {
        lmbDown = false;
        stopSounding();
      }
      preview.stopDrawPreview(PRIMARY_VOICE);
      if (playback.isPlaying()) playback.stop();
      recBuffers.set(PRIMARY_VOICE, []);
      store.setGlissPhase('idle');
      store.setGlissArmed(false);
      store.setGlissCountdownStartedAt(0);
      store.setGlissLmbSounding(false);
      sessionHistorySnapshotted = false;
      lastTickBeat = null;
    },

    isActive() {
      return store.getState().glissandograph.phase !== 'idle';
    },

    isScrolling() {
      const phase = store.getState().glissandograph.phase;
      return phase === 'playing' && playback.isPlaying();
    },

    getCountdownLabel() {
      const g = store.getState().glissandograph;
      if (g.phase !== 'countdown') return '';
      const elapsed = getAudioContext().currentTime - g.countdownStartedAt;
      const remaining = COUNTDOWN_SECONDS - elapsed;
      if (remaining <= 0) return 'Go';
      if (remaining <= 1) return '1';
      if (remaining <= 2) return '2';
      return '3';
    },

    getLastLoopWrapAt() {
      return lastLoopWrapAt;
    },
  };
}
