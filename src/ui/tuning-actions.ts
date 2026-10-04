/**
 * What the Tuning drawer's controls do (BACKLOG 13.8, 8.27; split out of
 * main.ts in 15.3), and keeping the audio's reference pitch in step with the
 * composition's Tune A4.
 */

import { store } from '../state/store';
import { history } from '../state/history';
import { watch } from '../state/reactive';
import { isRecordArmed } from '../state/transport';
import { setReferenceAHz, centsToReferenceAHz, referenceAHzToCents } from '../constants';
import { downloadFile, openTextFile, FileTooLargeError } from '../export/json-export';
import { MAX_SCL_BYTES, SclError, parseScl, toScl } from '../tuning/scl';
import { MAX_SCALE_FRETS } from '../tuning/frets-scale';
import { markBgDirty } from '../app/redraw';
import { showToast } from './toast';
import type { PreviewManager } from '../audio/preview';
import type { ToneDefinition } from '../types';
import type { TuningActions } from './tuning-panel';

/** Voice for a pitch-circle degree held down in the Tuning drawer (13.8 (c)). */
export const CIRCLE_AUDITION_VOICE = 'circle-audition';

/**
 * Tune A4 (8.27) pitch-shifts the entire staff by changing the reference
 * frequency for A4. It's stored as a cents offset from A=440 in the
 * composition; the audio module's reference A4 is what noteToFrequency reads.
 * This keeps the two in step: on startup, composition load, undo / redo and
 * edits.
 */
export function syncTuningToAudio(): void {
  watch(() => store.getComposition().tuningOffsetCents, cents => {
    setReferenceAHz(centsToReferenceAHz(cents));
    // Pitch HUD reads frequency on render — mark dirty so any open HUD reflects
    // the new tuning on the next frame.
    markBgDirty();
  });
}

/** The Tuning drawer's edits: each is one undo step. */
export function createTuningActions(deps: {
  preview: PreviewManager;
  /** The selected track's tone, for the pitch circle's press-to-hear. */
  activeTone(): ToneDefinition | null;
}): TuningActions {
  const { preview } = deps;
  return {
    setTuning(ref) { history.snapshot(); store.setTuning(ref); },
    setRoot(degree) { history.snapshot(); store.setRoot(degree); },
    setScale(scaleId) { history.snapshot(); store.setScaleId(scaleId); },
    toggleScaleDegree(degree) { history.snapshot(); store.toggleScaleDegree(degree); },
    audition(cents) {
      // The pitch circle's press-to-hear (13.8 (c)). Nothing sounds while a
      // recording is armed: the take owns the audio.
      const tone = deps.activeTone();
      if (cents === null || !tone || isRecordArmed(store.getState().transport)) {
        if (preview.isDrawPreviewActive(CIRCLE_AUDITION_VOICE)) preview.stopDrawPreview(CIRCLE_AUDITION_VOICE);
        return;
      }
      if (preview.isDrawPreviewActive(CIRCLE_AUDITION_VOICE)) preview.updateDrawPitch(cents, CIRCLE_AUDITION_VOICE);
      else preview.startDrawPreview(tone, cents, CIRCLE_AUDITION_VOICE);
    },
    setTunedFrom(pc) { history.snapshot(); store.setTunedFrom(pc); },
    setPitchLinesVisible(visible) { history.snapshot(); store.setPitchLinesVisible(visible); },
    setFretsVisible(visible) { store.setFretsVisible(visible); markBgDirty(); },
    setReferenceLines(visible) { history.snapshot(); store.setReferenceLines(visible); },
    async importScl() {
      let file: { name: string; text: string };
      try {
        file = await openTextFile('.scl', MAX_SCL_BYTES);
      } catch (e) {
        if (e instanceof FileTooLargeError) showToast('That file is too large to be a .scl tuning.', 4000);
        return;
      }
      try {
        const ref = parseScl(file.text, file.name);
        history.snapshot();
        store.importTuning(ref);
        showToast(`Imported ${ref.name}: ${ref.degrees.length} notes.`);
      } catch (e) {
        if (!(e instanceof SclError)) throw e;
        showToast(`Couldn't read ${file.name}: ${e.message}.`, 5000);
      }
    },
    exportScl() {
      const { text, fileName } = toScl(store.getState());
      downloadFile(text, fileName, 'text/plain');
    },
    scaleToFrets() {
      history.snapshot();
      const added = store.addScaleFrets();
      if (added === null) {
        history.dropLastSnapshot();
        showToast(`That's too many notes for frets (${MAX_SCALE_FRETS} at most). Choose a scale first.`, 4000);
      } else if (added === 0) {
        history.dropLastSnapshot();
        showToast('Every note of the scale already has an octave fret.');
      } else {
        showToast(`${added} octave frets added, and pitch lines turned off: the frets are the grid now. Drag them to tune by ear (hold A to hear).`, 5000);
      }
      markBgDirty();
    },
    fretsToScale() {
      history.snapshot();
      const result = store.applyFretsAsScale();
      if (!result) {
        history.dropLastSnapshot();
        showToast('There are no octave frets to make a scale from.');
        return;
      }
      showToast(result.kind === 'tuning'
        ? `The octave frets are now a tuning of their own, "From frets": not all of them were on the tuning's notes.`
        : 'The octave frets are now the scale.', 5000);
      markBgDirty();
    },
    setReferenceHz(hz) {
      const cents = referenceAHzToCents(hz);
      if (Math.abs(cents - store.getComposition().tuningOffsetCents) < 1e-6) return;
      history.snapshot();
      store.setTuningOffsetCents(cents);
    },
  };
}
