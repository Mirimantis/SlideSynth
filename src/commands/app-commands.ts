/**
 * What each command in the catalog (commands/catalog.ts) does (BACKLOG 15.3;
 * split out of main.ts). The keyboard, buttons and menus all run commands
 * through the registry, so a key and the button for the same action can't
 * drift apart. Edit commands live in edit-commands.ts.
 */

import type { CommandId } from './catalog';
import type { CommandHandler } from './registry';
import { createEditCommands } from './edit-commands';
import { store } from '../state/store';
import { history } from '../state/history';
import { isCapturing } from '../state/transport';
import { markBgDirty } from '../app/redraw';
import type { TransportController } from '../app/transport-controller';
import type { Interaction } from '../canvas/interaction';
import type { Viewport } from '../canvas/viewport';
import type { PlaybackEngine } from '../audio/playback';
import type { DynamicsBus } from '../audio/dynamics-bus';
import type { Performer } from '../perform/performer';
import { pitchPoints } from '../model/curve';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from '../export/json-export';
import { midiToComposition } from '../export/midi-import';
import { exportWav } from '../export/wav-export';
import { canFullscreen, fullscreenOn, toggleFullscreen } from '../ui/fullscreen';
import type { Composition, ToolMode } from '../types';

export interface AppCommandDeps {
  interaction: Interaction;
  viewport: Viewport;
  playback: PlaybackEngine;
  performer: Performer;
  dynamics: DynamicsBus;
  transport: TransportController;
  /** Centre the view on a beat. */
  scrollToBeat(beat: number): void;
  /** Hold A. */
  startAudition(): void;
  stopAudition(): void;
  /** Enter or leave Perform; false if refused. */
  setPerformMode(on: boolean): boolean;
  /** A tool button or its key; in Perform, also how you go back to editing. */
  chooseTool(tool: ToolMode): void;
  isComposePerformActive(): boolean;
  effectiveScrollCanvas(): boolean;
  /** The beat under the rail. */
  railBeat(): number;
  toggleScrollDuringPlayback(): void;
  openSettings(): void;
}

export function createAppCommands(deps: AppCommandDeps): Record<CommandId, CommandHandler> {
  const { interaction, viewport, playback, performer, dynamics, scrollToBeat } = deps;
  const { transport } = deps.transport;
  const composeEngine = performer.engine;

  /** Escape backs out one level: a count-in or recording first; then Perform;
   *  otherwise the edit in progress (transform box, or the curve being drawn)
   *  and Prism projection. */
  function escapeCommand() {
    const before = store.getState().transport;
    transport({ type: 'escape' });
    if (store.getState().transport !== before) return;
    if (deps.isComposePerformActive()) {
      deps.setPerformMode(false);
      return;
    }
    if (interaction.transformBox) interaction.dismissTransformBox();
    else if (store.getState().activeTool === 'draw' && interaction.hasDrawTarget()) interaction.finishDrawing();
    if (store.getState().harmonicPrism.projectionSourceId) store.setPrismProjectionSource(null);
  }

  /** Ctrl+H: project from the selected curve, or turn projection off. */
  function toggleProjection() {
    if (store.getState().harmonicPrism.projectionSourceId) {
      store.setPrismProjectionSource(null);
      return;
    }
    const sel = store.getSelectedCurveId();
    if (sel) store.setPrismProjectionSource(sel);
  }

  /** First or last control point across all tracks, or null on an empty canvas. */
  function compositionEdge(edge: 'start' | 'end'): number | null {
    let best: number | null = null;
    for (const track of store.getComposition().tracks) {
      for (const curve of track.curves) {
        for (const pt of pitchPoints(curve)) {
          const x = pt.position.x;
          if (best === null || (edge === 'start' ? x < best : x > best)) best = x;
        }
      }
    }
    return best;
  }

  /** Paste lands at the playhead. In the rail view while stopped, the rail is
   *  what reads as "here" — the stored playhead can lag behind a manual pan. */
  function pasteBeat(): number {
    const st = store.getState();
    return deps.effectiveScrollCanvas() && !playback.isPlaying() ? deps.railBeat() : st.playback.positionBeats;
  }

  /** Load a whole composition (file open, MIDI import) as one undoable step. */
  function replaceComposition(comp: Composition) {
    // Stop first so anything a running session captured commits into the
    // composition the undo snapshot below preserves.
    transport({ type: 'stop' });
    history.snapshot();
    store.loadComposition(comp);
  }

  const notWhilePerforming = () => !deps.isComposePerformActive();
  const notWhileSounding = () => !composeEngine.isLmbDown();

  return {
    ...createEditCommands({ interaction, viewport, isPerformLocked: deps.isComposePerformActive, pasteBeat }),

    // ── Transport ──
    'transport.playPause': { run: deps.transport.playPause },
    'preview.audition': { run: deps.startAudition, release: deps.stopAudition },
    'transport.play': { run: deps.transport.play },
    // Playback pauses; a recording or queued pass ends instead — a capture has
    // no paused state to resume.
    'transport.pause': { run: () => transport({ type: 'pause' }) },
    'transport.stop': {
      run() {
        transport({ type: 'stop' });
        // Stop also rewinds the classic playhead, even when already stopped.
        store.setPlaybackPosition(0);
      },
    },
    'transport.record': { run: deps.transport.toggleRecord },
    'transport.recordPass': { run: deps.transport.toggleRecordNextPass },
    // The loop defines what's being recorded, so it holds still meanwhile.
    'transport.loop': {
      run: () => store.setLoopEnabled(!store.getState().loopEnabled),
      enabled: () => !isCapturing(store.getState().transport),
      checked: () => store.getState().loopEnabled,
    },
    'transport.layerMode': {
      run: () => store.setLayerMode(!store.getState().layerModeEnabled),
      checked: () => store.getState().layerModeEnabled,
    },
    'transport.countIn': {
      run: () => store.setCountIn(!store.getState().countInEnabled),
      checked: () => store.getState().countInEnabled,
    },
    'transport.escape': { run: escapeCommand },

    // ── Perform ──
    'perform.toggle': {
      run: () => { deps.setPerformMode(!store.getState().performMode); },
      enabled: () => !composeEngine.isLmbDown(),
    },
    'perform.keep': { run: performer.keepLastPhrase },
    'perform.dropPass': { run: performer.dropLastPass },
    // Dynamics swell (11.1): only on the key-swell source, so F is free otherwise.
    'perform.swell': {
      run: () => dynamics.setSwellHeld(true),
      release: () => dynamics.setSwellHeld(false),
      enabled: () => dynamics.getSource() === 'key-swell',
    },

    // ── Tools ── (off while the left button performs, like the tool buttons)
    // Not while a note is held; otherwise a tool also leaves Perform.
    'tool.draw': { run: () => deps.chooseTool('draw'), enabled: notWhileSounding },
    'tool.select': { run: () => deps.chooseTool('select'), enabled: notWhileSounding },
    'tool.nudge': { run: () => deps.chooseTool('nudge'), enabled: notWhileSounding },
    // [ and ] resize the Nudge brush by a fifth, while it's the tool.
    'nudge.smaller': {
      run() { store.setNudgeSize(store.getState().nudgeSize / 1.2); },
      enabled: () => store.getState().activeTool === 'nudge' && !store.getState().performMode,
    },
    'nudge.larger': {
      run() { store.setNudgeSize(store.getState().nudgeSize * 1.2); },
      enabled: () => store.getState().activeTool === 'nudge' && !store.getState().performMode,
    },
    'tool.delete': { run: () => deps.chooseTool('delete'), enabled: notWhileSounding },
    'tool.slice': { run: () => deps.chooseTool('scissors'), enabled: notWhileSounding },
    'edit.finishCurve': {
      run: () => interaction.finishDrawing(),
      enabled: () => notWhilePerforming() && store.getState().activeTool === 'draw' && interaction.hasDrawTarget(),
    },
    'snap.toggle': { run: () => store.setSnap(!store.getState().snapEnabled), checked: () => store.getState().snapEnabled },

    // ── Harmonic Prism ──
    'prism.drawMode': { run: () => store.setPrismDrawMode(!store.getState().harmonicPrism.drawMode) },
    'prism.projection': { run: toggleProjection },

    // ── View ──
    // Page Up on an empty canvas goes to beat 0 so there's always a way home.
    'view.start': { run: () => scrollToBeat(compositionEdge('start') ?? 0) },
    'view.end': {
      run() {
        const end = compositionEdge('end');
        if (end !== null) scrollToBeat(end);
      },
    },
    // While playing, the engine owns the position; stopped, it's the stored
    // playhead (what ruler scrubbing moves).
    'view.playhead': {
      run: () => scrollToBeat(playback.isPlaying() ? playback.getPositionBeats() : store.getState().playback.positionBeats),
    },
    'view.pitchHud': {
      run: () => store.setPitchHudVisible(!store.getState().pitchHudVisible),
      checked: () => store.getState().pitchHudVisible,
    },
    'view.frets': {
      run() { store.setFretsVisible(!store.getState().fretsVisible); markBgDirty(); },
      checked: () => store.getState().fretsVisible,
    },
    'view.perfHud': {
      run: () => store.setPerfHudVisible(!store.getState().perfHudVisible),
      checked: () => store.getState().perfHudVisible,
    },
    'view.scrollDuringPlayback': {
      run: deps.toggleScrollDuringPlayback,
      checked: () => store.getState().scrollCanvasEnabled,
    },
    'view.fullscreen': {
      run: toggleFullscreen,
      enabled: canFullscreen,
      checked: () => fullscreenOn.value,
    },
    'app.settings': { run: deps.openSettings },
    'help.open': { run: () => { window.open('/help.html', '_blank'); } },

    // ── File ──
    'file.save': {
      run() {
        const comp = store.getComposition();
        downloadFile(serializeComposition(comp), `${comp.name || 'composition'}.gliss`);
      },
    },
    'file.open': {
      async run() {
        try {
          // .gliss is the native format; .json accepts legacy flat saves.
          replaceComposition(deserializeComposition(await openFile('.gliss,.json')));
        } catch (e) {
          console.error('Failed to load:', e);
        }
      },
    },
    'file.importMidi': {
      async run() {
        try {
          replaceComposition(midiToComposition(await openBinaryFile('.mid,.midi')));
        } catch (e) {
          console.error('MIDI import failed:', e);
        }
      },
    },
    'file.exportWav': {
      async run() {
        try {
          await exportWav(store.getComposition());
        } catch (e) {
          console.error('WAV export failed:', e);
        }
      },
    },
  };
}
