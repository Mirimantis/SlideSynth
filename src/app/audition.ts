/**
 * Hearing the composition without playing it (split out of main.ts in 15.3):
 * holding A (BACKLOG 16.6) and scrubbing the ruler.
 *
 * Space is Play/Pause only. Holding A auditions: in Draw, the pitch under the
 * cursor (with the composition too, per Draw Preview); while dragging a fret,
 * the fret's pitch (13.6). Scrubbing the ruler is audible on its own
 * (Settings › Audible scrub), so it needs no key.
 */

import { store } from '../state/store';
import { isRecordArmed } from '../state/transport';
import type { TransportState } from '../types';
import type { PreviewManager } from '../audio/preview';
import type { PlaybackEngine } from '../audio/playback';
import { RULER_HEIGHT, type Interaction } from '../canvas/interaction';
import { fretLinePitch } from '../model/frets';
import { resolveTuning } from '../tuning/tuning';
import { CIRCLE_AUDITION_VOICE } from '../ui/tuning-actions';
import type { Performer } from '../perform/performer';
import { requestRedraw } from './redraw';

/** Voice for a dragged fret's pitch — separate from the Draw voices. */
const GUIDE_AUDITION_VOICE = 'guide-audition';

/** The selected track's tone. */
export function activeTone() {
  const st = store.getState();
  const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
  return track ? st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null : null;
}

export function createAudition(deps: {
  preview: PreviewManager;
  interaction: Interaction;
  playback: PlaybackEngine;
  performer: Pick<Performer, 'startPrismDrawPreview' | 'updatePrismDrawPreview'>;
  effectiveScrollCanvas(): boolean;
  /** Centre the view on a beat. */
  scrollToBeat(beat: number): void;
  /** Resume playing from a beat, through the same range logic as Play. */
  playEngineFrom(t: TransportState, beat: number): boolean;
}) {
  const { preview, interaction, playback, performer, effectiveScrollCanvas } = deps;

  /** The Draw preview (A held in Draw) is sounding. */
  let previewActive = false;
  let auditionHeld = false;
  let scrubWasPlaying = false;
  // True while a ruler-drag is driving the scrub preview, so we can stop it cleanly on release
  // without interfering with a hold-A audition.
  let rulerScrubPreviewActive = false;

  function setPreviewActive(on: boolean): void {
    previewActive = on;
    requestRedraw(); // the free planchette appears / disappears
  }

  /** Stop the Draw preview, if it's sounding: a tool change, Perform, or
   *  playback takes over. */
  function endPreview(): void {
    if (previewActive) { preview.stopAll(); setPreviewActive(false); }
  }

  function start() {
    auditionHeld = true;
    sync();
  }

  function stop() {
    auditionHeld = false;
    endPreview();
    if (preview.isDrawPreviewActive(GUIDE_AUDITION_VOICE)) preview.stopDrawPreview(GUIDE_AUDITION_VOICE);
  }
  // A's keyup never arrives while the window is unfocused; don't leave it sounding.
  window.addEventListener('blur', () => {
    if (auditionHeld) stop();
    if (preview.isDrawPreviewActive(CIRCLE_AUDITION_VOICE)) preview.stopDrawPreview(CIRCLE_AUDITION_VOICE);
  });

  /** Keep what's sounding in step with what A is held over. Runs on press and
   *  every frame while held, so the audition picks up a guide drag that starts
   *  mid-hold, or the cursor coming back onto the canvas. Nothing sounds while
   *  a recording is armed: the take owns the audio. */
  function sync() {
    if (!auditionHeld) return;
    const st = store.getState();
    if (isRecordArmed(st.transport)) return;

    // A dragged fret sounds its own pitch.
    const guide = interaction.draggingGuideId
      ? st.composition.guides.find(g => g.id === interaction.draggingGuideId)
      : undefined;
    const tone = activeTone();
    if (guide?.orientation === 'y' && tone) {
      // The line being dragged: one of an octave fret's, or the fret itself.
      const pitch = fretLinePitch(guide, interaction.draggingGuideLine, resolveTuning(st.tuning).period);
      if (preview.isDrawPreviewActive(GUIDE_AUDITION_VOICE)) preview.updateDrawPitch(pitch, GUIDE_AUDITION_VOICE);
      else preview.startDrawPreview(tone, pitch, GUIDE_AUDITION_VOICE);
      return;
    }
    if (preview.isDrawPreviewActive(GUIDE_AUDITION_VOICE)) preview.stopDrawPreview(GUIDE_AUDITION_VOICE);

    // In Draw, the cursor's pitch. cursorMoved retunes it as the cursor moves.
    if (previewActive) return;
    const inDrawContext = st.activeTool === 'draw'
      && !st.performMode
      && interaction.cursorInCanvas
      && interaction.cursorScreenY >= RULER_HEIGHT
      && interaction.cursorWorld !== null;
    if (inDrawContext) {
      if (st.drawPreviewMode === 'composition' && interaction.cursorWorld) {
        preview.startScrubPreview(st.composition);
        preview.updateScrubPosition(interaction.cursorWorld.x, st.composition);
        if (tone) performer.startPrismDrawPreview(tone, interaction.cursorWorld.y);
        setPreviewActive(true);
        // Page view: snap the playhead to the cursor so the user sees the scrub
        // location. Leaves it there on preview end (easy way to summon a far-away playhead).
        if (!effectiveScrollCanvas()) {
          store.setPlaybackPosition(Math.max(0, interaction.cursorWorld.x));
        }
      } else if (tone && interaction.cursorWorld) {
        performer.startPrismDrawPreview(tone, interaction.cursorWorld.y);
        setPreviewActive(true);
      }
    }
  }

  /** The cursor moved over the canvas: the Draw preview follows it. */
  function cursorMoved(worldX: number, worldY: number) {
    if (!previewActive) return;
    if (preview.isDrawPreviewActive()) {
      performer.updatePrismDrawPreview(worldY);
    }
    if (preview.isScrubPreviewActive() && store.getState().activeTool === 'draw') {
      preview.updateScrubPosition(worldX, store.getComposition());
      // Classic static-playhead mode: move the playhead to follow the cursor while
      // composition preview is active, giving visual feedback that we're scrubbing
      // the whole canvas. The playhead stays wherever it last was when preview ends
      // — also a handy way to summon a far-away playhead.
      if (!effectiveScrollCanvas() && !playback.isPlaying()) {
        store.setPlaybackPosition(Math.max(0, worldX));
      }
    }
  }

  function cursorLeft() {
    if (previewActive && store.getState().activeTool === 'draw') {
      preview.stopAll();
      setPreviewActive(false);
    }
  }

  /** A drag on the ruler moves the playhead; playback pauses meanwhile and
   *  resumes from where it's let go. */
  function rulerScrub(beats: number, phase: 'start' | 'move' | 'end') {
    // Rail view: the scrubbed beat slides under the fixed rail as you drag
    // (BACKLOG 16.2), so there the playhead always is the rail beat.
    if (effectiveScrollCanvas()) deps.scrollToBeat(beats);
    if (phase === 'start') {
      scrubWasPlaying = playback.isPlaying();
      if (scrubWasPlaying) {
        playback.pause();
      }
      store.setPlaybackPosition(beats);
      // Audible ruler-scrub: play the whole composition at the playhead so the user
      // can hear what's under the cursor as they drag. Skip while Record is armed
      // (the armed session already owns audio).
      if (store.getState().audibleScrub && !isRecordArmed(store.getState().transport) && !preview.isScrubPreviewActive()) {
        preview.startScrubPreview(store.getComposition());
        preview.updateScrubPosition(beats, store.getComposition());
        rulerScrubPreviewActive = true;
      }
    } else if (phase === 'move') {
      store.setPlaybackPosition(beats);
      if (preview.isScrubPreviewActive()) {
        preview.updateScrubPosition(beats, store.getComposition());
      }
    } else {
      store.setPlaybackPosition(beats);
      if (rulerScrubPreviewActive) {
        preview.stopScrubPreview();
        rulerScrubPreviewActive = false;
      }
      // Resume through the same range logic as Play, so a scrub during
      // looped playback keeps looping.
      if (scrubWasPlaying) deps.playEngineFrom(store.getState().transport, beats);
    }
  }

  return {
    /** The Draw preview is sounding (the scene draws its free planchette). */
    isPreviewing: () => previewActive,
    endPreview,
    /** A pressed. */
    start,
    /** A released. */
    stop,
    /** Each frame. */
    sync,
    cursorMoved,
    cursorLeft,
    rulerScrub,
  };
}

export type Audition = ReturnType<typeof createAudition>;
