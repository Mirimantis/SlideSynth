/**
 * The app's bootstrap: it makes the pieces, hands each the others it needs,
 * and starts the frame loop. What each piece does lives in its own module
 * (see DESIGN.md › Module map).
 */

import { h, render } from 'preact';
import { signal } from '@preact/signals-core';
import { loadTheme } from './theme/theme';
import { store } from './state/store';
import { history } from './state/history';
import { effect, watch } from './state/reactive';
import { effectiveScrollCanvas as effectiveScrollCanvasFor, isPerformInputActive } from './state/perform-mode';
import { isRolling } from './state/transport';
import { tuningKey } from './tuning/tuning';
import { createViewport } from './canvas/viewport';
import { createParamViewport } from './canvas/param-viewport';
import { createParamInteraction } from './canvas/param-interaction';
import { createInteraction, RULER_HEIGHT } from './canvas/interaction';
import { scrollViewportToBeat } from './canvas/scrolling-play';
import { RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { createStage, fitExtentToComposition } from './canvas/stage';
import { createPanGesture, installWheelZoom, type PanZoomDeps } from './canvas/pan-zoom';
import { installCanvasInput } from './canvas/canvas-input';
import { createScene } from './canvas/scene';
import { createPreviewManager } from './audio/preview';
import { createPlaybackEngine } from './audio/playback';
import { createDynamicsBus } from './audio/dynamics-bus';
import { getActiveSynthCount, getActiveOscillatorCount } from './audio/tone-synth';
import { getAudioContext, getMasterGain } from './audio/engine';
import { markBgDirty } from './app/redraw';
import { createMetronomeClock } from './app/metronome';
import { createAudition, activeTone } from './app/audition';
import { createModes } from './app/modes';
import { createTransportController } from './app/transport-controller';
import { createFrameLoop } from './app/frame-loop';
import { createPerformer } from './perform/performer';
import { createMidiPerformance } from './perform/midi';
import { createAppCommands } from './commands/app-commands';
import { createCommandRegistry } from './commands/registry';
import { App } from './ui/layout';
import { createCanvasHuds } from './ui/canvas-huds';
import { createZoomSliders } from './ui/zoom-sliders';
import { installParamGraphResize } from './ui/param-graph-resize';
import { installTouchGuards } from './ui/touch-guard';
import { installBlurOnCommit } from './ui/form-focus';
import { tempoActions, createSnapActions } from './ui/drawer-actions';
import { createTuningActions, syncTuningToAudio } from './ui/tuning-actions';
import { createTrackListActions } from './ui/track-actions';
import type { BezierCurve } from './types';

// ── Theme (BACKLOG 16.7) ────────────────────────────────────────
// The canvas draws with the same tokens as the stylesheets (styles/theme.css).
loadTheme();

// ── Layout (ui/layout.tsx) ──────────────────────────────────────
// The shell first, so the canvases exist; the panels come in once the
// commands and actions they use are made (the second render, below).
const appEl = document.getElementById('app')!;
/** What the HUDs over the canvas show: the frame loop sets it. */
const huds = createCanvasHuds();
render(h(App, { huds, parts: null }), appEl);
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ── Canvases and the view ───────────────────────────────────────
const viewport = createViewport();
viewport.topInset = RULER_HEIGHT;
const canvasContainer = byId('canvas-container');
const bgCanvas = byId<HTMLCanvasElement>('bg-canvas');
const fgCanvas = byId<HTMLCanvasElement>('fg-canvas');

// The Parameters Graph (WS2): a time-locked lane below the main canvas.
const paramContainer = byId('param-container');
const paramCanvas = byId<HTMLCanvasElement>('param-canvas');
const paramViewport = createParamViewport(viewport);

/** Resolve the BezierCurve for the current single selection (across all tracks). */
function getSelectedParamCurve(): BezierCurve | null {
  const selId = store.getSelectedCurveId();
  if (!selId) return null;
  for (const track of store.getComposition().tracks) {
    const c = track.curves.find(cc => cc.id === selId);
    if (c) return c;
  }
  return null;
}

const paramInteraction = createParamInteraction(paramCanvas, paramViewport, getSelectedParamCurve);
// Reset the param-point selection whenever the selected curve changes.
watch(() => store.getSelectedCurveId(), () => paramInteraction.resetSelection());

const stage = createStage({
  viewport, paramViewport, canvasContainer, bgCanvas, fgCanvas, paramContainer, paramCanvas,
  onResized: () => zoomSliders.update(),
});
installParamGraphResize(byId('param-resize-handle'), byId('center-stack'), stage.resize);
// The pan bound and length follow the composition.
effect(() => fitExtentToComposition(viewport, store.getComposition()));

/** Scroll Canvas effective value — see state/perform-mode.ts. */
function effectiveScrollCanvas(): boolean {
  return effectiveScrollCanvasFor(store.getState());
}
/** The beat under the rail in the scrolling view — where Play starts, and
 *  where the rail planchette is. */
function railBeat(): number {
  const r = canvasContainer.getBoundingClientRect();
  return Math.max(0, viewport.screenToWorld(r.width * RAIL_SCREEN_X_RATIO, 0).wx);
}
/** Minimum offsetX for clamping — negative in the rail view so beat 0 can
 * reach the rail at canvas centre. */
function minPanOffsetX(canvasWidth: number): number {
  return effectiveScrollCanvas()
    ? -(canvasWidth * RAIL_SCREEN_X_RATIO) / viewport.state.zoomX
    : 0;
}
/** True in Perform mode, where the left button plays the rail instead of
 *  running the tools (BACKLOG 16.2). The tool handlers in interaction.ts ask
 *  this same function (BACKLOG 14.1). */
function isComposePerformActive(): boolean {
  return isPerformInputActive(store.getState());
}
/** Centre the view on a beat. */
function scrollToBeat(beat: number) {
  const r = canvasContainer.getBoundingClientRect();
  scrollViewportToBeat(viewport, beat, r.width, r.height);
  markBgDirty();
}

// Zoom sliders along the canvas's edges (13.32).
const zoomSliders = createZoomSliders({
  zoomX: byId<HTMLInputElement>('zoom-x'),
  zoomY: byId<HTMLInputElement>('zoom-y'),
  viewport,
  canvasContainer,
  minPanOffsetX,
  onZoom: markBgDirty,
});
const updateZoom = () => zoomSliders.update();

// ── Audio ───────────────────────────────────────────────────────
const preview = createPreviewManager();

// The dynamics bus (BACKLOG 11.1): one normalized channel driving live perform
// loudness AND the recorded volume lane. Seeded from the persisted workspace
// preference; `fixed` reproduces the pre-bus constant exactly.
const dynamics = createDynamicsBus(store.getState().dynamicsSource);
// Chosen in Perform's tool settings (BACKLOG 16.3); the bus follows the store.
watch(() => store.getState().dynamicsSource, source => dynamics.setSource(source));
// A keyup that lands while the window is unfocused never reaches us, which
// would leave the swell latched on. Releasing on blur is the cheap fix.
window.addEventListener('blur', () => dynamics.setSwellHeld(false));

const playback = createPlaybackEngine((beats) => {
  store.setPlaybackPosition(beats);
  // The engine ran out of range (end of content, Loop off): end the session.
  // Ignored while a transport change is being applied — starting or stopping
  // the engine reports positions too, and those aren't the engine running out.
  if (!transportController.isApplying() && !playback.isPlaying() && isRolling(store.getState().transport)) {
    transportController.transport({ type: 'stop' });
  }
});
const metronome = createMetronomeClock(playback);

// ── Editing on the canvas ───────────────────────────────────────
// The callbacks reach pieces made below; they only run on input.
const interaction = createInteraction(fgCanvas, viewport, {
  onPlayheadScrub: (beats, phase) => audition.rulerScrub(beats, phase),
  onCursorMove: (worldX, worldY) => audition.cursorMoved(worldX, worldY),
  onCursorLeave: () => audition.cursorLeft(),
  onUngroup: () => { commands.run('edit.ungroup'); },
  onLoopMarkerDrag(which, beats, phase) {
    if (phase === 'start') history.snapshot();
    if (which === 'start') store.setLoopStart(beats);
    else store.setLoopEnd(beats);
  },
  isPerformInputActive: isComposePerformActive,
});

// ── Perform (perform/) ──────────────────────────────────────────
/** MIDI keys held now: live MIDI input (perform/midi.ts) adds and removes
 *  them, and the performer's swell shapes them too. */
const heldMidiNotes = new Set<number>();
const performer = createPerformer({
  viewport, fgCanvas, preview, dynamics, playback, heldMidiNotes,
  railBeat, minPanOffsetX, isComposePerformActive,
  transport: e => transportController.transport(e),
});

// ── Transport, audition, modes ──────────────────────────────────
const transportController = createTransportController({
  playback, performer, preview, dynamics, viewport, canvasContainer,
  endAudition: () => audition.endPreview(),
  effectiveScrollCanvas, railBeat,
  setPerformMode: on => modes.setPerformMode(on),
});
const audition = createAudition({
  preview, interaction, playback, performer, effectiveScrollCanvas, scrollToBeat,
  playEngineFrom: transportController.playEngineFrom,
});
const modes = createModes({
  interaction, performer, audition, playback, viewport, canvasContainer,
  transport: transportController.transport,
  effectiveScrollCanvas, railBeat, minPanOffsetX, updateZoom,
});

// ── Commands and the keyboard (commands/) ───────────────────────
/** The Settings dialog (BACKLOG 16.3): open or closed. */
const settingsOpen = signal(false);
const commands = createCommandRegistry(createAppCommands({
  interaction, viewport, playback, performer, dynamics, transport: transportController, scrollToBeat,
  startAudition: audition.start, stopAudition: audition.stop,
  setPerformMode: modes.setPerformMode, chooseTool: modes.chooseTool, isComposePerformActive,
  effectiveScrollCanvas, railBeat, toggleScrollDuringPlayback: modes.toggleScrollDuringPlayback,
  openSettings: () => { settingsOpen.value = true; },
}));
commands.installKeyboard(window, e =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement);

// ── Live MIDI input (perform/midi.ts) ───────────────────────────
const midi = createMidiPerformance({
  preview, dynamics, playback, performer, heldMidiNotes,
  closeSettings: () => { settingsOpen.value = false; },
});

// ── Canvas input ────────────────────────────────────────────────
const panZoom: PanZoomDeps = {
  viewport, canvasContainer, minPanOffsetX,
  isScrollingPlayback: () => effectiveScrollCanvas() && playback.isPlaying(),
  onChange: () => { updateZoom(); markBgDirty(); },
};
installWheelZoom(fgCanvas, panZoom);
installCanvasInput({
  fgCanvas, paramCanvas, commands,
  isPerforming: isComposePerformActive,
  perform: { ...performer.performInput, finger: performer.fingerInput },
  tool: interaction.input,
  paramTool: paramInteraction.input,
  pan: createPanGesture(fgCanvas, panZoom),
  paramPan: createPanGesture(paramCanvas, panZoom),
});

// ── Drawing and the frame loop ──────────────────────────────────
const scene = createScene({
  bgCtx: bgCanvas.getContext('2d')!,
  fgCtx: fgCanvas.getContext('2d')!,
  paramCtx: paramCanvas.getContext('2d')!,
  canvasContainer, viewport, paramViewport, interaction, paramInteraction,
  composeEngine: performer.engine, playback,
  paramSize: stage.paramSize,
  getSelectedParamCurve,
  previewActive: audition.isPreviewing,
  effectiveScrollCanvas,
  planchettesAsSounding: performer.planchettesAsSounding,
  planchetteDynamicsOf: performer.planchetteDynamicsOf,
});
const frameLoop = createFrameLoop({
  scene, performer, dynamics, playback, viewport, canvasContainer, interaction,
  effectiveScrollCanvas,
  syncAudition: audition.sync,
  huds,
});

// ── Store → app bindings (BACKLOG 15.1) ─────────────────────────
// Background layer (staff + rulers) depends on tempo, meter and the pitch grid
// only; viewport and reference-pitch changes mark it dirty where they happen.
watch(
  () => {
    const st = store.getState();
    const c = st.composition;
    return `${c.bpm}|${c.beatsPerMeasure}/${c.timeSignatureDenominator}|${tuningKey(st.tuning)}|${st.root}|${st.scaleId}|${st.tunedFrom}|${st.hidePitchLines}|${st.referenceLines}`;
  },
  () => { markBgDirty(); },
);
// Perform's stage (16.8): styles/main.css lays the page out for playing.
// While the mode switches, body.stage-changing animates the folding.
{
  let stageTimer: number | undefined;
  watch(() => store.getState().performMode, on => {
    document.body.classList.add('stage-changing');
    document.body.classList.toggle('perform-mode', on);
    window.clearTimeout(stageTimer);
    stageTimer = window.setTimeout(() => document.body.classList.remove('stage-changing'), 250);
  });
}
// Tune A4 (BACKLOG 8.27): the audio's reference pitch follows the composition.
syncTuningToAudio();

// Undo / Redo availability, for the top bar.
const canUndo = signal(false);
const canRedo = signal(false);
history.subscribe(() => {
  canUndo.value = history.canUndo();
  canRedo.value = history.canRedo();
});

// ── The panels (the layout's second render) ─────────────────────
render(h(App, {
  huds,
  parts: {
    commands, canUndo, canRedo,
    keepable: frameLoop.keepable,
    toolsLocked: frameLoop.toolsLocked,
    tempo: tempoActions,
    snap: createSnapActions({ viewport, canvasContainer }),
    tuning: createTuningActions({ preview, activeTone }),
    tracks: createTrackListActions({ interaction, performer }),
    settingsOpen,
    midi: midi.settings,
    metronomeBeat: metronome.beat,
  },
}), appEl);
installTouchGuards();
installBlurOnCommit();

if (import.meta.env.DEV) {
  // Dev-only debug accessor: lets the verification harness probe interaction
  // and store state, and drive a capture session headlessly — the render loop
  // (and therefore frame-driven sample capture) is throttled to zero in a
  // backgrounded tab. Vite strips it from production builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__debug = {
    store, interaction, viewport, composeEngine: performer.engine,
    keepLastPhrase: performer.keepLastPhrase,
    captureComposeRecordingSample: performer.captureComposeRecordingSample,
    closeLmbPhrases: performer.closeLmbPhrases,
    // Layer/pass actions plus resetLayerSession, which stands in for a loop
    // wrap (the wrap fires from the render loop, which a background tab pins
    // at zero frames).
    dropLastPass: performer.dropLastPass,
    resetLayerSession: performer.resetLayerSession,
    passLog: performer.passLog,
    // The transport controller and the per-frame perform tick (count-in, loop
    // wrap, AFK), so transport flows can be driven with the render loop frozen.
    transport: transportController.transport,
    tickComposePerform: performer.tickComposePerform,
    // Live voice counts — the observable for "removing a track stops its sound".
    getActiveSynthCount, getActiveOscillatorCount,
    // Frames drawn so far (15.5): flat while idle.
    drawCount: () => scene.drawCount(), runFrame: frameLoop.runFrame,
    // Live voices (15.7): drive and inspect them directly.
    preview, getAudioContext, getMasterGain,
  };
}

// ── Start ───────────────────────────────────────────────────────
stage.start();
stage.openingView(store.getComposition().bpm, store.getState().scrollCanvasEnabled);
updateZoom();
// The app opens in Perform (decided 2026-10-04, from touch testing): it's
// ready to play at once; picking a tool goes to editing.
modes.setPerformMode(true);
frameLoop.start();
