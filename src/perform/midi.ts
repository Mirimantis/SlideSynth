/**
 * Live MIDI input (BACKLOG 8.11, 8.25; split out of main.ts in 15.3): each
 * held key sounds its own voice (`midi-<note>`) on the armed track, or the
 * selected one; on an armed track while playing it also records, a curve per
 * note. The pitch wheel bends every held note. Settings › MIDI chooses the
 * device.
 */

import { signal } from '@preact/signals';
import { store } from '../state/store';
import { watch } from '../state/reactive';
import { createMidiInput } from '../audio/midi-input';
import { ensureResumed } from '../audio/engine';
import type { PreviewManager } from '../audio/preview';
import type { DynamicsBus } from '../audio/dynamics-bus';
import type { PlaybackEngine } from '../audio/playback';
import { CENTS_PER_SEMITONE, midiToCents } from '../constants';
import { markBgDirty } from '../app/redraw';
import { showToast } from '../ui/toast';
import { openMidiArmDialog } from '../ui/midi-arm-dialog';
import { addTrackWithPickedTone } from '../ui/track-actions';
import type { MidiDeviceInfo } from '../ui/settings-dialog';
import type { Performer } from './performer';

/** Pitch-wheel range: ±2 semitones (GM standard). RPN sniffing on the wire
 *  isn't worth doing — almost no controllers send it. */
const LIVE_BEND_RANGE_SEMITONES = 2;

export function createMidiPerformance(deps: {
  preview: PreviewManager;
  dynamics: DynamicsBus;
  playback: PlaybackEngine;
  performer: Performer;
  /** Keys held now, shared with the performer (the swell shapes them). */
  heldMidiNotes: Set<number>;
  /** Close the Settings dialog, so the arm dialog isn't stacked on it. */
  closeSettings(): void;
}) {
  const { preview, dynamics, playback, performer, heldMidiNotes } = deps;
  const composeEngine = performer.engine;
  const midiInput = createMidiInput();

  /** MIDI inputs for the Settings dialog, refreshed when devices come and go. */
  const devices = signal<readonly MidiDeviceInfo[]>([]);
  const activeId = signal<string | null>(null);

  // One-shot guard for the "you have MIDI but no track is armed" toast. Reset
  // when the user changes device or disarms a track, so the hint can fire again
  // the next time the user falls into the same state.
  let midiArmHintShown = false;

  function refreshDeviceList() {
    devices.value = midiInput.getDevices().map(d => ({ id: d.id, name: d.name || d.manufacturer || d.id }));
    activeId.value = midiInput.getActiveDeviceId();
  }
  midiInput.onDevicesChanged(refreshDeviceList);

  // Live pitch-bend state (8.25). The offset persists across loop wraps and
  // across noteOn/noteOff because it's just module state, so the held-key
  // planchette continues at the bent pitch through a wrap (mirrors 8.21).
  let liveBendCents = 0;

  midiInput.onPitchBend((value) => {
    liveBendCents = (value / 8192) * LIVE_BEND_RANGE_SEMITONES * CENTS_PER_SEMITONE;
    // Bending counts as activity for the perform-engine AFK gate, mirroring
    // noteOn/noteOff. A user holding a note and working the wheel is performing.
    composeEngine.markActivity(performance.now());
    // Audio: re-tune every active MIDI preview synth so what's heard tracks the
    // wheel. Visual + recording: planchette mutation drives both.
    for (const note of heldMidiNotes) {
      preview.updateDrawPitch(midiToCents(note) + liveBendCents, `midi-${note}`);
    }
    store.setMidiPitchBendOffset(liveBendCents);
    markBgDirty();
  });

  midiInput.onNoteOn((note, velocity) => {
    const state = store.getState();
    // When a track is MIDI-armed it owns the audio path so what you hear is
    // what gets recorded. Otherwise fall back to the selected track (existing
    // preview-only behavior).
    const targetTrackId = state.midiArmedTrackId ?? state.selectedTrackId;
    if (!targetTrackId) return;
    const track = state.composition.tracks.find(t => t.id === targetTrackId);
    if (!track) return;
    const tone = state.composition.toneLibrary.find(t => t.id === track.toneId);
    if (!tone) return;
    ensureResumed();
    // MIDI key press counts as activity for the perform-engine AFK gate, mirroring onLmbDown.
    composeEngine.markActivity(performance.now());
    // Per-note voice ID lets simultaneously-held notes sound in parallel.
    // Initial pitch reflects current bend so a key struck with the wheel held
    // off-centre starts at the bent pitch, no audible jump on the first frame.
    heldMidiNotes.add(note);
    preview.startDrawPreview(
      tone,
      midiToCents(note) + liveBendCents,
      `midi-${note}`,
      dynamics.getValue(`midi-${note}`),
    );
    // Velocity still unused: the dynamics bus owns loudness, and mapping velocity
    // into it is 11.2's job (where it becomes a proper bus source alongside CC).
    void velocity;

    // Safety-net hint: if MIDI is sounding but no track is armed, the user's
    // notes are not being recorded. Surface a once-per-episode toast pointing
    // at the "I" arm button. Reset paths: device change, disarm event.
    if (state.midiArmedTrackId === null && !midiArmHintShown) {
      showToast('MIDI received — arm a track (I) to record', 3500);
      midiArmHintShown = true;
    }

    // Recording (Phase 8.11): if the armed track AND playback are active, start
    // capturing this voice. A planchette in performance state both visualises the
    // held note on the rail and signals captureComposeRecordingSample to push a
    // sample each frame. Re-trigger before noteOff: finalize the in-flight voice
    // first so we don't lose its samples.
    if (state.midiArmedTrackId !== null && playback.isPlaying()) {
      const voiceId = `midi-${note}`;
      const existing = state.performance.planchettes.find(p => p.voiceId === voiceId);
      if (existing) performer.finalizeMidiVoice(note);
      // Apply current bend offset on creation so the planchette spawns at the
      // bent pitch if the wheel was already off-centre when the key was struck.
      const initialY = midiToCents(note) + liveBendCents;
      store.addPerformPlanchette({
        voiceId,
        trackId: state.midiArmedTrackId,
        cursorWorldY: initialY,
        snappedWorldY: initialY,
      });
      markBgDirty();
    }
  });

  midiInput.onNoteOff((note) => {
    // MIDI key release counts as activity for the perform-engine AFK gate.
    composeEngine.markActivity(performance.now());
    heldMidiNotes.delete(note);
    preview.stopDrawPreview(`midi-${note}`);
    // If this voice was recording, finalize the curve into the MIDI-armed track.
    // Safe to call unconditionally — finalizeMidiVoice no-ops if no planchette.
    performer.finalizeMidiVoice(note);
  });

  /** Settings › MIDI input device. */
  async function selectDevice(id: string | null) {
    if (id && !midiInput.hasAccess()) {
      const ok = await midiInput.requestAccess();
      refreshDeviceList();
      if (!ok) {
        showToast('MIDI access denied or unsupported by this browser', 3000);
        return;
      }
    }
    midiInput.setActiveDevice(id);
    activeId.value = midiInput.getActiveDeviceId();

    // Just enabled a device with no armed track — prompt the user before they
    // hit the silent-no-curves trap. The toast in noteOn is the safety net for
    // the case where they cancel here and play anyway. Settings closes first so
    // the arm dialog isn't stacked on it.
    if (id && store.getState().midiArmedTrackId === null) {
      midiArmHintShown = false;
      deps.closeSettings();
      await promptForMidiArm();
    }
  }

  async function promptForMidiArm() {
    const st = store.getState();
    const result = await openMidiArmDialog({
      tracks: st.composition.tracks,
      toneLibrary: st.composition.toneLibrary,
    });
    if (!result) return;
    if (result.kind === 'arm-existing') {
      store.setMidiArmedTrackId(result.trackId);
      return;
    }
    // 'arm-new' — same flow as the "+ Track" button, then arm.
    const track = await addTrackWithPickedTone(document.getElementById('add-track-btn')!);
    if (track) store.setMidiArmedTrackId(track.id);
  }

  // Reset the noteOn-toast gate on arm/disarm transitions only — not on every
  // store notify, or unrelated state changes would clobber the once-per-episode
  // behavior. While armed: suppress (hint is irrelevant). On disarm: re-enable
  // so the next time the user falls into the no-armed-track trap, the hint
  // fires again.
  watch(() => store.getState().midiArmedTrackId !== null, armed => { midiArmHintShown = armed; });

  // Populate the list lazily when the user first reaches for it — requesting
  // MIDI access earlier would trigger a permission prompt before they showed
  // intent.
  async function requestList() {
    if (midiInput.hasAccess() || !midiInput.isSupported()) return;
    const ok = await midiInput.requestAccess();
    if (ok) refreshDeviceList();
  }

  return {
    /** What the Settings dialog's MIDI section shows and does. */
    settings: {
      supported: midiInput.isSupported(),
      devices,
      activeId,
      requestList,
      select: (id: string | null) => { void selectDevice(id); },
    },
  };
}
