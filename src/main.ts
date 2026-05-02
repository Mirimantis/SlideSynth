import { createViewport } from './canvas/viewport';
import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y, MIN_NOTE, MAX_NOTE, Y_PAN_MARGIN, noteNumberToName } from './constants';
import { renderStaff } from './canvas/staff-renderer';
import { renderCurves, renderDrawPreview } from './canvas/curve-renderer';
import { renderTransformBox } from './canvas/transform-box-renderer';
import { renderProjection, renderProjectionSourceHighlight, renderPrismDrawPreview } from './canvas/projection-renderer';
import { renderPlayhead } from './canvas/playhead';
import { renderLoopMarkers } from './canvas/loop-markers';
import { renderGuides } from './canvas/guides';
import { scrollViewportToBeat } from './canvas/scrolling-play';
import { snapToGrid, getAdaptiveSubdivisions } from './utils/snap';
import { createInteraction, rebuildTransformBox, RULER_HEIGHT, buildSnapConfig } from './canvas/interaction';
import { createPreviewManager } from './audio/preview';
import { renderRuler } from './canvas/ruler-renderer';
import { createToolbar } from './ui/toolbar';
import { createToolPanel } from './ui/tool-panel';
import { createPrismPanel } from './ui/prism-panel';
import { openContextMenu } from './ui/context-menu';
import { createPlaybackEngine } from './audio/playback';
import { createMetronome } from './audio/metronome';
import { createMidiInput } from './audio/midi-input';
import { createMagneticState, updateMagnetic, resetMagnetic } from './utils/snap-magnetic';
import { renderPlanchettes, renderFreePlanchette, renderRail, renderMetronomeFlash, METRONOME_FLASH_DURATION_MS, RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { renderPropertyPanel } from './ui/property-panel';
import { renderToolPropertyPanel } from './ui/tool-property-panel';
import { openToneBuilder } from './ui/tone-builder';
import { openTonePicker } from './ui/tone-picker';
import { openPresetSaveDialog } from './ui/preset-save-dialog';
import { BUILTIN_SNAP_PRESETS, loadUserSnapPresets, saveUserSnapPresets, presetMatches, snapshotPreset, type SnapPreset } from './utils/snap-presets';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from './export/json-export';
import { midiToComposition } from './export/midi-import';
import { exportWav } from './export/wav-export';
import { store } from './state/store';
import { history } from './state/history';
import { copySelectedCurves, cutSelectedCurves, pasteCurves, duplicateCurves, continueCurves } from './state/clipboard';
import { createTrack } from './model/track';
import { getCompositionLength, measureLengthInBeats } from './model/composition';
import { computeMultiCurveBBox, deepCopyPoints, joinCurves, sharpenCurveHandles, smoothCurveHandles } from './model/curve';
import { assignGroup, dissolveGroup, allShareGroup, anyGrouped, createGroupId } from './model/curve-groups';
import { chordOffsets } from './utils/harmonics';
import { showToast } from './ui/toast';
import { createPerformanceEngine } from './canvas/performance-engine';
import { getScaleById } from './utils/scales';
import { ensureResumed, getAudioContext, getMasterGain } from './audio/engine';
import type { AppState, ToolMode, ControlPoint, BezierCurve } from './types';

// ── Viewport ────────────────────────────────────────────────────
const viewport = createViewport();
viewport.topInset = RULER_HEIGHT;

// ── DOM layout ──────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="toolbar"></div>
  <div id="main-area">
    <div id="track-panel">
      <div class="panel-header">Transport</div>
      <div id="transport-section">
        <div class="transport-buttons transport">
          <button id="btn-play" title="Play (Space)">&#9654;</button>
          <button id="btn-pause" title="Pause" disabled>&#10074;&#10074;</button>
          <button id="btn-stop" title="Stop">&#9632;</button>
          <button id="btn-record" class="record-btn" title="Record (R) — captures curves onto the selected track" hidden>&#9679;</button>
        </div>
        <div class="transport-row">
          <label class="toggle-switch" title="Loop playback (L)">
            <span class="toggle-switch-track">
              <input type="checkbox" id="loop-toggle" />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Loop</span>
          </label>
        </div>
        <div class="transport-row scroll-switch-row">
          <div class="scroll-switch" title="Choose which element scrolls during Playback: the Canvas (stationary planchette on the rail) or the Planchette (stationary canvas with a moving playhead)">
            <div class="scroll-switch-title">Scroll</div>
            <div class="scroll-switch-control">
              <span class="scroll-switch-side left">Canvas</span>
              <label class="toggle-switch-track">
                <input type="checkbox" id="scroll-canvas-toggle" />
                <span class="toggle-switch-thumb"></span>
              </label>
              <span class="scroll-switch-side right">Planchette</span>
            </div>
          </div>
        </div>
        <div class="transport-row">
          <label id="pitch-hud-label" class="toggle-switch" title="Show the pitch readout when the cursor is over the canvas">
            <span class="toggle-switch-track">
              <input type="checkbox" id="pitch-hud-toggle" />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Pitch HUD</span>
          </label>
        </div>
        <div class="transport-row">
          <label>BPM</label>
          <input type="number" id="input-bpm" value="120" min="20" max="300" step="1" />
        </div>
        <div class="transport-row">
          <label>Time</label>
          <select id="input-time-sig" title="Time signature">
            <option value="2/4">2/4</option>
            <option value="3/4">3/4</option>
            <option value="4/4" selected>4/4</option>
            <option value="5/4">5/4</option>
            <option value="7/4">7/4</option>
            <option value="6/8">6/8</option>
            <option value="9/8">9/8</option>
            <option value="12/8">12/8</option>
          </select>
        </div>
        <div class="transport-row">
          <label class="toggle-switch" title="Metronome clicks during playback">
            <span class="toggle-switch-track">
              <input type="checkbox" id="metronome-toggle" />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Metronome</span>
          </label>
          <input type="range" id="metronome-volume" class="metronome-volume" min="0" max="100" value="60" title="Metronome volume" />
        </div>
        <div class="transport-row">
          <label>MIDI Input</label>
          <select id="input-midi-device" title="Live MIDI input device">
            <option value="">None</option>
          </select>
        </div>
      </div>
      <div class="panel-header">Tools</div>
      <div id="tool-panel"></div>
      <div class="panel-header">Snap</div>
      <div id="snap-section">
        <div class="transport-row snap-preset-row">
          <label for="snap-preset-select">Preset</label>
          <select id="snap-preset-select" title="Snap preset — load a saved combo of snap + magnetic settings"></select>
          <button id="snap-preset-save" class="snap-preset-btn" title="Save current snap settings as a new preset">Save</button>
          <button id="snap-preset-delete" class="snap-preset-btn" title="Delete the active user preset" disabled>Del</button>
        </div>
        <div class="transport-row">
          <label class="toggle-switch" title="Toggle snap (S)">
            <span class="toggle-switch-track">
              <input type="checkbox" id="snap-toggle" checked />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Snap</span>
          </label>
        </div>
        <div class="transport-row">
          <label class="toggle-switch" title="Magnetic Snap: pitch follows physics model with snap-line attractors">
            <span class="toggle-switch-track">
              <input type="checkbox" id="magnetic-toggle" />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Magnetic</span>
          </label>
          <input type="range" id="input-magnetic-strength" class="magnetic-strength-slider" min="0" max="1" value="0.75" step="0.05" title="Snap attraction strength (0 = smooth cursor follow, 1 = strong snap pull)" />
          <span class="magnetic-strength-value">0.75</span>
        </div>
        <div class="transport-row">
          <label for="input-magnetic-spring">Spring</label>
          <input type="range" id="input-magnetic-spring" class="magnetic-spring-slider" min="1" max="50" value="30" step="1" title="Cursor-to-pitch spring stiffness (1 = loose, 50 = tight tracking)" />
          <span class="magnetic-spring-value">30</span>
        </div>
        <div class="transport-row">
          <label for="input-magnetic-damping">Damping</label>
          <input type="range" id="input-magnetic-damping" class="magnetic-damping-slider" min="0.25" max="15" value="3" step="0.25" title="Velocity damping (low = long tremolo wobbles, high = quick settle)" />
          <span class="magnetic-damping-value">3</span>
        </div>
        <div class="transport-row guides-row">
          <label class="toggle-switch" title="Show snap guides — when off, guides are hidden and don't snap">
            <span class="toggle-switch-track">
              <input type="checkbox" id="guides-visible-toggle" checked />
              <span class="toggle-switch-thumb"></span>
            </span>
            <span class="toggle-switch-label">Guides</span>
          </label>
          <button id="add-guide-x-btn" class="snap-preset-btn" title="Add a vertical (beat) guide at the centre of the viewport">+ X</button>
          <button id="add-guide-y-btn" class="snap-preset-btn" title="Add a horizontal (pitch) guide at the centre of the viewport">+ Y</button>
        </div>
      </div>
      <div class="panel-header" title="Harmonic Prism — press H on a selected curve to project harmonic echoes">Harmonic Prism</div>
      <div id="prism-panel"></div>
      <div class="panel-header">Tracks</div>
      <div id="track-list"></div>
      <div class="track-panel-actions">
        <button id="add-track-btn" title="Add track">+ Track</button>
        <button id="new-tone-btn" title="Create new tone">+ Tone</button>
      </div>
    </div>
    <div id="canvas-container">
      <canvas id="bg-canvas"></canvas>
      <canvas id="fg-canvas"></canvas>
      <div id="zoom-controls">
        <span class="zoom-label">Zoom</span>
        <input type="range" id="zoom-x" min="0" max="1000" value="0" step="1" title="Zoom X (time) — logarithmic" />
        <input type="range" id="zoom-y" min="${MIN_ZOOM_Y}" max="${MAX_ZOOM_Y}" value="${viewport.state.zoomY}" step="1" title="Zoom Y (pitch)" />
      </div>
      <div id="pitch-hud" hidden></div>
      <div id="countdown-overlay" hidden></div>
    </div>
    <div id="property-panel">
      <div class="panel-header">Tool Properties</div>
      <div id="tool-prop-content"></div>
      <div class="panel-header">Object Properties</div>
      <div id="prop-content">
        <p class="placeholder-text">Select a point to edit properties</p>
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

const pitchHud = document.getElementById('pitch-hud') as HTMLDivElement;

// Fixed-width HUD slots — one <span> per field so the numbers don't shift
// horizontally as cents flip between e.g. "+3¢" and "-12¢". Slots are created
// once and their textContent is updated in place.
pitchHud.innerHTML = `
  <span class="hud-slot hud-note" id="hud-snap-name"></span>
  <span class="hud-slot hud-cents" id="hud-snap-cents"></span>
  <span class="hud-slot hud-sep" id="hud-sep"></span>
  <span class="hud-slot hud-note" id="hud-raw-name"></span>
  <span class="hud-slot hud-cents" id="hud-raw-cents"></span>
`;
const hudSnapName = document.getElementById('hud-snap-name') as HTMLSpanElement;
const hudSnapCents = document.getElementById('hud-snap-cents') as HTMLSpanElement;
const hudSep = document.getElementById('hud-sep') as HTMLSpanElement;
const hudRawName = document.getElementById('hud-raw-name') as HTMLSpanElement;
const hudRawCents = document.getElementById('hud-raw-cents') as HTMLSpanElement;

function formatCents(cents: number): string {
  if (cents === 0) return '';
  return `${cents > 0 ? '+' : ''}${cents}¢`;
}

/** Fill each HUD slot in place — no innerHTML, no text concatenation. */
function writePitchHud(snappedY: number | null, rawY: number | null): void {
  if (snappedY == null) {
    hudSnapName.textContent = '';
    hudSnapCents.textContent = '';
    hudSep.textContent = '';
    hudRawName.textContent = '';
    hudRawCents.textContent = '';
    return;
  }
  const nearest = Math.round(snappedY);
  const cents = Math.round((snappedY - nearest) * 100);
  hudSnapName.textContent = noteNumberToName(nearest);
  hudSnapCents.textContent = formatCents(cents);

  const hasRaw = rawY != null
    && Math.abs(rawY - snappedY) >= 0.02
    && Math.round(rawY) >= MIN_NOTE
    && Math.round(rawY) <= MAX_NOTE;
  if (hasRaw) {
    const rawNearest = Math.round(rawY!);
    const rawCents = Math.round((rawY! - rawNearest) * 100);
    hudSep.textContent = '·';
    hudRawName.textContent = noteNumberToName(rawNearest);
    hudRawCents.textContent = formatCents(rawCents);
  } else {
    hudSep.textContent = '';
    hudRawName.textContent = '';
    hudRawCents.textContent = '';
  }
}

let bgDirty = true;

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
    viewport.minZoomY = usableH / (MAX_NOTE - MIN_NOTE + 2 * Y_PAN_MARGIN);
    viewport.setZoomY(viewport.state.zoomY);
  }

  bgDirty = true;
}

// ── Audio preview ──────────────────────────────────────────────
const preview = createPreviewManager();
let previewActive = false;

// Spacebar tap-vs-hold: under this threshold, Space is a transport tap (play / pause /
// stop-recording). Past it, Space becomes a hold-to-preview. The timer fires the preview
// activation so a quick tap never triggers audio preview.
const SPACE_HOLD_MS = 250;
let spaceHoldTimer: number | null = null;

/** Start the preview appropriate to current context (Draw cursor, scrubbing). No-op during recording. */
function activateSpacePreview() {
  spaceHoldTimer = null;
  const state = store.getState();
  if (state.performance.recordArmed) return;
  const inDrawContext = state.activeTool === 'draw'
    && interaction.cursorInCanvas
    && interaction.cursorScreenY >= RULER_HEIGHT
    && interaction.cursorWorld !== null;
  const inScrubContext = interaction.scrubbing;

  if (inDrawContext) {
    const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
    const tone = track ? state.composition.toneLibrary.find(t => t.id === track.toneId) : null;
    if (state.drawPreviewMode === 'composition' && interaction.cursorWorld) {
      preview.startScrubPreview(state.composition);
      preview.updateScrubPosition(interaction.cursorWorld.x, state.composition);
      if (tone) startPrismDrawPreview(tone, interaction.cursorWorld.y);
      previewActive = true;
      // Classic-playhead mode: snap the playhead to the cursor so the user sees the scrub
      // location. Leaves it there on preview end (easy way to summon a far-away playhead).
      if (!state.scrollCanvasEnabled) {
        store.setPlaybackPosition(Math.max(0, interaction.cursorWorld.x));
      }
    } else if (tone && interaction.cursorWorld) {
      startPrismDrawPreview(tone, interaction.cursorWorld.y);
      previewActive = true;
    }
  } else if (inScrubContext) {
    preview.startScrubPreview(state.composition);
    preview.updateScrubPosition(state.playback.positionBeats, state.composition);
    previewActive = true;
  }
}

/** Short-tap action: stop recording if armed, else toggle play/pause. */
function handleSpaceTap() {
  const state = store.getState();
  if (state.performance.recordArmed) {
    composePerformStop();
    store.setPlaybackState('stopped');
    return;
  }
  if (playback.isPlaying()) {
    playback.pause();
    store.setPlaybackState('paused');
    updatePlayState(false);
  } else {
    startPlayback();
  }
}

// ── Interaction ─────────────────────────────────────────────────
let scrubWasPlaying = false;
// True while a ruler-drag is driving the scrub preview, so we can stop it cleanly on release
// without interfering with a spacebar-driven preview.
let rulerScrubPreviewActive = false;
const interaction = createInteraction(fgCanvas, viewport, {
  onPlayheadScrub(beats, phase) {
    if (phase === 'start') {
      scrubWasPlaying = playback.isPlaying();
      if (scrubWasPlaying) {
        playback.pause();
      }
      store.setPlaybackPosition(beats);
      // Audible ruler-scrub: play the whole composition at the playhead so the user
      // can hear what's under the cursor as they drag. Skip while Record is armed
      // (the armed session already owns audio).
      if (!store.getState().performance.recordArmed && !preview.isScrubPreviewActive()) {
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
      if (scrubWasPlaying) {
        playback.play(store.getComposition(), beats);
      }
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
      if (!store.getState().scrollCanvasEnabled && !playback.isPlaying()) {
        store.setPlaybackPosition(Math.max(0, worldX));
      }
    }
  },
  onCursorLeave() {
    if (previewActive && store.getState().activeTool === 'draw') {
      preview.stopAll();
      previewActive = false;
    }
  },
  onLoopMarkerDrag(which, beats, phase) {
    if (phase === 'start') history.snapshot();
    if (which === 'start') store.setLoopStart(beats);
    else store.setLoopEnd(beats);
  },
});

// ── Playback engine ─────────────────────────────────────────────
const playback = createPlaybackEngine((beats) => {
  store.setPlaybackPosition(beats);
  // Detect when playback auto-stopped (reached end without loop).
  if (!playback.isPlaying() && store.getState().playback.state === 'playing') {
    store.setPlaybackState('stopped');
    updatePlayState(false);
    // Return Performance state to idle.
    if (store.getState().performance.phase === 'playing') {
      store.setPerformPhase('idle');
      store.setPerformArmed(false);
    }
  }
});

// ── Metronome ───────────────────────────────────────────────────
const metronome = createMetronome(getAudioContext, getMasterGain);
metronome.setEnabled(store.getState().metronomeEnabled);
metronome.setVolume(store.getState().metronomeVolume);
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

createToolbar(toolbarContainer, {
  onScaleRootChange(root: number | null) {
    store.setScaleRoot(root);
    bgDirty = true;
  },
  onScaleIdChange(scaleId: string | null) {
    store.setScaleId(scaleId);
    bgDirty = true;
  },
});

// ── Tool panel (left sidebar, between Transport and Tracks) ────
const toolPanelContainer = document.getElementById('tool-panel')!;
const toolPanel = createToolPanel(toolPanelContainer, {
  onToolChange(tool: ToolMode) {
    store.setTool(tool);
    if (tool !== 'draw' && interaction.drawingCurve) {
      interaction.drawingCurve = null;
    }
    if (tool !== 'draw' && previewActive) {
      preview.stopAll();
      previewActive = false;
    }
    if (tool === 'scissors') {
      interaction.transformBox = null;
      store.setSelectedCurve(null);
      store.setSelectedPoint(null);
    } else if (tool === 'draw') {
      // Clear the transform box but keep the curve selection so Draw extends it.
      interaction.transformBox = null;
    }
  },
});

// ── Harmonic Prism panel (chord-spec picker) ───────────────────
const prismPanelContainer = document.getElementById('prism-panel')!;
const prismPanel = createPrismPanel(prismPanelContainer);
store.subscribe(() => prismPanel.refresh());

// ── Transport controls (in track panel) ────────────────────────
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnRecord = document.getElementById('btn-record') as HTMLButtonElement;
const bpmInput = document.getElementById('input-bpm') as HTMLInputElement;
const loopToggle = document.getElementById('loop-toggle') as HTMLInputElement;
const scrollCanvasToggle = document.getElementById('scroll-canvas-toggle') as HTMLInputElement;
// Inverted semantics: unchecked (thumb left) = Canvas scrolls = scrollCanvasEnabled true.
// Checked (thumb right) = Planchette scrolls = classic static canvas mode.
scrollCanvasToggle.checked = !store.getState().scrollCanvasEnabled;
scrollCanvasToggle.addEventListener('change', () => {
  store.setScrollCanvas(!scrollCanvasToggle.checked);
  scrollCanvasToggle.blur();
});
const pitchHudToggle = document.getElementById('pitch-hud-toggle') as HTMLInputElement;
pitchHudToggle.checked = store.getState().pitchHudVisible;
pitchHudToggle.addEventListener('change', () => {
  store.setPitchHudVisible(pitchHudToggle.checked);
  pitchHudToggle.blur();
});
const countdownOverlay = document.getElementById('countdown-overlay') as HTMLDivElement;

/** Scroll Canvas effective value — forced on while recording (Perform with capture). */
function effectiveScrollCanvas(): boolean {
  const st = store.getState();
  return st.scrollCanvasEnabled || st.performance.recordArmed;
}
/** Minimum offsetX for clamping — negative when Scroll Canvas is on so beat 0 can
 * reach the rail at canvas centre. */
function minPanOffsetX(canvasWidth: number): number {
  return store.getState().scrollCanvasEnabled
    ? -(canvasWidth * RAIL_SCREEN_X_RATIO) / viewport.state.zoomX
    : 0;
}
/** True when a Scroll-Canvas Playback state hijacks LMB for Perform. */
function isComposePerformActive(): boolean {
  return playback.isPlaying() && effectiveScrollCanvas();
}

function updatePlayState(playing: boolean) {
  btnPlay.disabled = playing;
  btnPause.disabled = !playing;
}

function updateRecordButtonVisuals() {
  const st = store.getState();
  const g = st.performance;

  btnRecord.removeAttribute('hidden');
  btnRecord.classList.toggle('armed', g.recordArmed && g.phase !== 'playing');
  btnRecord.classList.toggle('recording', g.recordArmed && g.phase === 'playing');
  btnRecord.disabled = st.selectedTrackId === null;

  scrollCanvasToggle.checked = !st.scrollCanvasEnabled;

  // Lock loop toggle while recording.
  loopToggle.disabled = g.recordArmed && g.phase === 'playing';
}

/** Format a length in beats + BPM as "M:SS" for the toolbar title display. */
function formatLengthMMSS(lengthBeats: number, bpm: number): string {
  const seconds = bpm > 0 ? lengthBeats * 60 / bpm : 0;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function updateBpm(bpm: number) {
  bpmInput.value = String(bpm);
}

/** Resolve the current loop range from the composition. */
function getLoopRange(): { start: number; end: number } {
  const comp = store.getComposition();
  return { start: comp.loopStartBeats, end: comp.loopEndBeats };
}

/** Start playback. When Loop is on, use the composition's loop markers as the play range. */
function startPlayback() {
  if (previewActive) { preview.stopAll(); previewActive = false; }
  const state = store.getState();
  // When Scroll Canvas is on, the user sees a stationary rail — Play should start
  // from whatever beat sits under the rail right now, not from the stored position.
  // With the toggle off, fall back to the classic stored playhead position.
  const r = canvasContainer.getBoundingClientRect();
  const railBeat = Math.max(0, viewport.screenToWorld(r.width * RAIL_SCREEN_X_RATIO, 0).wx);
  const pos = state.scrollCanvasEnabled ? railBeat : state.playback.positionBeats;
  let startBeat: number;
  let endBeat: number | undefined;
  let loopStart: number | undefined;
  if (playback.isLoopEnabled()) {
    const range = getLoopRange();
    // Resume from current position if it's inside the loop; else start at loopStart.
    startBeat = (pos > range.start && pos < range.end) ? pos : range.start;
    endBeat = range.end;
    loopStart = range.start;
  } else {
    startBeat = pos;
    endBeat = undefined;
    loopStart = 0;
  }
  playback.play(state.composition, startBeat, endBeat, loopStart);
  if (!playback.isPlaying()) return;
  store.setPlaybackState('playing');
  updatePlayState(true);
  // Snap the viewport on the first frame of scrolling playback so there's no flash
  // of the old static offset before the render loop takes over.
  if (state.scrollCanvasEnabled) {
    const r = canvasContainer.getBoundingClientRect();
    scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
    bgDirty = true;
  }
}

btnPlay.addEventListener('click', () => {
  startPlayback();
});

btnPause.addEventListener('click', () => {
  // During recording, pause means "end the recording session" —
  // otherwise the record would silently continue on next play.
  if (store.getState().performance.recordArmed) {
    composePerformStop();
    return;
  }
  playback.pause();
  store.setPlaybackState('paused');
  updatePlayState(false);
});

btnStop.addEventListener('click', () => {
  // Cleanly end any active Perform/Record session AND stop playback.
  const g = store.getState().performance;
  if (g.phase !== 'idle' || g.recordArmed) {
    composePerformStop();
  } else {
    playback.stop();
  }
  store.setPlaybackState('stopped');
  store.setPlaybackPosition(0);
  updatePlayState(false);
});

btnRecord.addEventListener('click', () => {
  if (store.getState().selectedTrackId === null) return; // no track to record onto
  composeToggleArmed();
  updateRecordButtonVisuals();
});

bpmInput.addEventListener('change', () => {
  const bpm = Math.max(20, Math.min(300, Number(bpmInput.value)));
  bpmInput.value = String(bpm);
  history.snapshot();
  store.setBpm(bpm);
});

// ── Time signature dropdown ────────────────────────────────────
const timeSigSelect = document.getElementById('input-time-sig') as HTMLSelectElement;
{
  const comp = store.getComposition();
  timeSigSelect.value = `${comp.beatsPerMeasure}/${comp.timeSignatureDenominator}`;
}
timeSigSelect.addEventListener('change', () => {
  const [numStr, denStr] = timeSigSelect.value.split('/');
  const num = Number(numStr);
  const den = Number(denStr);
  if (!Number.isFinite(num) || !Number.isFinite(den)) return;
  history.snapshot();
  store.setTimeSignature(num, den);
  bgDirty = true;
  timeSigSelect.blur();
});

// ── Live MIDI input ─────────────────────────────────────────────
const midiInput = createMidiInput();
const midiDeviceSelect = document.getElementById('input-midi-device') as HTMLSelectElement;

function refreshMidiDeviceList() {
  const active = midiInput.getActiveDeviceId();
  const devices = midiInput.getDevices();
  midiDeviceSelect.innerHTML = '<option value="">None</option>'
    + devices.map(d => `<option value="${d.id}">${d.name || d.manufacturer || d.id}</option>`).join('');
  midiDeviceSelect.value = active ?? '';
}

midiInput.onDevicesChanged(refreshMidiDeviceList);

midiInput.onNoteOn((note, velocity) => {
  const state = store.getState();
  const trackId = state.selectedTrackId;
  if (!trackId) return;
  const track = state.composition.tracks.find(t => t.id === trackId);
  if (!track) return;
  const tone = state.composition.toneLibrary.find(t => t.id === track.toneId);
  if (!tone) return;
  ensureResumed();
  // Per-note voice ID lets simultaneously-held notes sound in parallel.
  preview.startDrawPreview(tone, note, `midi-${note}`);
  // velocity reserved for a future loudness-mapped preview; stable mid-volume for now.
  void velocity;
});

midiInput.onNoteOff((note) => {
  preview.stopDrawPreview(`midi-${note}`);
});

midiDeviceSelect.addEventListener('change', async () => {
  const id = midiDeviceSelect.value || null;
  if (id && !midiInput.hasAccess()) {
    const ok = await midiInput.requestAccess();
    if (!ok) {
      alert('MIDI access denied or unsupported by this browser.');
      midiDeviceSelect.value = '';
      return;
    }
    refreshMidiDeviceList();
    midiDeviceSelect.value = id;
  }
  midiInput.setActiveDevice(id);
  midiDeviceSelect.blur();
});

// Populate the list lazily on first focus — requesting MIDI access earlier
// would trigger a permission prompt before the user showed intent.
midiDeviceSelect.addEventListener('focus', async () => {
  if (midiInput.hasAccess() || !midiInput.isSupported()) return;
  const ok = await midiInput.requestAccess();
  if (ok) refreshMidiDeviceList();
});

if (!midiInput.isSupported()) {
  midiDeviceSelect.disabled = true;
  midiDeviceSelect.title = 'MIDI Input Not Supported By Browser.';
}

// ── Snap toggle (Transport) ────────────────────────────────────
const snapToggleInput = document.getElementById('snap-toggle') as HTMLInputElement;
snapToggleInput.checked = store.getState().snapEnabled;
snapToggleInput.addEventListener('change', () => {
  store.setSnap(snapToggleInput.checked);
  syncSnapPresetUi();
  snapToggleInput.blur();
});

// ── Magnetic Snap toggle + strength slider + spring slider (Transport) ─
const magneticToggle = document.getElementById('magnetic-toggle') as HTMLInputElement;
const magneticStrengthSlider = document.getElementById('input-magnetic-strength') as HTMLInputElement;
const magneticStrengthValue = document.querySelector('.magnetic-strength-value') as HTMLSpanElement;
const magneticSpringSlider = document.getElementById('input-magnetic-spring') as HTMLInputElement;
const magneticSpringValue = document.querySelector('.magnetic-spring-value') as HTMLSpanElement;
const magneticDampingSlider = document.getElementById('input-magnetic-damping') as HTMLInputElement;
const magneticDampingValue = document.querySelector('.magnetic-damping-value') as HTMLSpanElement;

function formatDamping(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

/** Push the current snap-section AppState values back into the DOM controls.
 *  Called on initial load and after a preset is applied. */
function syncSnapSectionDom(): void {
  const st = store.getState();
  snapToggleInput.checked = st.snapEnabled;
  magneticToggle.checked = st.magneticEnabled;
  magneticStrengthSlider.value = String(st.magneticStrength);
  magneticStrengthValue.textContent = st.magneticStrength.toFixed(2);
  magneticSpringSlider.value = String(st.magneticSpringK);
  magneticSpringValue.textContent = String(Math.round(st.magneticSpringK));
  magneticDampingSlider.value = String(st.magneticDamping);
  magneticDampingValue.textContent = formatDamping(st.magneticDamping);
}
syncSnapSectionDom();

magneticToggle.addEventListener('change', () => {
  store.setMagneticEnabled(magneticToggle.checked);
  syncSnapPresetUi();
  magneticToggle.blur();
});
magneticStrengthSlider.addEventListener('input', () => {
  const s = Number(magneticStrengthSlider.value);
  store.setMagneticStrength(s);
  magneticStrengthValue.textContent = s.toFixed(2);
  syncSnapPresetUi();
});
magneticSpringSlider.addEventListener('input', () => {
  const k = Number(magneticSpringSlider.value);
  store.setMagneticSpringK(k);
  magneticSpringValue.textContent = String(Math.round(k));
  syncSnapPresetUi();
});
magneticDampingSlider.addEventListener('input', () => {
  const d = Number(magneticDampingSlider.value);
  store.setMagneticDamping(d);
  magneticDampingValue.textContent = formatDamping(d);
  syncSnapPresetUi();
});

// ── Snap presets (BACKLOG 8.6) ─────────────────────────────────
const snapPresetSelect = document.getElementById('snap-preset-select') as HTMLSelectElement;
const snapPresetSaveBtn = document.getElementById('snap-preset-save') as HTMLButtonElement;
const snapPresetDeleteBtn = document.getElementById('snap-preset-delete') as HTMLButtonElement;

const CUSTOM_PRESET_VALUE = '__custom__';
let userSnapPresets: SnapPreset[] = loadUserSnapPresets();
/** The preset the user explicitly picked (via dropdown change or Save). Cleared
 *  when settings drift away from it. Lets the dropdown stick on the user's
 *  intended preset even when a built-in also matches. */
let activeSnapPresetId: string | null = null;

function getAllPresets(): SnapPreset[] {
  return [...BUILTIN_SNAP_PRESETS, ...userSnapPresets];
}

/** Repopulate the dropdown, then sync its selected value to the active preset
 *  (if it still matches), else the first matching preset, else "Custom". Also
 *  drives the Delete button enabled state. */
function syncSnapPresetUi(): void {
  const liveSnap = store.getComposition().snap;

  // Repopulate (cheap; only ~4 builtins + a handful of user presets).
  snapPresetSelect.innerHTML = '';
  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_PRESET_VALUE;
  customOpt.textContent = 'Custom';
  customOpt.disabled = true;
  customOpt.hidden = true;   // only shown when actually selected (no preset matches)
  snapPresetSelect.appendChild(customOpt);

  const builtinGroup = document.createElement('optgroup');
  builtinGroup.label = 'Built-in';
  for (const p of BUILTIN_SNAP_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    builtinGroup.appendChild(opt);
  }
  snapPresetSelect.appendChild(builtinGroup);

  if (userSnapPresets.length > 0) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User';
    for (const p of userSnapPresets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      userGroup.appendChild(opt);
    }
    snapPresetSelect.appendChild(userGroup);
  }

  // Resolve which preset to show as selected:
  //   1. If the active preset still matches → keep it.
  //   2. Else clear active and fall back to first matching preset.
  //   3. Else show "Custom".
  let active: SnapPreset | null = activeSnapPresetId
    ? getAllPresets().find(p => p.id === activeSnapPresetId) ?? null
    : null;
  if (active && !presetMatches(active, liveSnap)) {
    active = null;
    activeSnapPresetId = null;
  }
  const match = active ?? getAllPresets().find(p => presetMatches(p, liveSnap)) ?? null;
  if (match) {
    snapPresetSelect.value = match.id;
    customOpt.hidden = true;
  } else {
    customOpt.hidden = false;
    snapPresetSelect.value = CUSTOM_PRESET_VALUE;
  }

  // Delete is only valid for an active USER preset.
  snapPresetDeleteBtn.disabled = !match || !userSnapPresets.some(u => u.id === match.id);
}
syncSnapPresetUi();

snapPresetSelect.addEventListener('change', () => {
  const id = snapPresetSelect.value;
  if (id === CUSTOM_PRESET_VALUE) return;
  const preset = getAllPresets().find(p => p.id === id);
  if (!preset) return;
  // Apply each defined field via the corresponding setter (write-through to comp.snap).
  // Note: no history.snapshot() — preset loading mirrors the magnetic-slider precedent.
  const s = preset.settings;
  if (s.enabled !== undefined) store.setSnap(s.enabled);
  if (s.magneticEnabled !== undefined) store.setMagneticEnabled(s.magneticEnabled);
  if (s.magneticStrength !== undefined) store.setMagneticStrength(s.magneticStrength);
  if (s.magneticSpringK !== undefined) store.setMagneticSpringK(s.magneticSpringK);
  if (s.magneticDamping !== undefined) store.setMagneticDamping(s.magneticDamping);
  activeSnapPresetId = preset.id;
  syncSnapSectionDom();
  syncSnapPresetUi();
  snapPresetSelect.blur();
});

snapPresetSaveBtn.addEventListener('click', async () => {
  const existingNames = getAllPresets().map(p => p.name);
  const name = await openPresetSaveDialog({
    title: 'Save Snap Preset',
    existingNames,
  });
  if (!name) return;
  const preset = snapshotPreset(name, store.getComposition().snap);
  userSnapPresets = [...userSnapPresets, preset];
  saveUserSnapPresets(userSnapPresets);
  activeSnapPresetId = preset.id;   // make the new preset the active one
  syncSnapPresetUi();
  showToast(`Saved snap preset "${name}".`);
});

snapPresetDeleteBtn.addEventListener('click', () => {
  const id = snapPresetSelect.value;
  const target = userSnapPresets.find(p => p.id === id);
  if (!target) return;
  if (!confirm(`Delete user preset "${target.name}"?`)) return;
  userSnapPresets = userSnapPresets.filter(p => p.id !== id);
  saveUserSnapPresets(userSnapPresets);
  if (activeSnapPresetId === id) activeSnapPresetId = null;
  syncSnapPresetUi();
});

// ── Snap guides (BACKLOG 8.7) ──────────────────────────────────
const guidesVisibleToggle = document.getElementById('guides-visible-toggle') as HTMLInputElement;
const addGuideXBtn = document.getElementById('add-guide-x-btn') as HTMLButtonElement;
const addGuideYBtn = document.getElementById('add-guide-y-btn') as HTMLButtonElement;
guidesVisibleToggle.checked = store.getState().guidesVisible;
guidesVisibleToggle.addEventListener('change', () => {
  store.setGuidesVisible(guidesVisibleToggle.checked);
  bgDirty = true;
  guidesVisibleToggle.blur();
});

/** Add a guide at the centre of the current viewport on the requested axis,
 *  then auto-select it so the user can immediately drag or rename it. */
function addGuideAtViewportCenter(orientation: 'x' | 'y'): void {
  const r = canvasContainer.getBoundingClientRect();
  const centre = viewport.screenToWorld(r.width / 2, r.height / 2);
  const position = orientation === 'x'
    ? Math.max(0, Math.round(centre.wx * 4) / 4)   // round to nearest 1/4 beat for tidiness
    : Math.round(centre.wy);                        // nearest semitone
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
  if (!store.getState().guidesVisible) {
    store.setGuidesVisible(true);
    guidesVisibleToggle.checked = true;
  }
  bgDirty = true;
}
addGuideXBtn.addEventListener('click', () => { addGuideAtViewportCenter('x'); addGuideXBtn.blur(); });
addGuideYBtn.addEventListener('click', () => { addGuideAtViewportCenter('y'); addGuideYBtn.blur(); });

// ── Metronome controls ─────────────────────────────────────────
const metronomeToggle = document.getElementById('metronome-toggle') as HTMLInputElement;
const metronomeVolumeSlider = document.getElementById('metronome-volume') as HTMLInputElement;
metronomeToggle.checked = store.getState().metronomeEnabled;
metronomeVolumeSlider.value = String(Math.round(store.getState().metronomeVolume * 100));
metronomeToggle.addEventListener('change', () => {
  store.setMetronomeEnabled(metronomeToggle.checked);
  metronomeToggle.blur();
});
metronomeVolumeSlider.addEventListener('input', () => {
  store.setMetronomeVolume(Number(metronomeVolumeSlider.value) / 100);
});

loopToggle.addEventListener('change', () => {
  playback.setLoop(loopToggle.checked);
  // If toggling on mid-play, update the play range to the markers right away.
  if (playback.isPlaying()) {
    const comp = store.getComposition();
    if (loopToggle.checked) {
      playback.setPlayRange(comp.loopStartBeats, comp.loopEndBeats);
    } else {
      playback.setPlayRange(0, getCompositionLength(comp));
    }
  }
  loopToggle.blur();
});

// ── Zoom controls (on canvas) ──────────────────────────────────
const zoomX = document.getElementById('zoom-x') as HTMLInputElement;
const zoomY = document.getElementById('zoom-y') as HTMLInputElement;

/** Zoom X slider uses a logarithmic mapping so a single slider covers the full
 *  ~1200× range (0.5..600 px/beat) without the low-zoom end squeezing out all
 *  the useful mid-zoom resolution. */
const ZOOM_X_LOG_STEPS = 1000;
const ZOOM_X_LOG_RATIO = Math.log(MAX_ZOOM_X / MIN_ZOOM_X);
function sliderPosToZoomX(pos: number): number {
  const t = Math.max(0, Math.min(1, pos / ZOOM_X_LOG_STEPS));
  return MIN_ZOOM_X * Math.exp(t * ZOOM_X_LOG_RATIO);
}
function zoomXToSliderPos(zoom: number): number {
  const t = Math.log(zoom / MIN_ZOOM_X) / ZOOM_X_LOG_RATIO;
  return Math.round(Math.max(0, Math.min(1, t)) * ZOOM_X_LOG_STEPS);
}
// Initialize slider position from current zoomX.
zoomX.value = String(zoomXToSliderPos(viewport.state.zoomX));

/** Anchor for slider zoom: center of selection bbox if any selected, else canvas center. */
function getSliderZoomAnchor(): { sx: number; sy: number } {
  const rect = canvasContainer.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const state = store.getState();
  if (state.selectedCurveIds.size === 0) return { sx: cx, sy: cy };
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return { sx: cx, sy: cy };
  const selected = track.curves.filter(c => state.selectedCurveIds.has(c.id));
  if (selected.length === 0) return { sx: cx, sy: cy };
  const bbox = computeMultiCurveBBox(selected);
  const wx = (bbox.minX + bbox.maxX) / 2;
  const wy = (bbox.minY + bbox.maxY) / 2;
  return viewport.worldToScreen(wx, wy);
}

zoomX.addEventListener('input', () => {
  const target = sliderPosToZoomX(Number(zoomX.value));
  const factor = target / viewport.state.zoomX;
  if (factor !== 1 && isFinite(factor)) {
    viewport.zoomXAt(factor, getSliderZoomAnchor().sx);
  } else {
    viewport.setZoomX(target);
  }
  const rect = canvasContainer.getBoundingClientRect();
  viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
  bgDirty = true;
});
zoomY.addEventListener('input', () => {
  const target = Number(zoomY.value);
  const factor = target / viewport.state.zoomY;
  if (factor !== 1 && isFinite(factor)) {
    viewport.zoomYAt(factor, getSliderZoomAnchor().sy);
  } else {
    viewport.setZoomY(target);
  }
  const rect = canvasContainer.getBoundingClientRect();
  viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
  bgDirty = true;
});
// Release focus after the user finishes adjusting so hotkeys (e.g. Space) don't
// get captured by the range input.
zoomX.addEventListener('change', () => zoomX.blur());
zoomY.addEventListener('change', () => zoomY.blur());

function updateZoom() {
  zoomX.value = String(zoomXToSliderPos(viewport.state.zoomX));
  zoomY.min = String(viewport.minZoomY);
  zoomY.value = String(viewport.state.zoomY);
}

// ── Composition name field (prepended to toolbar) ──────────────
const toolbarRow = toolbarContainer.querySelector('.toolbar-row')!;
const nameGroup = document.createElement('div');
nameGroup.className = 'toolbar-group';
const nameInput = document.createElement('input');
nameInput.type = 'text';
nameInput.id = 'comp-name';
nameInput.className = 'comp-name-input';
nameInput.value = store.getComposition().name || 'Untitled';
nameInput.title = 'Composition name';
nameInput.spellcheck = false;
nameInput.addEventListener('change', () => {
  store.mutate(c => { c.name = nameInput.value || 'Untitled'; });
});
nameInput.addEventListener('keydown', (e) => {
  // Enter commits and blurs (the change event then fires from the blur).
  // Escape reverts to the stored name and blurs.
  if (e.key === 'Enter') {
    e.preventDefault();
    nameInput.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    nameInput.value = store.getComposition().name || 'Untitled';
    nameInput.blur();
  }
});
nameGroup.appendChild(nameInput);
const lengthDisplay = document.createElement('span');
lengthDisplay.id = 'comp-length';
lengthDisplay.className = 'comp-length-display';
lengthDisplay.title = 'Composition length (derived from last point)';
lengthDisplay.textContent = '0:00';
nameGroup.appendChild(lengthDisplay);
toolbarRow.insertBefore(nameGroup, toolbarRow.firstChild);

// ── File dropdown menu ────────────────────────────────────────
const fileGroup = document.createElement('div');
fileGroup.className = 'toolbar-group file-menu-wrapper';

const fileBtn = document.createElement('button');
fileBtn.className = 'tb-btn';
fileBtn.textContent = 'File \u25BE';
fileBtn.title = 'File operations';
fileGroup.appendChild(fileBtn);

const fileDropdown = document.createElement('div');
fileDropdown.className = 'file-menu-dropdown';
fileDropdown.hidden = true;
fileGroup.appendChild(fileDropdown);

const fileOverlay = document.createElement('div');
fileOverlay.className = 'file-menu-overlay';
fileOverlay.hidden = true;
document.body.appendChild(fileOverlay);

function closeFileMenu() {
  fileDropdown.hidden = true;
  fileOverlay.hidden = true;
}

fileBtn.addEventListener('click', () => {
  const open = fileDropdown.hidden;
  fileDropdown.hidden = !open;
  fileOverlay.hidden = !open;
});

fileOverlay.addEventListener('click', closeFileMenu);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !fileDropdown.hidden) closeFileMenu();
});

function addFileMenuItem(label: string, handler: () => void) {
  const item = document.createElement('button');
  item.className = 'file-menu-item';
  item.textContent = label;
  item.addEventListener('click', () => {
    closeFileMenu();
    handler();
  });
  fileDropdown.appendChild(item);
}

addFileMenuItem('Save Composition', () => {
  const comp = store.getComposition();
  const json = serializeComposition(comp);
  downloadFile(json, `${comp.name || 'composition'}.json`);
});

addFileMenuItem('Load Composition', async () => {
  try {
    const json = await openFile('.json');
    const comp = deserializeComposition(json);
    history.snapshot();
    playback.stop();
    store.loadComposition(comp);
    updatePlayState(false);
    nameInput.value = comp.name || 'Untitled';
  } catch (e) {
    console.error('Failed to load:', e);
  }
});

addFileMenuItem('Import MIDI', async () => {
  try {
    const buffer = await openBinaryFile('.mid,.midi');
    const comp = midiToComposition(buffer);
    history.snapshot();
    playback.stop();
    store.loadComposition(comp);
    updatePlayState(false);
    nameInput.value = comp.name || 'Untitled';
  } catch (e) {
    console.error('MIDI import failed:', e);
  }
});

addFileMenuItem('Export WAV', async () => {
  const comp = store.getComposition();
  try {
    await exportWav(comp);
  } catch (e) {
    console.error('WAV export failed:', e);
  }
});

addFileMenuItem('User Manual (?)', () => {
  window.open('/help.html', '_blank');
});

toolbarRow.insertBefore(fileGroup, nameGroup.nextSibling);

// ── Save / Load / Export buttons (added to toolbar) ─────────────

function addToolbarButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const group = document.createElement('div');
  group.className = 'toolbar-group';
  const btn = document.createElement('button');
  btn.className = 'tb-btn';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  group.appendChild(btn);
  toolbarRow.appendChild(group);
  return btn;
}

// ── Join helper ────────────────────────────────────────────────
function performJoin() {
  const state = store.getState();
  if (state.selectedCurveIds.size < 2) return;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return;
  const curves = [...state.selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is import('./types').BezierCurve => !!c);
  if (curves.length < 2) return;
  // Refuse to join curves from different groups (a chord-cluster member
  // can't be merged with a curve from a different cluster). Ungrouped
  // curves can always join each other; same-group siblings join freely
  // and the joined result keeps the group id.
  const groupIds = new Set(curves.map(c => c.groupId).filter((g): g is string => !!g));
  if (groupIds.size > 1) {
    showToast("Can't join curves from different groups");
    return;
  }
  const threshold = Math.max(8 / viewport.state.zoomX, 8 / viewport.state.zoomY);
  const { merged, consumedIds } = joinCurves(curves, threshold);
  if (consumedIds.size < 2) return;
  // Inherit the shared group id (if any) onto the merged curve.
  const sharedGroup = groupIds.size === 1 ? [...groupIds][0]! : null;
  if (sharedGroup) merged.groupId = sharedGroup;
  history.snapshot();
  store.mutate(() => {
    for (let i = track.curves.length - 1; i >= 0; i--) {
      if (consumedIds.has(track.curves[i]!.id)) track.curves.splice(i, 1);
    }
    track.curves.push(merged);
  });
  store.setSelectedCurve(merged.id);
  store.setSelectedPoint(null);
  interaction.transformBox = null;
}

function performSharpen() {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0) return;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return;
  const curves = [...state.selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is import('./types').BezierCurve => !!c);
  if (curves.length === 0) return;
  history.snapshot();
  store.mutate(() => {
    for (const curve of curves) sharpenCurveHandles(curve);
  });
}

function performSmooth() {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0) return;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return;
  const curves = [...state.selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is import('./types').BezierCurve => !!c);
  if (curves.length === 0) return;
  history.snapshot();
  store.mutate(() => {
    const ratio = store.getState().autoSmoothXRatio;
    for (const curve of curves) smoothCurveHandles(curve, ratio);
  });
}

// ── Group / Ungroup helpers ────────────────────────────────────
function performGroup() {
  const state = store.getState();
  if (state.selectedCurveIds.size < 2) return;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return;
  const curves = [...state.selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is import('./types').BezierCurve => !!c);
  if (curves.length < 2) return;
  if (allShareGroup(curves)) return;  // already grouped
  history.snapshot();
  store.mutate(() => {
    assignGroup(curves);
  });
  rebuildTransformBox(interaction, track);
}

function performUngroup() {
  const state = store.getState();
  if (state.selectedCurveIds.size === 0) return;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) return;
  const selected = [...state.selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is import('./types').BezierCurve => !!c);
  if (!anyGrouped(selected)) return;
  // Expand: every member of every selected curve's group is dissolved.
  const groupIds = new Set(selected.map(c => c.groupId).filter((g): g is string => !!g));
  const allMembers = track.curves.filter(c => c.groupId && groupIds.has(c.groupId));
  if (allMembers.length === 0) return;
  history.snapshot();
  store.mutate(() => {
    dissolveGroup(allMembers);
  });
  rebuildTransformBox(interaction, track);
}
// ── Undo / Redo buttons ────────────────────────────────────────
function clearInteractionForUndo() {
  interaction.drawingCurve = null;
  interaction.dragging = null;
  interaction.transformBox = null;
}

const undoBtn = addToolbarButton('Undo', 'Undo (Ctrl+Z)', () => { clearInteractionForUndo(); history.undo(); });
const redoBtn = addToolbarButton('Redo', 'Redo (Ctrl+Shift+Z)', () => { clearInteractionForUndo(); history.redo(); });

undoBtn.disabled = true;
redoBtn.disabled = true;

history.subscribe(() => {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
});

// ── Keyboard shortcuts ──────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.repeat) return;
    if (store.getState().selectedTrackId === null) return;
    composeToggleArmed();
    return;
  }
  if (e.key === 'Escape') {
    const g = store.getState().performance;
    if (g.phase === 'countdown' || g.recordArmed) {
      e.preventDefault();
      composePerformStop();
      store.setPlaybackState('stopped');
      updatePlayState(false);
      return;
    }
    // Clear Harmonic Prism projection if it's the only thing active.
    if (store.getState().harmonicPrism.projectionSourceId) {
      e.preventDefault();
      store.setPrismProjectionSource(null);
      bgDirty = true;
      return;
    }
  }

  // Undo / Redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    clearInteractionForUndo();
    if (e.shiftKey) {
      history.redo();
    } else {
      history.undo();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    clearInteractionForUndo();
    history.redo();
    return;
  }

  // Copy / Cut / Paste / Duplicate
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    copySelectedCurves();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    if (cutSelectedCurves()) {
      interaction.transformBox = null;
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    const state = store.getState();
    // In Scroll Canvas mode the rail (visible canvas-centre beat) is what the
    // user reads as "current position". When playback is stopped, the stored
    // playhead can lag behind a manual pan, so derive the rail beat from the
    // viewport instead. During playback the two coincide (scrolling-play
    // tracks the playhead), so this is also safe there.
    let atBeat = state.playback.positionBeats;
    if (state.scrollCanvasEnabled && !playback.isPlaying()) {
      const rect = fgCanvas.getBoundingClientRect();
      const centreX = rect.width * RAIL_SCREEN_X_RATIO;
      atBeat = viewport.state.offsetX + centreX / viewport.state.zoomX;
    }
    const newIds = pasteCurves(atBeat);
    if (newIds) {
      const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
      if (track) rebuildTransformBox(interaction, track);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const newIds = continueCurves();
    if (newIds) {
      const state = store.getState();
      const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
      if (track) rebuildTransformBox(interaction, track);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const newIds = duplicateCurves();
    if (newIds) {
      const state = store.getState();
      const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
      if (track) rebuildTransformBox(interaction, track);
    }
    return;
  }

  // Join selected curves
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    performJoin();
    return;
  }

  // Harmonic Prism — Ctrl+H toggles Projection mode on the selected curve
  // (browser binds Ctrl+H to the History panel, so always preventDefault).
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    const prism = store.getState().harmonicPrism;
    if (prism.projectionSourceId) {
      store.setPrismProjectionSource(null);
      bgDirty = true; // staff comes back
    } else {
      const sel = store.getSelectedCurveId();
      if (sel) {
        store.setPrismProjectionSource(sel);
        bgDirty = true; // staff hides
      }
    }
    return;
  }

  // Group / Ungroup
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    performUngroup();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    performGroup();
    return;
  }

  // Sharpen selected curve(s) — clear all bezier handles to make every point sharp.
  // Uses e.code for Alt-letter because some layouts (e.g. macOS) remap e.key with Option.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS') {
    e.preventDefault();
    performSharpen();
    return;
  }

  // Smooth selected curve(s) — reset every point to the auto-smoothing handle defaults.
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyS') {
    e.preventDefault();
    performSmooth();
    return;
  }

  switch (e.key) {
    case ' ': {
      e.preventDefault();
      if (e.repeat) break; // auto-repeat shouldn't re-fire the timer
      // Start (or reset) the hold timer. A release before SPACE_HOLD_MS is a tap; a
      // release after activates preview then stops it on keyup.
      if (spaceHoldTimer !== null) window.clearTimeout(spaceHoldTimer);
      spaceHoldTimer = window.setTimeout(activateSpacePreview, SPACE_HOLD_MS);
      break;
    }
    case 'd':
      store.setTool('draw');
      toolPanel.updateTool('draw');
      interaction.transformBox = null;
      break;
    case 'v':
      store.setTool('select');
      toolPanel.updateTool('select');
      break;
    case 'x':
      store.setTool('delete');
      toolPanel.updateTool('delete');
      break;
    case 'c':
      store.setTool('scissors');
      toolPanel.updateTool('scissors');
      interaction.transformBox = null;
      store.setSelectedCurve(null);
      store.setSelectedPoint(null);
      break;
    case 's': {
      const snapEnabled = !store.getState().snapEnabled;
      store.setSnap(snapEnabled);
      break;
    }
    case 'h':
    case 'H': {
      // Harmonic Prism — toggle Draw mode (chord-cluster placement).
      const prism = store.getState().harmonicPrism;
      store.setPrismDrawMode(!prism.drawMode);
      break;
    }
    case 'l':
    case 'L': {
      const loopCb = document.getElementById('loop-toggle') as HTMLInputElement | null;
      if (loopCb) {
        loopCb.checked = !loopCb.checked;
        playback.setLoop(loopCb.checked);
      }
      break;
    }
    case '?':
      window.open('/help.html', '_blank');
      break;
    case 'PageUp':
    case 'PageDown': {
      // Jump the viewport to the first (PageUp) or last (PageDown) control point
      // across all tracks in the composition. PageUp on an empty canvas falls
      // back to beat 0 so there's always a reliable home position; PageDown on
      // an empty canvas is a no-op.
      e.preventDefault();
      const comp = store.getComposition();
      let minX: number | null = null;
      let maxX: number | null = null;
      for (const track of comp.tracks) {
        for (const curve of track.curves) {
          for (const pt of curve.points) {
            if (minX === null || pt.position.x < minX) minX = pt.position.x;
            if (maxX === null || pt.position.x > maxX) maxX = pt.position.x;
          }
        }
      }
      let target: number;
      if (e.key === 'PageUp') {
        target = minX ?? 0;
      } else {
        if (maxX === null) return;
        target = maxX;
      }
      const r = canvasContainer.getBoundingClientRect();
      scrollViewportToBeat(viewport, target, r.width, r.height);
      bgDirty = true;
      return;
    }
    case 'Home': {
      // Centre the viewport on the current playhead beat regardless of where
      // the user has panned. While playing, the audio engine owns the position;
      // when stopped, ruler-scrub updates `state.playback.positionBeats` —
      // matches the renderer's playhead lookup.
      e.preventDefault();
      const r = canvasContainer.getBoundingClientRect();
      const playheadBeat = playback.isPlaying()
        ? playback.getPositionBeats()
        : store.getState().playback.positionBeats;
      scrollViewportToBeat(viewport, playheadBeat, r.width, r.height);
      bgDirty = true;
      return;
    }
    case 'Delete':
    case 'Backspace': {
      const s = store.getState();
      // Delete selected guide first — guides are mutually exclusive with curve
      // selection, but check explicitly so a stale ID doesn't fall through.
      if (s.selectedGuideId) {
        history.snapshot();
        store.removeGuide(s.selectedGuideId);
        bgDirty = true;
        break;
      }
      // Delete selected point (only when a single curve is selected with a point)
      const delCurveId = store.getSelectedCurveId();
      if (delCurveId && s.selectedPointIndex !== null) {
        const track = s.composition.tracks.find(t => t.id === s.selectedTrackId);
        const curve = track?.curves.find(c => c.id === delCurveId);
        if (curve) {
          history.snapshot();
          store.mutate(() => {
            curve.points.splice(s.selectedPointIndex!, 1);
            if (curve.points.length === 0 && track) {
              const idx = track.curves.indexOf(curve);
              if (idx >= 0) track.curves.splice(idx, 1);
            }
          });
          store.setSelectedPoint(null);
          store.setSelectedCurve(curve.points.length > 0 ? curve.id : null);
        }
      }
      break;
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  // Mirror the keydown guard — otherwise typing a space into a form field still
  // releases through to the transport tap action.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  // If the timer is still pending, the key was a tap — run the transport action.
  // If it already fired, decide based on whether preview actually started:
  //   - previewActive: hold-release, just stop preview (no tap action).
  //   - !previewActive: timer fired but context didn't allow preview (e.g. recording) —
  //     still treat release as a tap so transport responds.
  const wasTap = spaceHoldTimer !== null;
  if (spaceHoldTimer !== null) {
    window.clearTimeout(spaceHoldTimer);
    spaceHoldTimer = null;
  }
  if (wasTap || !previewActive) {
    handleSpaceTap();
    return;
  }
  preview.stopAll();
  previewActive = false;
});

// ── Track panel ─────────────────────────────────────────────────
function renderTrackList() {
  const trackList = document.getElementById('track-list')!;
  const state = store.getState();
  const comp = state.composition;

  trackList.innerHTML = '';
  for (const track of comp.tracks) {
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    const isSelected = track.id === state.selectedTrackId;
    const div = document.createElement('div');
    div.className = `track-item${isSelected ? ' selected' : ''}${track.muted ? ' muted' : ''}`;
    div.innerHTML = `
      <div class="track-color" style="background:${tone?.color ?? '#888'}"></div>
      <div class="track-info">
        <span class="track-name">${track.name}</span>
        <span class="track-tone tone-name-clickable" style="color:${tone?.color ?? '#888'}" title="Click to change tone">${tone?.name ?? '?'}</span>
      </div>
      <div class="track-controls">
        <button class="track-mute ${track.muted ? 'active' : ''}" title="Mute">M</button>
        <button class="track-solo ${track.solo ? 'active' : ''}" title="Solo">S</button>
        <button class="track-edit-tone" title="Edit tone">T</button>
      </div>
    `;

    div.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('track-mute')) {
        history.snapshot();
        store.mutate(() => { track.muted = !track.muted; });
        return;
      }
      if (target.classList.contains('track-solo')) {
        history.snapshot();
        store.mutate(() => { track.solo = !track.solo; });
        return;
      }
      if (target.classList.contains('track-edit-tone')) {
        const currentTone = comp.toneLibrary.find(t => t.id === track.toneId);
        if (currentTone) {
          openToneBuilder(currentTone).then(result => {
            if (result.action === 'save') {
              history.snapshot();
              store.mutate(c => {
                const idx = c.toneLibrary.findIndex(t => t.id === result.tone.id);
                if (idx >= 0) c.toneLibrary[idx] = result.tone;
              });
            }
          });
        }
        return;
      }
      if (target.classList.contains('tone-name-clickable')) {
        openTonePicker(comp.toneLibrary, track.toneId, target).then(picked => {
          if (picked) {
            history.snapshot();
            store.mutate(() => { track.toneId = picked.id; });
          }
        });
        return;
      }
      store.setSelectedTrack(track.id);
      // Select all curves in this track and build a transform box
      if (track.curves.length > 0) {
        const curveIds = track.curves.map(c => c.id);
        store.setSelectedCurves(curveIds);
        // Build transform box around all curves
        const map = new Map<string, ControlPoint[]>();
        for (const c of track.curves) {
          map.set(c.id, deepCopyPoints(c.points));
        }
        interaction.transformBox = {
          curveIds,
          originalPointsMap: map,
          bbox: computeMultiCurveBBox(track.curves),
          activeHandle: null,
          dragStart: null,
        };
        // Switch to select tool so the transform box is usable
        store.setTool('select');
      }
    });

    trackList.appendChild(div);
  }
}

document.getElementById('add-track-btn')!.addEventListener('click', async () => {
  const comp = store.getComposition();
  // Show tone picker anchored to the add button
  const btn = document.getElementById('add-track-btn')!;
  const picked = await openTonePicker(comp.toneLibrary, null, btn);
  if (!picked) return; // Cancelled
  history.snapshot();
  const track = createTrack(`Track ${comp.tracks.length + 1}`, picked.id);
  store.mutate(c => { c.tracks.push(track); });
  store.setSelectedTrack(track.id);
});

document.getElementById('new-tone-btn')!.addEventListener('click', async () => {
  const result = await openToneBuilder();
  if (result.action === 'save') {
    history.snapshot();
    store.mutate(c => { c.toneLibrary.push(result.tone); });
  }
});

// ── Mouse interaction on canvas ─────────────────────────────────
let isPanning = false;
let lastMouse = { x: 0, y: 0 };

fgCanvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    fgCanvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    // During scrolling Playback the X offset is owned by the scroll formula — a
    // user pan in X would fight it each frame. Allow only Y.
    const scrollingPlayback = store.getState().scrollCanvasEnabled && playback.isPlaying();
    const dx = scrollingPlayback ? 0 : (e.clientX - lastMouse.x);
    const dy = e.clientY - lastMouse.y;
    viewport.panBy(dx, dy);
    const rect = canvasContainer.getBoundingClientRect();
    // When Scroll Canvas is on, the rail is pinned at canvas-centre. Allow offsetX
    // to go negative by half the canvas width so the user can pan beat 0 all the
    // way over to the rail — matches the scrolling-play clamp.
    viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
    lastMouse = { x: e.clientX, y: e.clientY };
    bgDirty = true;
  }
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    fgCanvas.style.cursor = '';
  }
});

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
  bgDirty = true;
}, { passive: false });

// ── Compose Perform: LMB sounding + record + planchette-for-HUD ─────
const COMPOSE_COUNTDOWN_SECONDS = 3;
const composeEngine = createPerformanceEngine({
  countdownSeconds: COMPOSE_COUNTDOWN_SECONDS,
  afkTimeoutMs: 20_000,
  recordingBufferMax: 3600,
  loopWrapThresholdBeats: 0.5,
});

const magneticState = createMagneticState();

/** Last known compose-mode cursor screen Y. Cached so the per-frame pitch-mode
 *  tick can keep advancing the planchette pitch even when the mouse isn't moving. */
let lastComposeSy: number | null = null;

function computeComposeCursorPitch(sy: number): { cursorWorldY: number; snappedWorldY: number; snapTarget: number } {
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
  const nowBeats = playback.getPositionBeats();
  // Magnetic only applies while the user is actively sounding a tone (LMB-held
  // performance). Hovering in Select/Draw/etc should track the cursor instantly.
  const performing = composeEngine.isLmbDown();

  // Magnetic mode: spring-mass physics with nearest-snap attractor. Uses only
  // the nearest snap line — two overlapping wells with linear falloff cancel
  // each other exactly in the inter-snap region, producing zero net pull.
  if (st.snapEnabled && performing && st.magneticEnabled) {
    const magneticPitch = updateMagnetic(magneticState, wy, nowBeats, st.magneticStrength, st.magneticSpringK, st.magneticDamping, [snapped.wy]);
    return { cursorWorldY: wy, snappedWorldY: magneticPitch, snapTarget: snapped.wy };
  }

  // Default path: instant snap (or raw cursor Y when snap is off).
  resetMagnetic(magneticState);
  return { cursorWorldY: wy, snappedWorldY: snapped.wy, snapTarget: snapped.wy };
}

/** Previous snap target. Used to trigger the snap-line-cross pulse on target
 *  changes rather than on every frame while magnetic physics is interpolating. */
let prevSnapTarget: number | null = null;

function composeUpdatePlanchette(sy: number) {
  lastComposeSy = sy;
  if (sy < RULER_HEIGHT && !composeEngine.isLmbDown()) {
    store.setPlanchetteY('primary', null, null);
    resetMagnetic(magneticState);
    prevSnapTarget = null;
    lastComposeSy = null;
    return;
  }
  const { cursorWorldY, snappedWorldY, snapTarget } = computeComposeCursorPitch(sy);
  store.setPlanchetteY('primary', cursorWorldY, snappedWorldY);
  // Snap-line-cross pulse — fire on target change, not on every frame of
  // magnetic physics interpolation.
  if (prevSnapTarget != null && prevSnapTarget !== snapTarget) {
    store.markPlanchetteCrossed('primary', Date.now());
  }
  prevSnapTarget = snapTarget;
  // Drive harmony voices off the primary's snapped Y. No-op outside Prism Draw
  // perform (no harmony planchettes exist) so cheap to call unconditionally.
  updateHarmonyVoices(snappedWorldY);
}

/** Harmony voiceId for chord index i (1..N-1, since 0 = primary). */
function harmonyVoiceId(harmonyIndex: number): string {
  return `harmony-${harmonyIndex}`;
}

/** Re-tune all currently-active harmony voices' pitch and synth from the primary's
 *  snapped Y. Called every cursor-update tick during Prism-Draw perform. */
function updateHarmonyVoices(snappedBaseY: number) {
  const st = store.getState();
  const planchettes = st.performance.planchettes;
  if (planchettes.length <= 1) return; // only primary present — no harmonies active
  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  for (let i = 1; i < offsets.length; i++) {
    const voiceId = harmonyVoiceId(i - 1);
    const planchette = planchettes.find(p => p.voiceId === voiceId);
    if (!planchette) continue; // harmony index disabled this gesture (e.g. spec changed numVoices)
    const harmonyY = snappedBaseY + offsets[i]!;
    const inRange = harmonyY >= MIN_NOTE && harmonyY <= MAX_NOTE;
    // cursorWorldY mirrors snapped (harmonies never have an independent raw
    // cursor — they're math offsets), so the rail render skips the ghost dot.
    store.setPlanchetteY(voiceId, inRange ? harmonyY : null, inRange ? harmonyY : null);
    if (inRange && preview.isDrawPreviewActive(voiceId)) {
      preview.updateDrawPitch(harmonyY, voiceId);
    }
  }
}

/** Per-frame pitch-mode tick: re-runs composeUpdatePlanchette with the last
 *  known cursor Y so Magnetic physics keeps advancing even when the mouse is
 *  still. Also updates the currently-sounding synth so the audible pitch
 *  matches. No-op when Magnetic is off. */
function tickComposePitchMode() {
  if (lastComposeSy === null) return;
  const st = store.getState();
  if (!st.snapEnabled || !st.magneticEnabled) return;
  composeUpdatePlanchette(lastComposeSy);
  if (composeEngine.isLmbDown()) {
    const p = store.getState().performance.planchettes[0];
    if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
  }
}

// ── Y auto-scroll during Perform / Record ──────────────────────
// When LMB is held (perform / record), if the cursor approaches the top or
// bottom of the canvas, pan the viewport Y so the user can drag past the
// current visible pitch range without releasing. Pan rate scales with how
// close the cursor is to the edge.
const PERFORM_Y_EDGE_PX = 30;            // distance from edge that triggers scroll
const PERFORM_Y_PAN_PX_PER_FRAME = 4;    // peak scroll speed (at the very edge / off-canvas)

function tickPerformYAutoScroll() {
  if (!composeEngine.isLmbDown()) return;
  if (lastComposeSy === null) return;
  const rect = fgCanvas.getBoundingClientRect();
  const top = RULER_HEIGHT;
  const bottom = rect.height;
  let dsy = 0;
  if (lastComposeSy < top + PERFORM_Y_EDGE_PX) {
    // Near top → reveal higher pitches above (pan world up = increase offsetY).
    const closeness = Math.min(1, (top + PERFORM_Y_EDGE_PX - lastComposeSy) / PERFORM_Y_EDGE_PX);
    dsy = +PERFORM_Y_PAN_PX_PER_FRAME * closeness;
  } else if (lastComposeSy > bottom - PERFORM_Y_EDGE_PX) {
    // Near bottom (or off-canvas below) → reveal lower pitches.
    const closeness = Math.min(1, (lastComposeSy - (bottom - PERFORM_Y_EDGE_PX)) / PERFORM_Y_EDGE_PX);
    dsy = -PERFORM_Y_PAN_PX_PER_FRAME * closeness;
  }
  if (dsy === 0) return;
  const beforeOffsetY = viewport.state.offsetY;
  viewport.panBy(0, dsy);
  viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
  // If clampOffset rejected the pan (already at the Y bound), stop here so we
  // don't waste work re-evaluating the planchette / synth pitch.
  if (viewport.state.offsetY === beforeOffsetY) return;
  bgDirty = true;
  // The world Y under the (unchanged screen) cursor has shifted — re-snap and
  // re-tune the held perform tone.
  composeUpdatePlanchette(lastComposeSy);
  const p = store.getState().performance.planchettes[0];
  if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
}

function getSelectedTrackTone() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  if (!trackId) return null;
  const track = st.composition.tracks.find(t => t.id === trackId);
  if (!track) return null;
  return st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null;
}

function startComposePerformSounding(snappedBaseY: number) {
  const tone = getSelectedTrackTone();
  if (!tone) return;
  // The planchette array is already populated by syncHarmonyPlanchettes
  // (which runs every frame and tracks drawMode + playback/record state).
  // Just spin up a synth for each currently-active voice.
  const st = store.getState();
  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  for (const p of st.performance.planchettes) {
    const y = voiceYFromBase(p.voiceId, snappedBaseY, offsets);
    if (y == null) continue;
    preview.startDrawPreview(tone, y, p.voiceId);
  }
  store.setPerformLmbSounding(true);
}
function updateComposePerformPitch(snappedBaseY: number) {
  // Primary's pitch update; harmony pitch updates are driven by
  // composeUpdatePlanchette → updateHarmonyVoices.
  if (preview.isDrawPreviewActive('primary')) {
    preview.updateDrawPitch(snappedBaseY, 'primary');
  }
}
function stopComposePerformSounding() {
  // Stop every active synth (primary + any harmonies). Planchette removal is
  // handled by syncHarmonyPlanchettes when playback ends or drawMode toggles
  // off; leaving the planchettes in place during continuing playback gives
  // the user persistent chord-shape feedback even between LMB presses.
  const planchettes = store.getState().performance.planchettes;
  for (const p of planchettes) preview.stopDrawPreview(p.voiceId);
  store.setPerformLmbSounding(false);
}

/** Compute the world Y a voice should sit at, given the primary's snapped Y
 *  and the current chord-spec offsets. Returns null if voice is out of range
 *  or if the spec doesn't include a slot for this voiceId. */
function voiceYFromBase(voiceId: string, snappedBaseY: number, offsets: readonly number[]): number | null {
  let y: number;
  if (voiceId === 'primary') {
    y = snappedBaseY;
  } else {
    const harmonyIdx = parseHarmonyIndex(voiceId);
    if (harmonyIdx == null) return null;
    const offsetIdx = harmonyIdx + 1;
    if (offsetIdx >= offsets.length) return null;
    y = snappedBaseY + offsets[offsetIdx]!;
  }
  if (y < MIN_NOTE || y > MAX_NOTE) return null;
  return y;
}

/** Parse 'harmony-N' → N. Returns null for non-harmony voiceIds. */
function parseHarmonyIndex(voiceId: string): number | null {
  if (!voiceId.startsWith('harmony-')) return null;
  const n = Number(voiceId.slice('harmony-'.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Reconcile the planchette array with current Prism Draw + playback/record
 *  state. Called every render frame; cheap when state already matches. */
function syncHarmonyPlanchettes() {
  const st = store.getState();
  const wantHarmonies = st.harmonicPrism.drawMode &&
    (playback.isPlaying() || st.performance.recordArmed);

  if (!wantHarmonies) {
    for (const p of st.performance.planchettes) {
      if (p.voiceId !== 'primary') preview.stopDrawPreview(p.voiceId);
    }
    store.removeHarmonyPlanchettes();
    return;
  }

  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  const desiredHarmonyIds = new Set<string>();
  for (let i = 1; i < offsets.length; i++) desiredHarmonyIds.add(harmonyVoiceId(i - 1));

  // Remove voices no longer in spec (numVoices reduced).
  const toRemove: string[] = [];
  for (const p of st.performance.planchettes) {
    if (p.voiceId === 'primary') continue;
    if (!desiredHarmonyIds.has(p.voiceId)) toRemove.push(p.voiceId);
  }
  for (const voiceId of toRemove) {
    preview.stopDrawPreview(voiceId);
    store.removePerformPlanchette(voiceId);
  }

  // Add voices not yet present (numVoices increased or first time entering).
  // Seed each new harmony's Y from the primary so the rail shows it immediately
  // (otherwise the planchette has null Y until the next mousemove tick).
  const primary = st.performance.planchettes.find(pp => pp.voiceId === 'primary');
  for (let i = 1; i < offsets.length; i++) {
    const voiceId = harmonyVoiceId(i - 1);
    if (st.performance.planchettes.some(p => p.voiceId === voiceId)) continue;
    let initialY: number | null = null;
    if (primary?.snappedWorldY != null) {
      const y = primary.snappedWorldY + offsets[i]!;
      if (y >= MIN_NOTE && y <= MAX_NOTE) initialY = y;
    }
    store.addPerformPlanchette({
      voiceId,
      trackId: st.selectedTrackId,
      cursorWorldY: initialY,
      snappedWorldY: initialY,
      lastCrossedAt: 0,
    });
    // If LMB is held when a new voice spawns (e.g. user just toggled drawMode
    // mid-perform), start its synth at the right pitch immediately.
    if (composeEngine.isLmbDown() && initialY != null) {
      const tone = getSelectedTrackTone();
      if (tone) preview.startDrawPreview(tone, initialY, voiceId);
    }
  }
}

// ── Prism idle preview (Spacebar) ──────────────────────────────
/** Start the Spacebar idle preview as a Prism chord cluster when drawMode is
 *  on, otherwise a single voice. Mirrors the perform-time multi-voice setup
 *  but uses the Spacebar-preview path (no recording, no planchettes added —
 *  the active draw-mode preview dots already show the cursor cluster). */
function startPrismDrawPreview(tone: import('./types').ToneDefinition, snappedBaseY: number) {
  preview.startDrawPreview(tone, snappedBaseY, 'primary');
  const st = store.getState();
  if (!st.harmonicPrism.drawMode) return;
  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  for (let i = 1; i < offsets.length; i++) {
    const voiceId = harmonyVoiceId(i - 1);
    const y = snappedBaseY + offsets[i]!;
    if (y < MIN_NOTE || y > MAX_NOTE) continue;
    preview.startDrawPreview(tone, y, voiceId);
  }
}

/** Re-tune all currently-active idle preview voices from the primary's Y. */
function updatePrismDrawPreview(snappedBaseY: number) {
  preview.updateDrawPitch(snappedBaseY, 'primary');
  const st = store.getState();
  if (!st.harmonicPrism.drawMode) return;
  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  for (let i = 1; i < offsets.length; i++) {
    const voiceId = harmonyVoiceId(i - 1);
    if (!preview.isDrawPreviewActive(voiceId)) continue;
    const y = snappedBaseY + offsets[i]!;
    if (y >= MIN_NOTE && y <= MAX_NOTE) preview.updateDrawPitch(y, voiceId);
  }
}

function captureComposeRecordingSample() {
  const g = store.getState().performance;
  if (g.phase !== 'playing' || !g.recordArmed || !composeEngine.isLmbDown()) return;
  const beat = playback.getPositionBeats();
  // Capture every active voice (primary + any chord-cluster harmonies). The
  // engine's captureSample is keyed by voiceId and already supports N parallel
  // buffers — this is the multi-voice extension of the single-voice path.
  for (const p of g.planchettes) {
    if (p.snappedWorldY == null) continue;
    composeEngine.captureSample(p.voiceId, {
      beat,
      note: p.snappedWorldY,
      volume: 0.8,
    });
  }
}

function finalizeComposeRecordedCurves() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
  // Voice ids that may have buffers to flush (primary + every active harmony).
  const voiceIds = st.performance.planchettes.map(p => p.voiceId);
  if (!track) {
    for (const v of voiceIds) composeEngine.clearBuffer(v);
    return;
  }
  // Finalize each voice's buffer. finalizeCurve handles the once-per-session
  // history snapshot — passing the same callback for every voice is safe
  // because the engine debounces it via sessionHistorySnapshotted.
  const finalized: Array<{ voiceId: string; curve: import('./types').BezierCurve }> = [];
  for (const voiceId of voiceIds) {
    const curve = composeEngine.finalizeCurve(voiceId, () => history.snapshot());
    if (curve) finalized.push({ voiceId, curve });
  }
  if (finalized.length === 0) return;

  // If multi-voice, stamp the finalized curves as a chord cluster so they
  // behave like a Phase-2 Draw-mode placement (group selection, group delete,
  // group transform). Single-voice (no harmonies) records ungrouped as today.
  const isCluster = finalized.length > 1;
  const groupId = isCluster ? createGroupId() : null;
  store.mutate(() => {
    for (let i = 0; i < finalized.length; i++) {
      const { curve, voiceId } = finalized[i]!;
      if (groupId) {
        curve.groupId = groupId;
        curve.voiceIndex = i;
      }
      track.curves.push(curve);
      store.setPerformCurrentCurve(voiceId, curve.id);
    }
  });
}

function tickComposePerform() {
  const g = store.getState().performance;
  composeEngine.tick({
    now: performance.now(),
    audioNow: getAudioContext().currentTime,
    isPlaying: playback.isPlaying(),
    phase: g.phase,
    recordArmed: g.recordArmed,
    countdownStartedAt: g.countdownStartedAt,
    playbackBeat: playback.getPositionBeats(),
    onCountdownElapsed: startComposePerformPlayback,
    onLoopWrap: () => {
      if (g.recordArmed && composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
    },
    onAfkTimeout: composePerformStop,
  });
}

function startComposePerformPlayback() {
  const st = store.getState();
  const comp = st.composition;
  const compLength = getCompositionLength(comp);
  // Record forces Scroll Canvas on, so the rail is visible. Start from whichever beat
  // the user sees under the rail right now rather than the stored position.
  const r = canvasContainer.getBoundingClientRect();
  let startBeat = Math.max(0, viewport.screenToWorld(r.width * RAIL_SCREEN_X_RATIO, 0).wx);
  let endBeat: number;
  let loopStart = 0;
  // With Loop on: respect the composition's loop range so the performance wraps and
  // the engine's loop-wrap detection fires (planchette flash + finalize current curve).
  // With Loop off: extend end far past content so the canvas keeps scrolling during recording.
  if (playback.isLoopEnabled()) {
    const lStart = comp.loopStartBeats;
    const lEnd = comp.loopEndBeats;
    if (startBeat < lStart || startBeat >= lEnd) startBeat = lStart;
    endBeat = lEnd;
    loopStart = lStart;
  } else {
    endBeat = Math.max(compLength, startBeat) + 10_000;
  }
  playback.play(comp, startBeat, endBeat, loopStart);
  store.setPlaybackState('playing');
  store.setPerformPhase('playing');
  composeEngine.startSession(performance.now());
  updatePlayState(true);
  // Snap viewport immediately to avoid first-frame flash.
  scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
  bgDirty = true;
}

function composeToggleArmed() {
  if (store.getState().selectedTrackId === null) return;
  const g = store.getState().performance;

  // Recording → full stop: commit any in-progress curve, stop playback, return to idle.
  if (g.phase === 'playing' && g.recordArmed) {
    composePerformStop();
    store.setPlaybackState('stopped');
    return;
  }

  // Countdown → cancel back to idle.
  if (g.phase === 'countdown') {
    store.setPerformArmed(false);
    store.setPerformCountdownStartedAt(0);
    store.setPerformPhase('idle');
    return;
  }

  // Playback already running (classic or Perform) → arm immediately, no countdown.
  // Set perform phase to 'playing' so the render loop captures samples. Extend the
  // play range if looping is off so recording can continue past composition end.
  if (playback.isPlaying()) {
    ensureResumed();
    store.setPerformArmed(true);
    store.setPerformPhase('playing');
    composeEngine.startSession(performance.now());
    if (!playback.isLoopEnabled()) {
      const pos = playback.getPositionBeats();
      const comp = store.getComposition();
      playback.setPlayRange(0, Math.max(getCompositionLength(comp), pos) + 10_000);
    }
    return;
  }

  // Truly idle → start countdown + Perform-playback flow.
  ensureResumed();
  store.setPerformArmed(true);
  store.setPerformCountdownStartedAt(getAudioContext().currentTime);
  store.setPerformPhase('countdown');
  composeEngine.startSession(performance.now());
}

function composePerformStop() {
  const g = store.getState().performance;
  if (g.phase === 'playing' && g.recordArmed && composeEngine.isLmbDown()) {
    finalizeComposeRecordedCurves();
  }
  if (composeEngine.isLmbDown()) {
    stopComposePerformSounding();
  }
  preview.stopDrawPreview('primary');
  if (playback.isPlaying()) playback.stop();
  composeEngine.stopSession();
  store.setPerformPhase('idle');
  store.setPerformArmed(false);
  store.setPerformCountdownStartedAt(0);
  store.setPerformLmbSounding(false);
  updatePlayState(false);
}

// Canvas mousedown: intercept LMB for Perform when active.
fgCanvas.addEventListener('mousedown', (e) => {
  if (!isComposePerformActive()) return;
  if (e.button !== 0) return;
  const rect = fgCanvas.getBoundingClientRect();
  const sy = e.clientY - rect.top;
  if (sy < RULER_HEIGHT) return;
  composeUpdatePlanchette(sy);
  composeEngine.onLmbDown(performance.now());
  const planchette = store.getState().performance.planchettes[0];
  if (planchette?.snappedWorldY != null) {
    startComposePerformSounding(planchette.snappedWorldY);
  }
  e.preventDefault();
}, true);  // Capture phase so it fires before interaction.ts's bubbling handler.

fgCanvas.addEventListener('mousemove', (e) => {
  const rect = fgCanvas.getBoundingClientRect();
  const sy = e.clientY - rect.top;
  composeUpdatePlanchette(sy);
  if (composeEngine.isLmbDown()) {
    const p = store.getState().performance.planchettes[0];
    if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
  }
});

fgCanvas.addEventListener('mouseleave', () => {
  if (!composeEngine.isLmbDown()) {
    store.setPlanchetteY('primary', null, null);
    resetMagnetic(magneticState);
    prevSnapTarget = null;
    lastComposeSy = null;
  }
});

// Right-click action menu. Disabled during Compose Performance (recording / sounding)
// because curves being captured shouldn't be mutated out from under the engine.
fgCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isComposePerformActive()) return;
  const state = store.getState();
  const selectedCount = state.selectedCurveIds.size;
  const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
  const selectedCurves = track
    ? [...state.selectedCurveIds]
        .map(id => track.curves.find(c => c.id === id))
        .filter((c): c is import('./types').BezierCurve => !!c)
    : [];
  const canGroup = selectedCount >= 2 && !allShareGroup(selectedCurves);
  const canUngroup = selectedCount >= 1 && anyGrouped(selectedCurves);
  openContextMenu(e.pageX, e.pageY, [
    {
      label: 'Smooth Curve',
      shortcut: 'Shift+S',
      disabled: selectedCount === 0,
      onClick: performSmooth,
    },
    {
      label: 'Sharpen Curve',
      shortcut: 'Alt+S',
      disabled: selectedCount === 0,
      onClick: performSharpen,
    },
    {
      label: 'Join',
      shortcut: 'Ctrl+J',
      disabled: selectedCount < 2,
      onClick: performJoin,
    },
    {
      label: 'Group',
      shortcut: 'Ctrl+G',
      disabled: !canGroup,
      onClick: performGroup,
    },
    {
      label: 'Ungroup',
      shortcut: 'Ctrl+Shift+G',
      disabled: !canUngroup,
      onClick: performUngroup,
    },
  ]);
});

// Off-canvas tracking while LMB held in Perform.
window.addEventListener('mousemove', (e) => {
  if (!composeEngine.isLmbDown()) return;
  const rect = fgCanvas.getBoundingClientRect();
  if (e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom) return;
  const sy = e.clientY - rect.top;
  composeUpdatePlanchette(sy);
  const p = store.getState().performance.planchettes[0];
  if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
});

window.addEventListener('mouseup', (e) => {
  if (!composeEngine.isLmbDown()) return;
  if (e.button !== 0) return;
  composeEngine.onLmbUp();
  // CRITICAL ORDERING: finalize BEFORE stopping synths so the planchette array
  // (and therefore the voiceIds we finalize) still contains every active voice.
  // syncHarmonyPlanchettes only removes harmonies when playback ends or drawMode
  // toggles off, neither of which happens at LMB-up — so the array is stable here.
  if (store.getState().performance.recordArmed) {
    finalizeComposeRecordedCurves();
  } else {
    // Clear every voice's buffer (not just primary), since perform without
    // recording still ran captures into N buffers in Prism mode.
    for (const p of store.getState().performance.planchettes) {
      composeEngine.clearBuffer(p.voiceId);
    }
  }
  stopComposePerformSounding();
});

// ── Shared HUD + countdown DOM updaters ─────────────────────────
function updatePitchHudDom(state: AppState) {
  const planchette = state.performance.planchettes[0];
  const show = state.pitchHudVisible && planchette?.snappedWorldY != null;
  if (show) {
    writePitchHud(planchette!.snappedWorldY, planchette!.cursorWorldY);
    pitchHud.removeAttribute('hidden');
  } else if (!pitchHud.hasAttribute('hidden')) {
    pitchHud.setAttribute('hidden', '');
    writePitchHud(null, null);
  }
}

function updateCountdownOverlayDom(state: AppState) {
  if (state.performance.phase !== 'countdown') {
    if (!countdownOverlay.hasAttribute('hidden')) {
      countdownOverlay.setAttribute('hidden', '');
      countdownOverlay.textContent = '';
    }
    return;
  }
  const label = composeEngine.getCountdownLabel(
    getAudioContext().currentTime,
    state.performance.phase,
    state.performance.countdownStartedAt,
  );
  if (countdownOverlay.textContent !== label) countdownOverlay.textContent = label;
  countdownOverlay.removeAttribute('hidden');
}

// ── Render loop ─────────────────────────────────────────────────
function render() {
  // Reconcile harmony planchettes against current state. Cheap no-op when
  // state hasn't changed; covers playback start/stop, drawMode toggle, and
  // mid-playback chord-spec voice-count changes.
  syncHarmonyPlanchettes();

  const state = store.getState();
  const comp = state.composition;
  const rect = canvasContainer.getBoundingClientRect();

  // "Scroll Canvas" view: when the toggle is effectively on during Playback,
  // scroll the viewport each frame so the playhead sits centred on the rail.
  // Toggle off → classic static canvas with the playhead moving across.
  // Recording forces the scrolling view on via `effectiveScrollCanvas()`.
  const composeScrolling = effectiveScrollCanvas() && playback.isPlaying();
  if (composeScrolling) {
    // While recording the in-flight buffer isn't reflected in the composition
    // length yet, so the canvas extent can be shorter than the live playhead —
    // the viewport would clamp and the canvas visually freezes. Bump the extent
    // to stay ahead of the playhead so scroll keeps going until LMB release
    // commits the captured curve (after which syncCompositionDerived takes over).
    const playheadBeat = playback.getPositionBeats();
    const neededExtent = Math.min(MAX_CANVAS_EXTENT, playheadBeat + SCROLL_BUFFER);
    if (viewport.canvasExtent < neededExtent) viewport.canvasExtent = neededExtent;
    scrollViewportToBeat(viewport, playheadBeat, rect.width, rect.height);
    bgDirty = true;
  }

  // Compose performance tick: countdown advance, loop-wrap detection, AFK auto-stop.
  tickComposePerform();

  // Y auto-scroll while LMB held in Perform / Record so the user can drag
  // past the visible pitch range without releasing.
  tickPerformYAutoScroll();

  // Per-frame pitch-mode tick — keeps Glide/Magnetic advancing toward the
  // current target even when the mouse is still. No-op when neither mode is
  // active or snap is off.
  tickComposePitchMode();

  // Per-frame sync for Compose UI affordances
  toolPanel.setDisabled(isComposePerformActive());
  updatePitchHudDom(state);
  updateCountdownOverlayDom(state);

  // Compose perform: record-sample capture each frame while armed + sounding + playing.
  captureComposeRecordingSample();

  // Background: staff grid. Stays visible during Harmonic Prism projection
  // so the user can see where they are in the pitch spectrum; snap itself
  // switches to echo-only targets (see snapToGrid).
  if (bgDirty) {
    const scaleRoot = state.scaleRoot;
    const scale = state.scaleId ? getScaleById(state.scaleId) ?? null : null;
    const measureLen = measureLengthInBeats(comp);
    bgCtx.clearRect(0, 0, rect.width, rect.height);
    renderStaff(bgCtx, viewport, rect.width, rect.height, measureLen, scaleRoot, scale);
    renderRuler(bgCtx, viewport, rect.width, measureLen, comp.bpm);
    bgDirty = false;
  }

  // Clear stale drawingCurve reference. Three cases:
  //   • the curve was deleted (e.g. undo)
  //   • the user selected a different single curve while in Draw — honor the
  //     new selection so the preview line and the next click both target it
  //   • the active tool isn't Draw anymore (hotkey switch bypasses the
  //     toolPanel.onToolChange clear)
  if (interaction.drawingCurve) {
    const track = comp.tracks.find(t => t.id === state.selectedTrackId);
    const singleSelectedId = store.getSelectedCurveId();
    const stale =
      !track ||
      !track.curves.includes(interaction.drawingCurve) ||
      state.activeTool !== 'draw' ||
      (singleSelectedId !== null && singleSelectedId !== interaction.drawingCurve.id);
    if (stale) {
      interaction.drawingCurve = null;
      interaction.dragging = null;
    }
  }

  // Foreground: curves + playhead + interaction
  fgCtx.clearRect(0, 0, rect.width, rect.height);

  // Transform box (rendered behind curves so unselected curves remain clickable)
  if (interaction.transformBox) {
    renderTransformBox(fgCtx, viewport, interaction.transformBox.bbox, interaction.transformBox.activeHandle);
  }

  // Harmonic Prism — resolve the projection source curve up front. If it no
  // longer exists (deleted), exit projection mode automatically.
  let prismSource: BezierCurve | null = null;
  if (state.harmonicPrism.projectionSourceId) {
    const prismSrcId = state.harmonicPrism.projectionSourceId;
    for (const track of comp.tracks) {
      const found = track.curves.find(c => c.id === prismSrcId);
      if (found) { prismSource = found; break; }
    }
    if (!prismSource) {
      store.setPrismProjectionSource(null);
    }
  }

  // Projection echoes: rendered behind curves.
  if (prismSource) {
    renderProjection(
      fgCtx,
      viewport,
      prismSource,
      state.harmonicPrism.chordSpec,
      state.harmonicPrism.projectionOctaveRange,
      rect.width,
      rect.height,
    );
  }

  // Render curves for all tracks
  for (const track of comp.tracks) {
    if (track.muted) continue;
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    if (!tone) continue;

    const isActiveTrack = track.id === state.selectedTrackId;
    const emptySet = new Set<string>();
    renderCurves(
      fgCtx, viewport, track.curves, tone,
      isActiveTrack ? state.selectedCurveIds : emptySet,
      isActiveTrack ? store.getSelectedCurveId() : null,
      isActiveTrack ? state.selectedPointIndex : null,
    );
  }

  // Rainbow highlight on the projection-source curve (drawn last so it sits
  // on top of the normal curve stroke).
  if (prismSource) {
    renderProjectionSourceHighlight(fgCtx, viewport, prismSource);
  }

  // Draw preview line when in draw mode (hidden during Ctrl-select)
  if (state.activeTool === 'draw' && interaction.cursorWorld) {
    // Use the drawing curve, or the single selected curve if not actively drawing
    const singleId = store.getSelectedCurveId();
    const previewCurve = interaction.drawingCurve
      ?? (singleId
        ? comp.tracks.find(t => t.id === state.selectedTrackId)
            ?.curves.find(c => c.id === singleId)
        : null);
    const points = previewCurve?.points;
    const track = comp.tracks.find(t => t.id === state.selectedTrackId);
    const tone = track ? comp.toneLibrary.find(t => t.id === track.toneId) : null;
    const color = tone?.color ?? '#4fc3f7';

    if (points && points.length > 0) {
      const cx = interaction.cursorWorld.x;

      // Find the neighboring point(s) the cursor sits between
      const firstPt = points[0]!;
      const lastPt = points[points.length - 1]!;

      if (cx <= firstPt.position.x) {
        // Before the first point — connect to the first point
        renderDrawPreview(fgCtx, viewport, firstPt.position, interaction.cursorWorld, color);
      } else if (cx >= lastPt.position.x) {
        // After the last point — connect to the last point
        renderDrawPreview(fgCtx, viewport, lastPt.position, interaction.cursorWorld, color);
      } else {
        // Between two points — connect to both neighbors
        for (let i = 0; i < points.length - 1; i++) {
          if (cx >= points[i]!.position.x && cx <= points[i + 1]!.position.x) {
            renderDrawPreview(fgCtx, viewport, points[i]!.position, interaction.cursorWorld, color);
            renderDrawPreview(fgCtx, viewport, points[i + 1]!.position, interaction.cursorWorld, color);
            break;
          }
        }
      }
    } else if (track) {
      // No curve yet — show standalone cursor dot for first point placement
      const scr = viewport.worldToScreen(interaction.cursorWorld.x, interaction.cursorWorld.y);
      fgCtx.beginPath();
      fgCtx.arc(scr.sx, scr.sy, 4, 0, Math.PI * 2);
      fgCtx.fillStyle = color;
      fgCtx.globalAlpha = 0.6;
      fgCtx.fill();
      fgCtx.globalAlpha = 1;
    }
  }

  // Harmonic Prism Draw mode: render the multi-planchette chord preview at the
  // cursor. Each click will place N grouped sibling curves at these Y offsets.
  // Hidden during Playback / Record / countdown — the rail planchettes show
  // the active or imminent tone positions instead, and a stationary chord
  // preview at the cursor would be visually conflicting.
  const isPerformActiveOrPending = playback.isPlaying()
    || state.performance.phase !== 'idle'
    || state.performance.recordArmed;
  if (state.activeTool === 'draw'
      && state.harmonicPrism.drawMode
      && interaction.cursorWorld
      && !isPerformActiveOrPending) {
    const snap = buildSnapConfig(viewport.state.zoomX, interaction.cursorWorld.x);
    const snapped = snapToGrid(interaction.cursorWorld.x, interaction.cursorWorld.y, snap);
    const cursorScreenX = viewport.worldToScreen(snapped.wx, 0).sx;
    renderPrismDrawPreview(
      fgCtx,
      viewport,
      cursorScreenX,
      snapped.wy,
      state.harmonicPrism.chordSpec,
      rect.height,
      RULER_HEIGHT,
    );
  }

  // Scissors preview dot
  if (state.activeTool === 'scissors' && interaction.scissorsPreview) {
    const scr = viewport.worldToScreen(interaction.scissorsPreview.x, interaction.scissorsPreview.y);
    fgCtx.beginPath();
    fgCtx.arc(scr.sx, scr.sy, 5, 0, Math.PI * 2);
    fgCtx.fillStyle = '#ff5252';
    fgCtx.fill();
    fgCtx.lineWidth = 1.5;
    fgCtx.strokeStyle = '#fff';
    fgCtx.stroke();
  }

  // Loop markers (behind the playhead so it stays on top)
  if (playback.isLoopEnabled()) {
    renderLoopMarkers(fgCtx, viewport, comp.loopStartBeats, comp.loopEndBeats, rect.height);
  }

  // Snap guides — between loop markers and the playhead so the playhead always
  // wins Z-order. Skipped when guidesVisible is off (matches snap participation).
  if (state.guidesVisible && comp.guides.length > 0) {
    renderGuides(fgCtx, viewport, comp.guides, rect.width, rect.height, state.selectedGuideId);
  }

  // Playhead vs Rail.
  // Scroll Canvas ON (or Record forcing it on): the playhead becomes a stationary rail
  // at canvas-centre — visible in Idle too, so pressing Play starts from where the user
  // already sees the rail. Rendering mirrors Gliss exactly (rail + planchette dot + pulse).
  // Scroll Canvas OFF: classic moving playhead at the stored position.
  const railVisible = effectiveScrollCanvas();
  const freePlanchetteVisible = !playback.isPlaying()
    && previewActive
    && interaction.cursorInCanvas
    && interaction.cursorWorld != null;
  // Rail-bound planchette dot is only meaningful when an actual or potential
  // tone is sounding/recording — Playback running, Record armed, or LMB held
  // in Perform. In Scroll Canvas idle the rail still shows (so the user knows
  // where Play would start), but the planchette dot is hidden so it doesn't
  // visually promise a tone is sounding when none is.
  const railPlanchetteVisible = railVisible
    && !freePlanchetteVisible
    && (playback.isPlaying()
        || state.performance.recordArmed
        || composeEngine.isLmbDown());
  if (railVisible) {
    if (freePlanchetteVisible) {
      // Free planchette at cursor is the action location (preview tone follows cursor),
      // so draw just the rail — skip the rail-bound planchette dot to avoid a duplicate.
      renderRail(fgCtx, rect.width, rect.height, composeEngine.getLastLoopWrapAt());
      // Composition+tone preview: also render a transient playhead at cursor X so the
      // user can see where in the composition they're scrubbing. Rail still marks where
      // a real Play would start from; this playhead disappears when preview ends.
      if (state.drawPreviewMode === 'composition' && interaction.cursorWorld) {
        renderPlayhead(fgCtx, viewport, interaction.cursorWorld.x, rect.height);
      }
    } else if (railPlanchetteVisible) {
      renderPlanchettes(
        fgCtx, viewport, rect.width, rect.height,
        state.performance.planchettes,
        composeEngine.getLastLoopWrapAt(),
        state.harmonicPrism.drawMode,
      );
    } else {
      renderRail(fgCtx, rect.width, rect.height, composeEngine.getLastLoopWrapAt());
    }
  } else {
    const playheadBeat = playback.isPlaying()
      ? playback.getPositionBeats()
      : state.playback.positionBeats;
    renderPlayhead(fgCtx, viewport, playheadBeat, rect.height);
  }

  // Metronome tick flash: ring at the top of the rail / playhead. Lives briefly
  // and fades, so the user gets a visual beat even if audio is muted or missed.
  const flashAge = performance.now() - lastMetronomeClickAt;
  if (lastMetronomeClickAt > 0 && flashAge < METRONOME_FLASH_DURATION_MS) {
    const flashY = RULER_HEIGHT + 9;
    let flashX: number;
    if (railVisible) {
      flashX = rect.width * RAIL_SCREEN_X_RATIO;
    } else {
      const playheadBeat = playback.isPlaying()
        ? playback.getPositionBeats()
        : state.playback.positionBeats;
      flashX = viewport.worldToScreen(playheadBeat, 0).sx;
    }
    renderMetronomeFlash(fgCtx, flashX, flashY, flashAge, lastMetronomeClickTier);
  }

  // Free planchette: Idle + Space-hold draw preview + cursor over canvas.
  // Rendered at cursor X so the user sees exactly where they'd place / are hearing.
  if (freePlanchetteVisible && interaction.cursorWorld) {
    const cursorWorld = interaction.cursorWorld;
    const cursorScreenX = viewport.worldToScreen(cursorWorld.x, 0).sx;
    const snapConfig = {
      enabled: state.snapEnabled,
      subdivisionsPerBeat: getAdaptiveSubdivisions(viewport.state.zoomX),
      scaleRoot: state.scaleRoot,
      scale: state.scaleId ? getScaleById(state.scaleId) ?? null : null,
    };
    const snapped = snapToGrid(0, cursorWorld.y, snapConfig);
    renderFreePlanchette(
      fgCtx, viewport, cursorScreenX, snapped.wy,
      cursorWorld.y, rect.height,
    );
  }

  requestAnimationFrame(render);
}

/**
 * Sync derived values from the composition: canvas extent (viewport pan bound)
 * and the M:SS length display next to the title. Called on every store change.
 */
function syncCompositionDerived() {
  const comp = store.getComposition();
  const length = getCompositionLength(comp);
  const extent = Math.min(
    MAX_CANVAS_EXTENT,
    Math.max(MIN_CANVAS_EXTENT, length) + SCROLL_BUFFER,
  );
  viewport.canvasExtent = extent;
  lengthDisplay.textContent = formatLengthMMSS(length, comp.bpm);
}

// ── Store subscription ──────────────────────────────────────────
store.subscribe(() => {
  bgDirty = true;
  const comp = store.getComposition();
  updateBpm(comp.bpm);
  const tsValue = `${comp.beatsPerMeasure}/${comp.timeSignatureDenominator}`;
  if (timeSigSelect.value !== tsValue) timeSigSelect.value = tsValue;
  const appState = store.getState();
  if (metronomeToggle.checked !== appState.metronomeEnabled) {
    metronomeToggle.checked = appState.metronomeEnabled;
  }
  if (snapToggleInput.checked !== appState.snapEnabled) {
    snapToggleInput.checked = appState.snapEnabled;
  }
  if (magneticToggle.checked !== appState.magneticEnabled) {
    magneticToggle.checked = appState.magneticEnabled;
  }
  if (Number(magneticStrengthSlider.value) !== appState.magneticStrength) {
    magneticStrengthSlider.value = String(appState.magneticStrength);
    magneticStrengthValue.textContent = appState.magneticStrength.toFixed(2);
  }
  if (Number(magneticSpringSlider.value) !== appState.magneticSpringK) {
    magneticSpringSlider.value = String(appState.magneticSpringK);
    magneticSpringValue.textContent = String(Math.round(appState.magneticSpringK));
  }
  if (Number(magneticDampingSlider.value) !== appState.magneticDamping) {
    magneticDampingSlider.value = String(appState.magneticDamping);
    magneticDampingValue.textContent = formatDamping(appState.magneticDamping);
  }
  metronome.setEnabled(appState.metronomeEnabled);
  metronome.setVolume(appState.metronomeVolume);
  syncCompositionDerived();
  renderTrackList();
  renderPropertyPanel(document.getElementById('prop-content')!);
  renderToolPropertyPanel(document.getElementById('tool-prop-content')!);
  updateRecordButtonVisuals();
  // Keep Play/Pause buttons in sync with playback state — covers transitions that
  // don't flow through startPlayback() (e.g. gliss countdown → playing).
  updatePlayState(store.getState().playback.state === 'playing');

  // Keep the active loop/auto-stop range in sync with the composition's loop markers
  // (so dragging a marker mid-play takes effect on the next wrap).
  // Skip in glissandograph mode (its play range is owned by gliss.startPlayback()).
  // Also skip while Compose is recording — the recording play-range is a large
  // "effectively infinite" endBeat set by startComposePerformPlayback() so the canvas
  // can scroll past composition end; shrinking it here would auto-stop mid-record.
  if (playback.isPlaying()
      && !store.getState().performance.recordArmed) {
    if (playback.isLoopEnabled()) {
      playback.setPlayRange(comp.loopStartBeats, comp.loopEndBeats);
    } else {
      playback.setPlayRange(0, getCompositionLength(comp));
    }
  }
});

// ── Initialization ──────────────────────────────────────────────
syncCompositionDerived();
window.addEventListener('resize', () => { resizeCanvases(); updateZoom(); });
resizeCanvases();

// Default view: about 30 seconds visible in X (at the composition's BPM),
// middle 3 octaves in Y (within the area below the top rulers).
{
  const rect = canvasContainer.getBoundingClientRect();
  const midNote = (MIN_NOTE + MAX_NOTE) / 2;          // F#4 for the 12–120 range
  const visibleSemitones = 36;                         // 3 octaves
  const visibleBeats = (30 / 60) * store.getComposition().bpm;  // 30s of beats
  viewport.setZoomX(rect.width / visibleBeats);
  viewport.setZoomY((rect.height - viewport.topInset) / visibleSemitones);
  viewport.state.offsetX = 0;
  viewport.state.offsetY = midNote + visibleSemitones / 2 + viewport.topInset / viewport.state.zoomY;
  viewport.clampOffset(rect.width, rect.height);
  updateZoom();
  bgDirty = true;
}

renderTrackList();
renderPropertyPanel(document.getElementById('prop-content')!);
renderToolPropertyPanel(document.getElementById('tool-prop-content')!);
updateRecordButtonVisuals();

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

requestAnimationFrame(render);
