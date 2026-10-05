import { createViewport } from './canvas/viewport';
import { createParamViewport } from './canvas/param-viewport';
import { createParamInteraction } from './canvas/param-interaction';
import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, MIN_ZOOM_Y, MAX_ZOOM_Y, MIN_PITCH_CENTS, MAX_PITCH_CENTS, Y_PAN_MARGIN } from './constants';
import { scrollViewportToBeat } from './canvas/scrolling-play';
import { markBgDirty, requestRedraw, redrawPending, clearRedrawRequest } from './app/redraw';
import { createScene } from './canvas/scene';
import { createPerformer } from './perform/performer';
import { createMidiPerformance } from './perform/midi';
import { createTransportController } from './app/transport-controller';
import { createAppCommands } from './commands/app-commands';
import { createTuningActions, syncTuningToAudio, CIRCLE_AUDITION_VOICE } from './ui/tuning-actions';
import { createTrackListActions, installTrackButtons } from './ui/track-actions';
import { createPitchHud } from './ui/pitch-hud';
import { createSessionOverlays } from './ui/session-overlays';
import { createFrameTimes } from './ui/frame-times';
import { createZoomSliders } from './ui/zoom-sliders';
import { installParamGraphResize } from './ui/param-graph-resize';
import { installTouchGuards } from './ui/touch-guard';
import { createInteraction, rebuildTransformBox, RULER_HEIGHT } from './canvas/interaction';
import { createInputRouter, type GestureHandlers } from './canvas/input-router';
import { createPreviewManager } from './audio/preview';
import { openContextMenu, type ContextMenuItem } from './ui/context-menu';
import { createPlaybackEngine } from './audio/playback';
import { createMetronome } from './audio/metronome';
import { createDynamicsBus } from './audio/dynamics-bus';
import { METRONOME_FLASH_DURATION_MS, LOOP_WRAP_FLASH_MS, PULSE_DURATION_MS, RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { h, render } from 'preact';
import { signal } from '@preact/signals-core';
import { loadTheme } from './theme/theme';
import { PropertyPanel } from './ui/property-panel';
import { ToolPropertyPanel } from './ui/tool-property-panel';
import { TrackList } from './ui/track-list';
import { openPresetSaveDialog } from './ui/preset-save-dialog';
import { createPerfHud } from './ui/perf-hud';
import { TopBar } from './ui/top-bar';
import type { MenuSpec } from './ui/menu';
import { SettingsDialog } from './ui/settings-dialog';
import { TempoPanel, type TempoActions } from './ui/tempo-panel';
import { liveVoiceMode } from './audio/live-voice';
import { getActiveSynthCount, getActiveOscillatorCount } from './audio/tone-synth';
import { store } from './state/store';
import { history } from './state/history';
import { getCompositionLength } from './model/composition';
import { showToast } from './ui/toast';
import { commandSpec, primaryShortcut, type CommandId } from './commands/catalog';
import { createCommandRegistry } from './commands/registry';
import { ToolStrip } from './ui/tool-strip';
import { SnapPanel, type SnapActions } from './ui/snap-panel';
import { PrismPanel } from './ui/prism-panel';
import { TuningPanel } from './ui/tuning-panel';
import { nearestNote, resolveTuning, staffGridFor, tuningKey } from './tuning/tuning';
import { fretLinePitch } from './model/frets';
import { getAudioContext, getMasterGain } from './audio/engine';
import { createDrawerRail } from './ui/drawer';
import { setIcon } from './utils/svg-helpers';
import iconTempo from './assets/icons/tempo.svg?raw';
import iconSnap from './assets/icons/snap.svg?raw';
import iconPrism from './assets/icons/prism.svg?raw';
import iconTuning from './assets/icons/tuning.svg?raw';
import { effectiveScrollCanvas as effectiveScrollCanvasFor, isPerformInputActive } from './state/perform-mode';
import { effect, watch } from './state/reactive';
import type { AppState, ToolMode, BezierCurve } from './types';
import { isRolling, isRecordArmed, forcesScrollView } from './state/transport';

// ── Theme (BACKLOG 16.7) ────────────────────────────────────────
// The canvas draws with the same tokens as the stylesheets (styles/theme.css).
loadTheme();

// ── Viewport ────────────────────────────────────────────────────
const viewport = createViewport();
viewport.topInset = RULER_HEIGHT;

// ── DOM layout ──────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="toolbar"></div>
  <div id="main-area">
    <div id="rail">
      <button class="rail-icon" data-drawer="tempo" title="Tempo" aria-label="Tempo"></button>
      <button class="rail-icon" data-drawer="snap" title="Snap" aria-label="Snap"></button>
      <button class="rail-icon" data-drawer="prism" title="Harmonic Prism" aria-label="Harmonic Prism"></button>
      <button class="rail-icon" data-drawer="tuning" title="Tuning" aria-label="Tuning"></button>
      <div class="rail-divider" role="separator"></div>
      <div id="tool-strip-host"></div>
    </div>
    <div id="drawer-host">
      <div class="drawer" id="drawer-tempo" data-drawer="tempo">
        <div class="drawer-header">Tempo</div>
        <div id="tempo-panel"></div>
      </div>
      <div class="drawer" id="drawer-snap" data-drawer="snap">
        <div class="drawer-header">Snap</div>
        <div id="snap-panel"></div>
      </div>
      <div class="drawer" id="drawer-prism" data-drawer="prism">
        <div class="drawer-header" title="Harmonic Prism — ${primaryShortcut('prism.drawMode')}: Draw mode">Harmonic Prism</div>
        <div id="prism-panel"></div>
      </div>
      <div class="drawer" id="drawer-tuning" data-drawer="tuning">
        <div class="drawer-header">Tuning</div>
        <div id="tuning-panel"></div>
      </div>
    </div>
    <div id="center-stack">
      <!-- The zoom sliders sit along the canvas's edges, like scrollbars, never
           over it (13.32): pitch down the right side, time along the bottom. -->
      <div id="canvas-row">
        <div id="canvas-container">
          <canvas id="bg-canvas"></canvas>
          <canvas id="fg-canvas"></canvas>
          <div id="pitch-hud" hidden></div>
          <div id="perf-hud" hidden></div>
          <div id="countdown-overlay" hidden></div>
          <div id="afk-warning" hidden>
            <div class="afk-warning-title">Idle. Recording will pause in</div>
            <div class="afk-warning-countdown" id="afk-warning-countdown">0</div>
            <div class="afk-warning-hints">
              play something to continue recording.<br/>
              Space or Esc to stop recording.<br/>
              PgUp / PgDown to first / last curve.<br/>
              Home to recenter on playhead.
            </div>
          </div>
        </div>
        <div id="zoom-y-gutter" class="zoom-gutter">
          <input type="range" id="zoom-y" min="${MIN_ZOOM_Y}" max="${MAX_ZOOM_Y}" value="${viewport.state.zoomY}" step="0.001" title="Zoom pitch" aria-label="Zoom pitch" />
        </div>
      </div>
      <div id="zoom-x-gutter" class="zoom-gutter">
        <input type="range" id="zoom-x" min="0" max="1000" value="0" step="1" title="Zoom time" aria-label="Zoom time" />
      </div>
      <div id="param-container">
        <div id="param-resize-handle" title="Drag to resize the Parameters Graph"></div>
        <div id="param-graph-label">Volume</div>
        <canvas id="param-canvas"></canvas>
      </div>
    </div>
    <div id="property-panel">
      <div class="panel-header">Tool</div>
      <div id="tool-prop-content"></div>
      <div class="panel-header">Selection</div>
      <div id="prop-content">
        <p class="placeholder-text">Select a point to edit properties</p>
      </div>
      <div class="panel-header">Tracks</div>
      <div id="tracks-section">
        <div id="track-list"></div>
        <div class="track-panel-actions">
          <button id="add-track-btn" title="Add track">+ Track</button>
          <button id="new-tone-btn" title="Create new tone">+ Tone</button>
        </div>
      </div>
    </div>
  </div>
`;

// ── Canvas setup ────────────────────────────────────────────────
const canvasContainer = document.getElementById('canvas-container')!;
const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
const fgCanvas = document.getElementById('fg-canvas') as HTMLCanvasElement;
const bgCtx = bgCanvas.getContext('2d')!;
const fgCtx = fgCanvas.getContext('2d')!;

// ── Parameters Graph (WS2): a time-locked lane below the main canvas. ──
const paramContainer = document.getElementById('param-container')!;
const paramCanvas = document.getElementById('param-canvas') as HTMLCanvasElement;
const paramCtx = paramCanvas.getContext('2d')!;
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

// ── Parameters Graph: drag-to-resize height ────────────────────
installParamGraphResize(
  document.getElementById('param-resize-handle')!,
  document.getElementById('center-stack')!,
  () => resizeCanvases(),
);

const pitchHud = createPitchHud(document.getElementById('pitch-hud') as HTMLDivElement);

let paramW = 0;
let paramH = 0;
const PARAM_HANDLE_H = 7; // px; matches #param-resize-handle height + #param-canvas top

function resizeCanvases() {
  const rect = canvasContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);

  for (const canvas of [bgCanvas, fgCanvas]) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Widest Y zoom must fit the entire playable note range plus pan margin
  // within the area below the top rulers.
  const usableH = h - viewport.topInset;
  if (usableH > 0) {
    viewport.minZoomY = usableH / (MAX_PITCH_CENTS - MIN_PITCH_CENTS + 2 * Y_PAN_MARGIN);
    viewport.setZoomY(viewport.state.zoomY);
  }

  // Parameters Graph canvas — its own rect (different height) + DPR transform.
  // Subtract the resize-handle strip at the top so the canvas fills the area
  // below it exactly (canvas is offset by the same amount via CSS top).
  const prect = paramContainer.getBoundingClientRect();
  paramW = Math.floor(prect.width);
  paramH = Math.max(0, Math.floor(prect.height) - PARAM_HANDLE_H);
  paramCanvas.width = paramW * dpr;
  paramCanvas.height = paramH * dpr;
  paramCanvas.style.width = `${paramW}px`;
  paramCanvas.style.height = `${paramH}px`;
  paramCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paramViewport.setHeight(paramH);

  markBgDirty();
}

// ── Audio preview ──────────────────────────────────────────────
const preview = createPreviewManager();
let previewActive = false;
function setPreviewActive(on: boolean): void {
  previewActive = on;
  requestRedraw(); // the free planchette appears / disappears
}

// ── Dynamics bus (BACKLOG 11.1) ────────────────────────────────
// One normalized channel driving live perform loudness AND the recorded volume
// lane. Seeded from the persisted workspace preference; `fixed` reproduces the
// pre-bus constant exactly.
const dynamics = createDynamicsBus(store.getState().dynamicsSource);
// Chosen in Perform's tool settings (BACKLOG 16.3); the bus follows the store.
watch(() => store.getState().dynamicsSource, source => dynamics.setSource(source));
// A keyup that lands while the window is unfocused never reaches us, which
// would leave the swell latched on. Releasing on blur is the cheap fix.
window.addEventListener('blur', () => dynamics.setSwellHeld(false));

// ── Audition: hold A (BACKLOG 16.6) ───────────────────────────
// Space is Play/Pause only. Holding A auditions: in Draw, the pitch under the
// cursor (with the composition too, per Draw Preview); while dragging a Y
// guide, the guide's pitch (13.6). Scrubbing the ruler is audible on its own
// (Settings › Audible scrub), so it needs no key.
let auditionHeld = false;
/** Voice for a dragged fret's pitch — separate from the Draw voices. */
const GUIDE_AUDITION_VOICE = 'guide-audition';

function activeTone() {
  const st = store.getState();
  const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
  return track ? st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null : null;
}

function startAudition() {
  auditionHeld = true;
  syncAudition();
}

function stopAudition() {
  auditionHeld = false;
  if (previewActive) { preview.stopAll(); setPreviewActive(false); }
  if (preview.isDrawPreviewActive(GUIDE_AUDITION_VOICE)) preview.stopDrawPreview(GUIDE_AUDITION_VOICE);
}
// A's keyup never arrives while the window is unfocused; don't leave it sounding.
window.addEventListener('blur', () => {
  if (auditionHeld) stopAudition();
  if (preview.isDrawPreviewActive(CIRCLE_AUDITION_VOICE)) preview.stopDrawPreview(CIRCLE_AUDITION_VOICE);
});

/** Keep what's sounding in step with what A is held over. Runs on press and
 *  every frame while held, so the audition picks up a guide drag that starts
 *  mid-hold, or the cursor coming back onto the canvas. Nothing sounds while
 *  a recording is armed: the take owns the audio. */
function syncAudition() {
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

  // In Draw, the cursor's pitch. onCursorMove retunes it as the cursor moves.
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
      if (tone) startPrismDrawPreview(tone, interaction.cursorWorld.y);
      setPreviewActive(true);
      // Page view: snap the playhead to the cursor so the user sees the scrub
      // location. Leaves it there on preview end (easy way to summon a far-away playhead).
      if (!effectiveScrollCanvas()) {
        store.setPlaybackPosition(Math.max(0, interaction.cursorWorld.x));
      }
    } else if (tone && interaction.cursorWorld) {
      startPrismDrawPreview(tone, interaction.cursorWorld.y);
      setPreviewActive(true);
    }
  }
}

/** Centre the view on a beat. */
function scrollToBeat(beat: number) {
  const r = canvasContainer.getBoundingClientRect();
  scrollViewportToBeat(viewport, beat, r.width, r.height);
  markBgDirty();
}

// ── Interaction ─────────────────────────────────────────────────
let scrubWasPlaying = false;
// True while a ruler-drag is driving the scrub preview, so we can stop it cleanly on release
// without interfering with a hold-A audition.
let rulerScrubPreviewActive = false;
// Dev-only debug accessor: lets the verification harness probe interaction
// + store state. Stripped by the bundler in production via tree-shaking on
// import.meta.env.DEV (Vite). Safe to leave in place — it only attaches under
// the dev server.
const interaction = createInteraction(fgCanvas, viewport, {
  onPlayheadScrub(beats, phase) {
    // Rail view: the scrubbed beat slides under the fixed rail as you drag
    // (BACKLOG 16.2), so there the playhead always is the rail beat.
    if (effectiveScrollCanvas()) scrollToBeat(beats);
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
      if (scrubWasPlaying) transportController.playEngineFrom(store.getState().transport, beats);
    }
  },
  onCursorMove(worldX, worldY, _screenY) {
    if (!previewActive) return;
    if (preview.isDrawPreviewActive()) {
      updatePrismDrawPreview(worldY);
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
  },
  onUngroup() {
    commands.run('edit.ungroup');
  },
  onCursorLeave() {
    if (previewActive && store.getState().activeTool === 'draw') {
      preview.stopAll();
      setPreviewActive(false);
    }
  },
  onLoopMarkerDrag(which, beats, phase) {
    if (phase === 'start') history.snapshot();
    if (which === 'start') store.setLoopStart(beats);
    else store.setLoopEnd(beats);
  },
  isPerformInputActive: () => isComposePerformActive(),
});

// ── Playback engine ─────────────────────────────────────────────
const playback = createPlaybackEngine((beats) => {
  store.setPlaybackPosition(beats);
  // The engine ran out of range (end of content, Loop off): end the session.
  // Ignored while a transport change is being applied — starting or stopping
  // the engine reports positions too, and those aren't the engine running out.
  if (!transportController.isApplying() && !playback.isPlaying() && isRolling(store.getState().transport)) {
    transport({ type: 'stop' });
  }
});

// ── Metronome ───────────────────────────────────────────────────
const metronome = createMetronome(getAudioContext, getMasterGain);
/** Wall-clock ms at which the latest metronome tick is scheduled to fire, plus
 *  its tier — render loop reads these to flash the planchette/playhead. */
let lastMetronomeClickAt = 0;
let lastMetronomeClickTier: 'downbeat' | 'accent' | 'weak' = 'weak';
metronome.onTick((audioTime, tier) => {
  const ctx = getAudioContext();
  const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
  setTimeout(() => {
    lastMetronomeClickAt = performance.now();
    lastMetronomeClickTier = tier;
  }, delayMs);
});
playback.setSchedulerHook((fromBeat, toBeat, comp, beatToAudioTime) => {
  metronome.scheduleInRange(fromBeat, toBeat, comp, beatToAudioTime);
});

// ── Toolbar ─────────────────────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;

// ── Icon rail + sliding drawers (WS3) ──────────────────────────
// Inject shape-only SVG icons (color comes from CSS currentColor) and wire the
// rail so each icon toggles its overlay drawer.
{
  const railEl = document.getElementById('rail')!;
  const drawerHost = document.getElementById('drawer-host')!;
  const railIcons: Record<string, string> = {
    tempo: iconTempo,
    snap: iconSnap,
    prism: iconPrism,
    tuning: iconTuning,
  };
  railEl.querySelectorAll<HTMLElement>('.rail-icon[data-drawer]').forEach(btn => {
    const id = btn.dataset.drawer;
    const svg = id ? railIcons[id] : undefined;
    if (svg) setIcon(btn, svg);
  });
  createDrawerRail(railEl, drawerHost);
}
// ── Tool strip (BACKLOG 16.4) ─────────────────────────────────
/** Entering Select with curves already selected (e.g. a track clicked while in
 *  Draw) shows their transform box straight away. */
function buildTransformBoxFromSelection(): void {
  const st = store.getState();
  if (st.selectedCurveIds.size === 0 || interaction.transformBox) return;
  const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
  if (track) rebuildTransformBox(interaction, track);
}

/** The left button is sounding, so the tool strip can't change tools. Engine
 *  state, polled per frame. */
const toolsLocked = signal(false);

// ── HUDs ────────────────────────────────────────────────────────
const perfHud = createPerfHud(document.getElementById('perf-hud') as HTMLDivElement);
watch(() => store.getState().perfHudVisible, v => perfHud.setVisible(v));
// Perform colours the whole app (a first cue; 16.8 designs the real one).
watch(() => store.getState().performMode, on => document.body.classList.toggle('perform-mode', on));

const frameTimes = createFrameTimes();

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

/** Compose mode's "scroll the canvas during playback" (BACKLOG 16.2), from
 *  the View menu. Stopped, the rail appears on the playhead, as when entering
 *  Perform. */
function toggleScrollDuringPlayback(): void {
  store.setScrollCanvas(!store.getState().scrollCanvasEnabled);
  if (playback.isPlaying()) return;
  const r = canvasContainer.getBoundingClientRect();
  if (effectiveScrollCanvas()) {
    scrollViewportToBeat(viewport, store.getState().playback.positionBeats, r.width, r.height);
  } else {
    viewport.clampOffset(r.width, r.height, minPanOffsetX(r.width));
  }
  updateZoom();
  markBgDirty();
}

/** Phrases the rolling buffer can keep, for the Keep button (BACKLOG 10.2).
 *  Engine state that never notifies the store — sealing a phrase and aging one
 *  out — so it's polled each frame; the signal only wakes the button when the
 *  count actually changes. */
const keepable = signal(0);

/** Tempo drawer edits (BACKLOG 16.3): each is one undo step. */
const tempoActions: TempoActions = {
  setBpm(bpm) {
    history.snapshot();
    store.setBpm(bpm);
  },
  setTimeSignature(beats, denominator) {
    history.snapshot();
    store.setTimeSignature(beats, denominator);
  },
};

// ── Tune A4 (BACKLOG 8.27) and the Tuning drawer (13.8) ─────────
syncTuningToAudio();
const tuningActions = createTuningActions({ preview, activeTone });

// ── Settings, and MIDI keys held ────────────────────────────────
/** The Settings dialog (BACKLOG 16.3): open or closed. */
const settingsOpen = signal(false);
/** MIDI keys held now: live MIDI input (perform/midi.ts) adds and removes
 *  them, and the performer's swell shapes them too. */
const heldMidiNotes = new Set<number>();

// ── Snap drawer (BACKLOG 16.4) ─────────────────────────────────
/** Add a beat guide (x) or a fret (y) at the centre of the current viewport,
 *  then auto-select it so the user can immediately drag or rename it. */
function addGuideAtViewportCenter(orientation: 'x' | 'y'): void {
  const r = canvasContainer.getBoundingClientRect();
  const centre = viewport.screenToWorld(r.width / 2, r.height / 2);
  const position = orientation === 'x'
    ? Math.max(0, Math.round(centre.wx * 4) / 4)   // round to nearest 1/4 beat for tidiness
    : nearestNote(staffGridFor(store.getState()).lines.map(l => l.cents), centre.wy); // the tuning's nearest note
  const guide = {
    id: `guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orientation,
    position,
    label: '',
  };
  history.snapshot();
  store.addGuide(guide);
  store.setSelectedGuide(guide.id);
  // Force the viewport to re-show the guides if they were hidden.
  store.setGuidesVisible(true);
  if (orientation === 'y') store.setFretsVisible(true);
  markBgDirty();
}

const snapActions: SnapActions = {
  askPresetName: existingNames => openPresetSaveDialog({ title: 'Save Snap Preset', existingNames }),
  confirmDeletePreset: name => confirm(`Delete user preset "${name}"?`),
  addGuide: addGuideAtViewportCenter,
  redrawGuides: () => { markBgDirty(); },
  notify: showToast,
};

// ── Metronome + Loop ───────────────────────────────────────────
// The Tempo drawer and the top bar change the store; the engines follow it.
watch(() => store.getState().metronomeEnabled, on => metronome.setEnabled(on));
watch(() => store.getState().metronomeVolume, v => metronome.setVolume(v));

// Loop on/off (the top-bar button and L, plus Record next Pass forcing it on):
// the store owns the flag; the engine follows it here, and the play range in
// the play-range watch at the end of the file.
watch(() => store.getState().loopEnabled, enabled => playback.setLoop(enabled));

// ── Zoom controls (along the canvas's edges, 13.32) ─────────────
const zoomSliders = createZoomSliders({
  zoomX: document.getElementById('zoom-x') as HTMLInputElement,
  zoomY: document.getElementById('zoom-y') as HTMLInputElement,
  viewport,
  canvasContainer,
  minPanOffsetX,
  onZoom: markBgDirty,
});
function updateZoom() {
  zoomSliders.update();
}

// After any form control commits a value (range release, checkbox toggle,
// select pick), drop focus so canvas hotkeys work without an extra click-off.
// `change` is the right event here: range inputs fire it on mouseup (after
// their continuous `input` stream), selects fire it after the native popup
// closes, and checkboxes/radios fire on toggle. Text-like inputs and
// textareas are intentionally skipped — they should keep focus while the
// user is typing.
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t instanceof HTMLInputElement) {
    const textTypes = new Set(['text', 'number', 'search', 'email', 'password', 'url', 'tel']);
    if (textTypes.has(t.type)) return;
  }
  if (t instanceof HTMLTextAreaElement) return;
  if (t.isContentEditable) return;
  t.blur();
});

// ── Undo / Redo availability, for the top bar ──────────────────
const canUndo = signal(false);
const canRedo = signal(false);
history.subscribe(() => {
  canUndo.value = history.canUndo();
  canRedo.value = history.canRedo();
});

// ── Modes and tools ────────────────────────────────────────────

/** Switch tools — the tool buttons and D / V / X / C. */
function selectTool(tool: ToolMode) {
  store.setTool(tool);
  if (tool !== 'draw' && interaction.drawingCurve) {
    interaction.drawingCurve = null;
  }
  if (tool !== 'draw' && previewActive) {
    preview.stopAll();
    setPreviewActive(false);
  }
  if (tool === 'scissors') {
    interaction.transformBox = null;
    store.setSelectedCurve(null);
    store.setSelectedPoint(null);
  } else if (tool === 'nudge') {
    // The brush works on whatever curve you press; no box in the way.
    interaction.transformBox = null;
  } else if (tool === 'draw') {
    // Clear the transform box but keep the curve selection so Draw extends it.
    interaction.transformBox = null;
  } else if (tool === 'select') {
    buildTransformBoxFromSelection();
  }
}

/**
 * Enter or leave Perform (BACKLOG 16.2). Returns whether the mode is now `on`.
 *
 * Entering ends whatever the edit tools had in flight, as switching tools
 * does, and puts the rail on the playhead; if the transport is rolling, its
 * clock becomes open-ended. Leaving hands the left button back to the active
 * tool, and when stopped leaves the playhead where the rail was. It's refused
 * while the left button is held, and while a recording runs (the mouse would
 * silently stop feeding it).
 */
function setPerformMode(on: boolean): boolean {
  const st = store.getState();
  if (st.performMode === on) return true;
  if (composeEngine.isLmbDown() || performer.fingerCount() > 0) return false;
  if (!on && forcesScrollView(st.transport)) {
    showToast('Stop recording first', 2000);
    return false;
  }
  const r = canvasContainer.getBoundingClientRect();
  if (on) {
    const wasRailView = effectiveScrollCanvas();
    interaction.drawingCurve = null;
    interaction.transformBox = null;
    if (previewActive) { preview.stopAll(); setPreviewActive(false); }
    store.setPerformMode(true);
    if (isRolling(st.transport)) {
      transport({ type: 'open-clock' });
    } else if (!wasRailView) {
      scrollViewportToBeat(viewport, st.playback.positionBeats, r.width, r.height);
    }
  } else {
    if (!playback.isPlaying()) store.setPlaybackPosition(railBeat());
    store.setPerformMode(false);
    viewport.clampOffset(r.width, r.height, minPanOffsetX(r.width));
    selectTool(st.activeTool);
  }
  updateZoom();
  markBgDirty();
  return true;
}

/** A tool button or D / V / X / C. In Perform, picking a tool is also how
 *  you go back to editing. */
function chooseTool(tool: ToolMode) {
  if (!setPerformMode(false)) return;
  selectTool(tool);
}

// ── Canvas panning ──────────────────────────────────────────────
/** Middle-drag (or Alt+left) pan, shared by the staff and the Parameters Graph
 *  — the graph's pan moves the shared X and the pitch Y (its own Y axis is a
 *  fixed 0..1). The canvas input routers below decide when a press pans. */
function createPanGesture(el: HTMLElement): GestureHandlers {
  let last = { x: 0, y: 0 };
  return {
    down(e) {
      last = { x: e.clientX, y: e.clientY };
      el.style.cursor = 'grabbing';
    },
    move(e) {
      // During scrolling playback the X offset is owned by the scroll formula —
      // a user pan in X would fight it each frame. Allow only Y.
      const scrollingPlayback = effectiveScrollCanvas() && playback.isPlaying();
      const dx = scrollingPlayback ? 0 : (e.clientX - last.x);
      const dy = e.clientY - last.y;
      viewport.panBy(dx, dy);
      const rect = canvasContainer.getBoundingClientRect();
      // When Scroll Canvas is on, the rail is pinned at canvas-centre. Allow offsetX
      // to go negative by half the canvas width so the user can pan beat 0 all the
      // way over to the rail — matches the scrolling-play clamp.
      viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
      last = { x: e.clientX, y: e.clientY };
      markBgDirty();
    },
    up() {
      el.style.cursor = '';
    },
  };
}

fgCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = fgCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;

  // During scrolling Playback, Ctrl+wheel X-zoom would be overwritten by the
  // scroll formula next frame; suppress so the interaction stays honest.
  // `effectiveScrollCanvas` covers the user toggle + the Record-forced-on case.
  const scrollingPlayback = effectiveScrollCanvas() && playback.isPlaying();
  if (scrollingPlayback && e.ctrlKey) return;

  if (e.ctrlKey) {
    viewport.zoomXAt(factor, sx);
  } else {
    viewport.zoomYAt(factor, sy);
  }

  const rect2 = canvasContainer.getBoundingClientRect();
  // Respect the negative-X margin when Scroll Canvas is on so zoom doesn't
  // push beat 0 away from the rail.
  viewport.clampOffset(rect2.width, rect2.height, minPanOffsetX(rect2.width));
  updateZoom();
  markBgDirty();
}, { passive: false });

// ── Perform (perform/, split out in 15.3) ──────────────────────
const performer = createPerformer({
  viewport, fgCanvas, preview, dynamics, playback, heldMidiNotes,
  railBeat, minPanOffsetX, isComposePerformActive,
  transport: e => transport(e),
});
const {
  engine: composeEngine, performInput, fingerInput,
  startPrismDrawPreview, updatePrismDrawPreview, syncHarmonyPlanchettes,
  applyDynamicsToSoundingVoices, captureComposeRecordingSample, closeLmbPhrases, keepLastPhrase, dropLastPass, passLog,
  resetLayerSession, tickComposePerform, tickComposePitchMode, tickPerformYAutoScroll,
  planchettesAsSounding, planchetteDynamicsOf, hudPlanchette,
} = performer;

// ── Transport controller (app/transport-controller.ts) ─────────
const transportController = createTransportController({
  playback, performer, preview, dynamics, viewport, canvasContainer,
  endAudition: () => { if (previewActive) { preview.stopAll(); setPreviewActive(false); } },
  effectiveScrollCanvas, railBeat, setPerformMode,
});
const { transport, playRangeFor } = transportController;

// ── Commands (commands/app-commands.ts) ─────────────────────────
const commands = createCommandRegistry(createAppCommands({
  interaction, viewport, playback, performer, dynamics, transport: transportController, scrollToBeat,
  startAudition, stopAudition, setPerformMode, chooseTool, isComposePerformActive,
  effectiveScrollCanvas, railBeat, toggleScrollDuringPlayback,
  openSettings: () => { settingsOpen.value = true; },
}));
commands.installKeyboard(window, e =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement);

// ── Live MIDI input (perform/midi.ts) ───────────────────────────
const midi = createMidiPerformance({
  preview, dynamics, playback, performer, heldMidiNotes,
  closeSettings: () => { settingsOpen.value = false; },
});

// ── Track panel (ui/track-actions.ts) ──────────────────────────
render(h(TrackList, { actions: createTrackListActions({ interaction, performer }) }), document.getElementById('track-list')!);
installTrackButtons(document.getElementById('add-track-btn')!, document.getElementById('new-tone-btn')!);

// ── Canvas input: one router per canvas (BACKLOG 15.2) ─────────
// The router decides once per press who owns the gesture — perform, pan, or
// the edit tools — and pointer capture keeps the whole press with that owner,
// on or off the canvas. See canvas/input-router.ts.

createInputRouter({
  canvas: fgCanvas,
  isPerforming: isComposePerformActive,
  isInRuler: e => e.clientY - fgCanvas.getBoundingClientRect().top < RULER_HEIGHT,
  isRulerLocked: () => forcesScrollView(store.getState().transport),
  perform: { ...performInput, finger: fingerInput },
  pan: createPanGesture(fgCanvas),
  tool: interaction.input,
});

createInputRouter({
  canvas: paramCanvas,
  isPerforming: () => false,
  isInRuler: () => false,
  pan: createPanGesture(paramCanvas),
  tool: paramInteraction.input,
});

// Input moves state the store doesn't hold (cursor position, drags, marquee,
// hover, hold-A audition), so any of it asks for a redraw (15.5). Capture
// phase, so this runs even when a handler stops propagation.
for (const el of [fgCanvas, paramCanvas]) {
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerenter', 'pointerleave', 'lostpointercapture', 'wheel', 'dblclick', 'contextmenu']) {
    el.addEventListener(type, requestRedraw, { capture: true, passive: true });
  }
}
for (const type of ['keydown', 'keyup', 'blur']) {
  window.addEventListener(type, requestRedraw, { capture: true });
}

// Right-click action menu. Disabled during Compose Performance (recording / sounding)
// because curves being captured shouldn't be mutated out from under the engine.
fgCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isComposePerformActive()) return;
  const item = (id: CommandId): ContextMenuItem => ({
    label: commandSpec(id).label,
    shortcut: primaryShortcut(id),
    disabled: !commands.enabled(id),
    onClick: () => commands.run(id),
  });
  openContextMenu(e.pageX, e.pageY,
    (['edit.smooth', 'edit.sharpen', 'edit.simplify', 'edit.join', 'edit.group', 'edit.ungroup'] as const).map(item));
});

// ── Shared HUD + countdown DOM updaters ─────────────────────────
function updatePitchHudDom(state: AppState) {
  const planchette = hudPlanchette(state);
  if (state.pitchHudVisible && planchette?.snappedWorldY != null) {
    // Dynamics is shown whenever a live source is driving the bus, held or not,
    // so the player can see where the swell rests before they lean on it.
    const dyn = dynamics.isDriven() ? dynamics.getValue('primary') : null;
    pitchHud.show(state, planchette.snappedWorldY, planchette.cursorWorldY, dyn);
  } else {
    pitchHud.hide();
  }
}

const sessionOverlays = createSessionOverlays(
  {
    countdown: document.getElementById('countdown-overlay') as HTMLDivElement,
    afkWarning: document.getElementById('afk-warning') as HTMLDivElement,
    afkCountdown: document.getElementById('afk-warning-countdown') as HTMLDivElement,
  },
  { engine: composeEngine, isPlaying: () => playback.isPlaying() },
);

function updatePerfHudDom(state: AppState) {
  if (!state.perfHudVisible) return;
  perfHud.refresh({
    frameMsP50: frameTimes.percentile(0.5),
    frameMsP99: frameTimes.percentile(0.99),
    synthCount: getActiveSynthCount(),
    oscillatorCount: getActiveOscillatorCount(),
    voiceCount: state.performance.planchettes.length,
    audioBaseLatencyMs: getAudioContext().baseLatency * 1000,
    liveVoiceMode: liveVoiceMode(),
  });
}

// ── Render loop (BACKLOG 15.5) ──────────────────────────────────
// Every animation frame runs tickFrame(), which advances what moves on its own
// (scroll-follow, perform, dynamics, magnetic physics, recording capture). The
// canvases are then redrawn only when something changed or is animating, and
// draw() only reads: it never changes the composition. Idle, a frame costs a
// few flag checks.
//
// "Something changed" is:
//   • any store notification (fgDirty, via the effect below), including the
//     canvas-only planchette and playhead values;
//   • pointer and key input, which moves state the store doesn't hold (cursor,
//     drags, marquee, hovered handle);
//   • a dirty background (markBgDirty) — every viewport change sets it.
// "Animating" covers the transport rolling or armed, a held perform note, and
// the tail of a pulse or flash.

effect(() => {
  store.trackAllChannels();
  requestRedraw();
});
let wasAnimating = false;

const scene = createScene({
  bgCtx, fgCtx, paramCtx, canvasContainer, viewport, paramViewport, interaction, paramInteraction,
  composeEngine, playback,
  paramSize: () => ({ w: paramW, h: paramH }),
  getSelectedParamCurve,
  previewActive: () => previewActive,
  effectiveScrollCanvas,
  planchettesAsSounding,
  planchetteDynamicsOf,
  metronomeFlash: () => ({ at: lastMetronomeClickAt, tier: lastMetronomeClickTier }),
});

function isAnimating(state: AppState): boolean {
  if (playback.isPlaying() || composeEngine.isLmbDown()) return true;
  if (state.transport.mode === 'countdown' || isRecordArmed(state.transport)) return true;
  const now = performance.now();
  if (lastMetronomeClickAt > 0 && now - lastMetronomeClickAt < METRONOME_FLASH_DURATION_MS) return true;
  const wrapAt = composeEngine.getLastLoopWrapAt();
  if (wrapAt > 0 && now - wrapAt < LOOP_WRAP_FLASH_MS) return true;
  const wall = Date.now();
  return state.performance.planchettes.some(p => wall - p.lastCrossedAt < PULSE_DURATION_MS);
}

function frame() {
  runFrame();
  requestAnimationFrame(frame);
}

function runFrame() {
  // Frame-time sample for the Perf HUD's rolling window. Always pushed (the
  // sort cost happens only inside updatePerfHudDom when the HUD is visible)
  // so toggling the HUD on instantly has 2 s of accurate p50/p99.
  frameTimes.push(performance.now());
  tickFrame();
  syncAudition();

  const state = store.getState();
  keepable.value = composeEngine.getKeepablePhraseCount();
  updatePerfHudDom(state);
  const animating = isAnimating(state);
  // One more frame after an animation ends clears its last faded step.
  if (redrawPending() || animating || wasAnimating) {
    clearRedrawRequest();
    // Compose UI affordances that follow the same state the canvas draws.
    toolsLocked.value = composeEngine.isLmbDown();
    updatePitchHudDom(state);
    sessionOverlays.update(state);
    scene.draw();
  }
  wasAnimating = animating;
}

/** Per-frame simulation. May update runtime state (viewport, planchettes,
 *  perform capture); drawing happens separately in draw(). */
function tickFrame() {
  // Reconcile harmony planchettes against current state. Cheap no-op when
  // state hasn't changed; covers playback start/stop, drawMode toggle, and
  // mid-playback chord-spec voice-count changes.
  syncHarmonyPlanchettes();

  // "Scroll Canvas" view: when the toggle is effectively on during Playback,
  // scroll the viewport each frame so the playhead sits centred on the rail.
  // Toggle off → classic static canvas with the playhead moving across.
  // Recording forces the scrolling view on via `effectiveScrollCanvas()`.
  if (effectiveScrollCanvas() && playback.isPlaying()) {
    const rect = canvasContainer.getBoundingClientRect();
    // While recording the in-flight buffer isn't reflected in the composition
    // length yet, so the canvas extent can be shorter than the live playhead —
    // the viewport would clamp and the canvas visually freezes. Bump the extent
    // to stay ahead of the playhead so scroll keeps going until LMB release
    // commits the captured curve (after which syncCompositionDerived takes over).
    const playheadBeat = playback.getPositionBeats();
    const neededExtent = Math.min(MAX_CANVAS_EXTENT, playheadBeat + SCROLL_BUFFER);
    if (viewport.canvasExtent < neededExtent) viewport.canvasExtent = neededExtent;
    scrollViewportToBeat(viewport, playheadBeat, rect.width, rect.height);
    markBgDirty();
  }

  // Compose performance tick: countdown advance, loop-wrap detection, AFK auto-stop.
  tickComposePerform();

  // Dynamics bus: advance the envelope, then ride the sounding voices with it.
  // Must run before captureComposeRecordingSample so this frame's samples carry
  // this frame's value.
  dynamics.tick(performance.now());
  applyDynamicsToSoundingVoices();

  // Y auto-scroll while LMB held in Perform / Record so the user can drag
  // past the visible pitch range without releasing.
  tickPerformYAutoScroll();

  // Per-frame pitch-mode tick — keeps Glide/Magnetic advancing toward the
  // current target even when the mouse is still. No-op when neither mode is
  // active or snap is off.
  tickComposePitchMode();

  // Compose perform: record-sample capture each frame while armed + sounding + playing.
  captureComposeRecordingSample();

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

/**
 * Sync derived values from the composition: canvas extent (viewport pan bound)
 * and the M:SS length display next to the title. Runs from an effect whenever
 * the composition changes.
 */
function syncCompositionDerived() {
  const comp = store.getComposition();
  const length = getCompositionLength(comp);
  // Pan buffer past the last point: at least SCROLL_BUFFER beats, but bumped to
  // 2 minutes' worth at the current BPM so the user can always scroll well past
  // the end to add new content. clampOffset adds a width-aware floor on top.
  const timeBuffer = Math.max(SCROLL_BUFFER, 2 * comp.bpm);
  const extent = Math.min(
    MAX_CANVAS_EXTENT,
    Math.max(MIN_CANVAS_EXTENT, length) + timeBuffer,
  );
  viewport.canvasExtent = extent;
  viewport.compLengthBeats = length;
}

if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // composeEngine + the perform entry points let the harness drive a capture
  // session headlessly — the render loop (and therefore frame-driven sample
  // capture) is throttled to zero in a backgrounded tab.
  (window as any).__debug = {
    store, interaction, viewport, composeEngine,
    keepLastPhrase, captureComposeRecordingSample, closeLmbPhrases,
    // Layer/pass actions plus resetLayerSession, which stands in for a loop
    // wrap (the wrap fires from the render loop, which a background tab pins
    // at zero frames).
    dropLastPass, resetLayerSession, passLog,
    // The transport controller and the per-frame perform tick (count-in, loop
    // wrap, AFK), so transport flows can be driven with the render loop frozen.
    transport, tickComposePerform,
    // Live voice counts — the observable for "removing a track stops its sound".
    getActiveSynthCount, getActiveOscillatorCount,
    // Frames drawn so far (15.5): flat while idle.
    drawCount: () => scene.drawCount(), runFrame,
    // Live voices (15.7): drive and inspect them directly.
    preview, getAudioContext, getMasterGain,
  };
}

// ── Store → UI bindings (BACKLOG 15.1) ──────────────────────────
// Each binding re-runs only when the state it reads changes. This replaces a
// single subscriber that re-synced every control and rebuilt the track list and
// both property panels on every store change, including every drag mousemove.

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

// Undo / redo / file open replace the composition object outright, so keep the
// scheduler pointed at the live one — otherwise every edit after an undo taken
// mid-playback would be inaudible until the next play().
watch(() => store.getComposition(), comp => {
  if (playback.isPlaying()) playback.setComposition(comp);
});


// These read exactly what they show and skip DOM work when it hasn't changed.
const propContentEl = document.getElementById('prop-content')!;
const toolPropContentEl = document.getElementById('tool-prop-content')!;
effect(() => syncCompositionDerived());
render(h(PropertyPanel, { commands }), propContentEl);
render(h(ToolPropertyPanel, null), toolPropContentEl);

// The top bar, Tempo drawer and Settings dialog (BACKLOG 16.3). Menus are
// lists of catalog commands; the registry says what each does, whether it
// can run now, and whether a setting is on.
const MENUS: readonly MenuSpec[] = [
  { label: 'File', entries: ['file.save', 'file.open', '-', 'file.importMidi', 'file.exportWav'] },
  {
    label: 'Edit',
    entries: [
      'edit.undo', 'edit.redo', '-',
      'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.continue', 'edit.delete', '-',
      'edit.join', 'edit.group', 'edit.ungroup', '-',
      'edit.moveUp', 'edit.moveDown', 'edit.copyUp', 'edit.copyDown', '-',
      'edit.sendToGuides', 'edit.copyToGuides', '-',
      'edit.smooth', 'edit.sharpen', 'edit.simplify',
    ],
  },
  {
    label: 'View',
    entries: [
      'view.pitchHud', 'view.perfHud', 'view.scrollDuringPlayback', 'view.fullscreen', '-',
      'view.frets', '-',
      'view.start', 'view.end', 'view.playhead', '-',
      'help.open',
    ],
  },
];
render(h(TopBar, { commands, menus: MENUS, canUndo, canRedo, keepable }), toolbarContainer);
installTouchGuards();
render(h(TempoPanel, { actions: tempoActions }), document.getElementById('tempo-panel')!);
render(h(SnapPanel, { actions: snapActions }), document.getElementById('snap-panel')!);
render(h(TuningPanel, { actions: tuningActions }), document.getElementById('tuning-panel')!);
render(h(PrismPanel, null), document.getElementById('prism-panel')!);
// The tool can change from several places (hotkeys, track click, Ctrl-hold in
// interaction.ts), so the strip follows the store (BACKLOG 14.2).
render(h(ToolStrip, { commands, locked: toolsLocked }), document.getElementById('tool-strip-host')!);
{
  const settingsHost = document.createElement('div');
  document.body.appendChild(settingsHost);
  render(h(SettingsDialog, {
    open: settingsOpen,
    midi: midi.settings,
  }), settingsHost);
}

// Keep the engine's play range in step with the transport, Loop and the loop
// markers, so toggling Loop, dragging a marker, or arming mid-play takes
// effect on the next wrap. Loop on: the markers. Loop off: plain Play ends with
// the content; Play in Perform and every kind of capture stay open-ended (14.7) — which
// is also what re-opens the range when R arms a running playback.
watch(
  () => {
    const st = store.getState();
    const t = st.transport;
    if (!isRolling(t)) return 'idle';
    const c = st.composition;
    return [st.loopEnabled, c.loopStartBeats, c.loopEndBeats, getCompositionLength(c), t.clock, t.capture].join('|');
  },
  () => {
    if (!playback.isPlaying()) return;
    playback.setPlayRange(...playRangeFor(store.getState().transport));
  },
);

// ── Initialization ──────────────────────────────────────────────
window.addEventListener('resize', () => { resizeCanvases(); updateZoom(); });
// Keep the canvases correctly sized whenever their containers change size for
// ANY reason — window resize, the param-graph resize handle, drawer layout, or
// a post-hot-reload relayout (which previously left the canvas 0-height until a
// hard refresh). The observer also fires once on observe(), covering initial
// sizing after layout settles.
const canvasResizeObserver = new ResizeObserver(() => { resizeCanvases(); updateZoom(); });
canvasResizeObserver.observe(canvasContainer);
canvasResizeObserver.observe(paramContainer);
resizeCanvases();

// Default view: about 30 seconds visible in X (at the composition's BPM),
// middle 3 octaves in Y (within the area below the top rulers).
{
  const rect = canvasContainer.getBoundingClientRect();
  const midPitch = (MIN_PITCH_CENTS + MAX_PITCH_CENTS) / 2;     // F#4 (6600 ¢)
  const visibleCents = 3600;                                    // 3 octaves
  const visibleBeats = (30 / 60) * store.getComposition().bpm;  // 30s of beats
  viewport.setZoomX(rect.width / visibleBeats);
  viewport.setZoomY((rect.height - viewport.topInset) / visibleCents);
  viewport.state.offsetY = midPitch + visibleCents / 2 + viewport.topInset / viewport.state.zoomY;
  // In the rail view, the rail — not the left edge — is where the next gesture
  // lands, so beat 0 belongs under it (BACKLOG 13.3). Otherwise a fresh
  // composition starts drawing at whatever beat the rail happens to sit over.
  if (store.getState().scrollCanvasEnabled) {
    scrollViewportToBeat(viewport, 0, rect.width, rect.height);
  } else {
    viewport.state.offsetX = 0;
    viewport.clampOffset(rect.width, rect.height);
  }
  updateZoom();
  markBgDirty();
}

// The app opens in Perform (decided 2026-10-04, from touch testing): it's
// ready to play at once; picking a tool goes to editing.
setPerformMode(true);


// ── Collapsible panel sections ──────────────────────────────────
// Each .panel-header toggles the visibility of its sibling content
// (everything between this header and the next .panel-header). State
// is persisted in localStorage keyed by header text.
{
  const STORAGE_KEY = 'slidesynth.collapsedPanels';
  let collapsedSet: Set<string>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    collapsedSet = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    collapsedSet = new Set();
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedSet])); } catch { /* ignore */ }
  }
  function setCollapsed(header: HTMLElement, collapsed: boolean) {
    const key = (header.textContent ?? '').trim();
    header.classList.toggle('collapsed', collapsed);
    let sib = header.nextElementSibling as HTMLElement | null;
    while (sib && !sib.classList.contains('panel-header')) {
      sib.style.display = collapsed ? 'none' : '';
      sib = sib.nextElementSibling as HTMLElement | null;
    }
    if (collapsed) collapsedSet.add(key); else collapsedSet.delete(key);
    persist();
  }
  document.querySelectorAll<HTMLElement>('.panel-header').forEach(h => {
    const key = (h.textContent ?? '').trim();
    if (collapsedSet.has(key)) setCollapsed(h, true);
    h.addEventListener('click', () => setCollapsed(h, !h.classList.contains('collapsed')));
  });
}

requestAnimationFrame(frame);
