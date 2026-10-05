/**
 * What the track list's controls do (the list itself is ui/track-list.tsx),
 * and what the "+ Track" and "+ Tone" buttons under it do (split out of
 * main.ts in 15.3). Each action looks its track up by id when it runs: an
 * undo swaps in new objects.
 */

import { store } from '../state/store';
import { history } from '../state/history';
import { createTrack } from '../model/track';
import type { Track } from '../types';
import { rebuildTransformBox, type Interaction } from '../canvas/interaction';
import type { Performer } from '../perform/performer';
import { openToneBuilder } from './tone-builder';
import { openTonePicker } from './tone-picker';
import { showToast } from './toast';
import type { TrackListActions } from './track-list';

/** Pick a tone (anchored to `anchor`) and add a track with it, selected, as
 *  one undo step. Null if the picker was cancelled. */
export async function addTrackWithPickedTone(anchor: HTMLElement): Promise<Track | null> {
  const comp = store.getComposition();
  const picked = await openTonePicker(comp.toneLibrary, null, anchor);
  if (!picked) return null;
  history.snapshot();
  const track = createTrack(`Track ${comp.tracks.length + 1}`, picked.id);
  store.mutate(c => { c.tracks.push(track); });
  store.setSelectedTrack(track.id);
  return track;
}

export function createTrackListActions(deps: { interaction: Interaction; performer: Performer }): TrackListActions {
  const { interaction, performer } = deps;
  return {
    select(trackId) {
      const track = store.getComposition().tracks.find(t => t.id === trackId);
      if (!track) return;
      store.setSelectedTrack(trackId);
      // Select all curves in this track. The tool stays as it is (14.2); the
      // transform box belongs to Select, so it's built only there.
      if (track.curves.length > 0) {
        store.setSelectedCurves(track.curves.map(c => c.id));
        if (store.getState().activeTool === 'select') rebuildTransformBox(interaction, track);
      }
    },
    toggleMute(trackId) {
      history.snapshot();
      store.mutate(c => {
        const t = c.tracks.find(tt => tt.id === trackId);
        if (t) t.muted = !t.muted;
      });
    },
    toggleSolo(trackId) {
      history.snapshot();
      store.mutate(c => {
        const t = c.tracks.find(tt => tt.id === trackId);
        if (t && !t.guide) t.solo = !t.solo;
      });
    },
    toggleHidden(trackId) {
      history.snapshot();
      const t = store.getComposition().tracks.find(tt => tt.id === trackId);
      store.setTrackHidden(trackId, !t?.hidden);
      // A hidden track's curves can't stay selected under a transform box.
      if (store.getState().selectedTrackId === trackId && t?.hidden) interaction.transformBox = null;
    },
    toggleGuide(trackId) {
      history.snapshot();
      store.setTrackGuide(trackId, !store.getComposition().tracks.find(t => t.id === trackId)?.guide);
    },
    toggleMidiArm(trackId) {
      const current = store.getState().midiArmedTrackId;
      // Switching or disarming while notes are held: finalize those voices first
      // so their samples aren't orphaned by the arm change.
      if (current !== null) performer.finalizeAllInFlightMidiVoices();
      store.setMidiArmedTrackId(current === trackId ? null : trackId);
    },
    editTone(trackId) {
      const comp = store.getComposition();
      const track = comp.tracks.find(t => t.id === trackId);
      const currentTone = track && comp.toneLibrary.find(t => t.id === track.toneId);
      if (!currentTone) return;
      openToneBuilder(currentTone).then(result => {
        if (result.action !== 'save') return;
        history.snapshot();
        store.mutate(c => {
          const idx = c.toneLibrary.findIndex(t => t.id === result.tone.id);
          if (idx >= 0) c.toneLibrary[idx] = result.tone;
        });
      });
    },
    pickTone(trackId, anchor) {
      const comp = store.getComposition();
      const track = comp.tracks.find(t => t.id === trackId);
      if (!track) return;
      openTonePicker(comp.toneLibrary, track.toneId, anchor).then(picked => {
        if (!picked) return;
        history.snapshot();
        store.mutate(c => {
          const live = c.tracks.find(t => t.id === trackId);
          if (live) live.toneId = picked.id;
        });
      });
    },
    remove(trackId) {
      const track = store.getComposition().tracks.find(t => t.id === trackId);
      if (!track) return;
      // In-flight MIDI voices on this track would otherwise keep capturing into
      // a track that no longer exists.
      if (store.getState().midiArmedTrackId === trackId) performer.finalizeAllInFlightMidiVoices();
      history.snapshot();
      // If the current layer lived here, clear it so the next pass opens a new one.
      performer.forgetTrack(trackId);
      store.removeTrack(trackId);
      showToast(`Deleted ${track.name} — Ctrl+Z to restore`, 2500);
    },
  };
}

/** "+ Tone": build a new tone and add it to the library, as one undo step. */
export async function newTone(): Promise<void> {
  const result = await openToneBuilder();
  if (result.action !== 'save') return;
  history.snapshot();
  store.mutate(c => { c.toneLibrary.push(result.tone); });
}
