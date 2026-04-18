import type { VoiceId } from '../types';
import type { Viewport } from './viewport';
import type { PlaybackEngine } from '../audio/playback';
import type { PreviewManager } from '../audio/preview';
import { store } from '../state/store';
import { snapToGrid, getAdaptiveSubdivisions } from '../utils/snap';
import { getScaleById } from '../utils/scales';
import { getCompositionLength } from '../model/composition';
import { PLANCHETTE_SCREEN_X_RATIO } from './planchette';
import { RULER_HEIGHT } from './interaction';

const PRIMARY_VOICE: VoiceId = 'primary';

export interface GlissandographController {
  /** Called every frame from the render loop — drives scrolling viewport + countdown. */
  tick(canvasWidth: number, canvasHeight: number): void;

  /** Mouse handlers — main.ts wires these only when activeMode === 'glissandograph'. */
  onMouseDown(e: MouseEvent, sx: number, sy: number, canvasWidth: number, canvasHeight: number): void;
  onMouseMove(e: MouseEvent, sx: number, sy: number, canvasWidth: number, canvasHeight: number): void;
  onMouseUp(e: MouseEvent): void;
  onMouseLeave(): void;

  /** Space / Play button → start scrolling play. */
  startPlayback(): void;

  /** Stop / Esc / mode switch → return to idle. */
  stop(): void;

  /** True while phase !== 'idle'. Drives pan/zoom guards elsewhere. */
  isActive(): boolean;

  /** True while scrolling playback is running. */
  isScrolling(): boolean;
}

export function createGlissandograph(
  viewport: Viewport,
  playback: PlaybackEngine,
  preview: PreviewManager,
  onViewportChanged: () => void,
): GlissandographController {
  let lmbDown = false;

  function getPrimaryTrack() {
    const st = store.getState();
    const trackId = st.selectedTrackId;
    if (!trackId) return null;
    const track = st.composition.tracks.find(t => t.id === trackId);
    return track ?? null;
  }

  function getPrimaryTone() {
    const st = store.getState();
    const track = getPrimaryTrack();
    if (!track) return null;
    const tone = st.composition.toneLibrary.find(t => t.id === track.toneId);
    return tone ?? null;
  }

  /** Compute world Y from screen Y, and the snap-applied world Y used for sounding/recording. */
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

  function updatePlanchette(sx: number, sy: number, canvasWidth: number) {
    // Planchette renders at a fixed screen X, but cursor Y drives pitch.
    // Ignore cursor X — the mouse only controls pitch in gliss mode.
    void sx; void canvasWidth;
    if (sy < RULER_HEIGHT) {
      // Cursor above the staff area — clamp to top of planchette track
      store.setPlanchetteY(PRIMARY_VOICE, null, null);
      return;
    }
    const { cursorWorldY, snappedWorldY } = computeCursorPitch(sy);
    // Snap-line crossing detection: if snappedWorldY changed since last frame, pulse.
    const st = store.getState();
    const prev = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    const prevSnapped = prev?.snappedWorldY ?? null;
    store.setPlanchetteY(PRIMARY_VOICE, cursorWorldY, snappedWorldY);
    if (prevSnapped != null && prevSnapped !== snappedWorldY) {
      store.markPlanchetteCrossed(PRIMARY_VOICE, Date.now());
    }
  }

  function startSounding() {
    const tone = getPrimaryTone();
    if (!tone) return;
    const st = store.getState();
    const planchette = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    if (!planchette || planchette.snappedWorldY == null) return;
    preview.startDrawPreview(tone, planchette.snappedWorldY, PRIMARY_VOICE);
    store.setGlissLmbSounding(true);
  }

  function updateSounding() {
    const st = store.getState();
    const planchette = st.glissandograph.planchettes.find(p => p.voiceId === PRIMARY_VOICE);
    if (!planchette || planchette.snappedWorldY == null) return;
    if (preview.isDrawPreviewActive(PRIMARY_VOICE)) {
      preview.updateDrawPitch(planchette.snappedWorldY, PRIMARY_VOICE);
    }
  }

  function stopSounding() {
    preview.stopDrawPreview(PRIMARY_VOICE);
    store.setGlissLmbSounding(false);
  }

  function scrollViewportToPlayhead(canvasWidth: number, canvasHeight: number) {
    const beat = playback.getPositionBeats();
    const planchetteScreenX = canvasWidth * PLANCHETTE_SCREEN_X_RATIO;
    viewport.state.offsetX = beat - planchetteScreenX / viewport.state.zoomX;
    // Allow offsetX to go negative up to the planchette offset so beat 0 aligns with the planchette.
    const minOffsetX = -planchetteScreenX / viewport.state.zoomX;
    viewport.clampOffset(canvasWidth, canvasHeight, minOffsetX);
    onViewportChanged();
  }

  return {
    tick(canvasWidth, canvasHeight) {
      const phase = store.getState().glissandograph.phase;
      if (phase === 'playing' && playback.isPlaying()) {
        scrollViewportToPlayhead(canvasWidth, canvasHeight);
      }
    },

    onMouseDown(e, sx, sy, canvasWidth, _canvasHeight) {
      if (e.button !== 0) return; // left mouse only
      if (sy < RULER_HEIGHT) return; // ruler band is reserved
      updatePlanchette(sx, sy, canvasWidth);
      lmbDown = true;
      startSounding();
    },

    onMouseMove(_e, sx, sy, canvasWidth, _canvasHeight) {
      updatePlanchette(sx, sy, canvasWidth);
      if (lmbDown) updateSounding();
    },

    onMouseUp(e) {
      if (e.button !== 0) return;
      if (!lmbDown) return;
      lmbDown = false;
      stopSounding();
    },

    onMouseLeave() {
      // Keep sounding even if cursor leaves canvas while LMB held — window mouseup handles release.
    },

    startPlayback() {
      const st = store.getState();
      if (st.glissandograph.phase === 'playing') return;
      const comp = st.composition;
      const compLength = getCompositionLength(comp);
      const startBeat = st.playback.positionBeats;
      // MVP: play from current position to composition end; looper mechanics come in Phase 3.
      const endBeat = Math.max(compLength, startBeat + 1);
      playback.play(comp, startBeat, endBeat, 0);
      store.setPlaybackState('playing');
      store.setGlissPhase('playing');
    },

    stop() {
      if (lmbDown) {
        lmbDown = false;
        stopSounding();
      }
      preview.stopDrawPreview(PRIMARY_VOICE);
      if (playback.isPlaying()) {
        playback.stop();
      }
      store.setGlissPhase('idle');
      store.setGlissLmbSounding(false);
    },

    isActive() {
      return store.getState().glissandograph.phase !== 'idle';
    },

    isScrolling() {
      const phase = store.getState().glissandograph.phase;
      return phase === 'playing' && playback.isPlaying();
    },
  };
}
