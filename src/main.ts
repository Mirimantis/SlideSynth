import { createViewport } from './canvas/viewport';
import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y, MIN_NOTE, MAX_NOTE, Y_PAN_MARGIN, noteNumberToName } from './constants';
import { renderStaff } from './canvas/staff-renderer';
import { renderCurves, renderDrawPreview } from './canvas/curve-renderer';
import { renderTransformBox } from './canvas/transform-box-renderer';
import { renderPlayhead } from './canvas/playhead';
import { renderLoopMarkers } from './canvas/loop-markers';
import { scrollViewportToBeat } from './canvas/scrolling-play';
import { snapToGrid, getAdaptiveSubdivisions } from './utils/snap';
import { createInteraction, rebuildTransformBox, RULER_HEIGHT } from './canvas/interaction';
import { createPreviewManager } from './audio/preview';
import { renderRuler } from './canvas/ruler-renderer';
import { createToolbar } from './ui/toolbar';
import { createPlaybackEngine } from './audio/playback';
import { renderPlanchettes, renderFreePlanchette, RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { renderPropertyPanel } from './ui/property-panel';
import { renderToolPropertyPanel } from './ui/tool-property-panel';
import { openToneBuilder } from './ui/tone-builder';
import { openTonePicker } from './ui/tone-picker';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from './export/json-export';
import { midiToComposition } from './export/midi-import';
import { exportWav } from './export/wav-export';
import { store } from './state/store';
import { history } from './state/history';
import { copySelectedCurves, cutSelectedCurves, pasteCurves, duplicateCurves, continueCurves } from './state/clipboard';
import { createTrack } from './model/track';
import { getCompositionLength } from './model/composition';
import { computeMultiCurveBBox, deepCopyPoints, joinCurves } from './model/curve';
import { createPerformanceEngine } from './canvas/performance-engine';
import { getScaleById } from './utils/scales';
import { ensureResumed, getAudioContext } from './audio/engine';
import type { AppState, ToolMode, ControlPoint } from './types';

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
          <label class="toolbar-loop-label" title="Loop playback (L)">
            <input type="checkbox" id="loop-toggle" />
            <span>Loop</span>
          </label>
        </div>
        <div class="transport-row scroll-switch-row">
          <div class="scroll-switch" title="Choose which element scrolls during Playback: the Canvas (stationary planchette on the rail) or the Planchette (stationary canvas with a moving playhead)">
            <div class="scroll-switch-title">Scroll</div>
            <div class="scroll-switch-control">
              <span class="scroll-switch-side left">Canvas</span>
              <label class="scroll-switch-track">
                <input type="checkbox" id="scroll-canvas-toggle" />
                <span class="scroll-switch-thumb"></span>
              </label>
              <span class="scroll-switch-side right">Planchette</span>
            </div>
          </div>
        </div>
        <div class="transport-row">
          <label id="pitch-hud-label" class="toolbar-loop-label" title="Show the pitch readout when the cursor is over the canvas">
            <input type="checkbox" id="pitch-hud-toggle" />
            <span>Pitch HUD</span>
          </label>
        </div>
        <div class="transport-row">
          <label>BPM</label>
          <input type="number" id="input-bpm" value="120" min="20" max="300" step="1" />
        </div>
      </div>
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
        <input type="range" id="zoom-x" min="${MIN_ZOOM_X}" max="${MAX_ZOOM_X}" value="${viewport.state.zoomX}" step="1" title="Zoom X (time)" />
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
let lastHudText = '';

/** Format the primary planchette's current pitch for the HUD: "C#4 +12¢" or "G5". */
function formatPlanchetteHud(snappedY: number | null, rawY: number | null): string {
  if (snappedY == null) return '';
  const nearest = Math.round(snappedY);
  const cents = Math.round((snappedY - nearest) * 100);
  const name = noteNumberToName(nearest);
  const snapPart = cents === 0 ? name : `${name} ${cents > 0 ? '+' : ''}${cents}¢`;
  if (rawY == null || Math.abs(rawY - snappedY) < 0.02) return snapPart;
  // Raw can land outside the MIDI note range when the cursor is chasing auto-scroll
  // past the clamp — skip the ghost reading in that case.
  const rawNearest = Math.round(rawY);
  if (rawNearest < MIN_NOTE || rawNearest > MAX_NOTE) return snapPart;
  const rawCents = Math.round((rawY - rawNearest) * 100);
  const rawName = noteNumberToName(rawNearest);
  const rawPart = rawCents === 0 ? rawName : `${rawName} ${rawCents > 0 ? '+' : ''}${rawCents}¢`;
  return `${snapPart}  ·  ${rawPart}`;
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
      if (tone) preview.startDrawPreview(tone, interaction.cursorWorld.y);
      previewActive = true;
      // Classic-playhead mode: snap the playhead to the cursor so the user sees the scrub
      // location. Leaves it there on preview end (easy way to summon a far-away playhead).
      if (!state.scrollCanvasEnabled) {
        store.setPlaybackPosition(Math.max(0, interaction.cursorWorld.x));
      }
    } else if (tone && interaction.cursorWorld) {
      preview.startDrawPreview(tone, interaction.cursorWorld.y);
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
      preview.updateDrawPitch(worldY);
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

// ── Toolbar ─────────────────────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;

const toolbar = createToolbar(toolbarContainer, {
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
  onJoin() {
    performJoin();
  },
  onSnapToggle(enabled: boolean) {
    store.setSnap(enabled);
  },
  onScaleRootChange(root: number | null) {
    store.setScaleRoot(root);
    bgDirty = true;
  },
  onScaleIdChange(scaleId: string | null) {
    store.setScaleId(scaleId);
    bgDirty = true;
  },
});

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
  const target = Number(zoomX.value);
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
  zoomX.value = String(viewport.state.zoomX);
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
  const threshold = Math.max(8 / viewport.state.zoomX, 8 / viewport.state.zoomY);
  const { merged, consumedIds } = joinCurves(curves, threshold);
  if (consumedIds.size < 2) return;
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

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
    const atBeat = state.playback.positionBeats;
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
      toolbar.updateTool('draw');
      interaction.transformBox = null;
      break;
    case 'v':
      store.setTool('select');
      toolbar.updateTool('select');
      break;
    case 'x':
      store.setTool('delete');
      toolbar.updateTool('delete');
      break;
    case 'c':
      store.setTool('scissors');
      toolbar.updateTool('scissors');
      interaction.transformBox = null;
      store.setSelectedCurve(null);
      store.setSelectedPoint(null);
      break;
    case 's': {
      const snapEnabled = !store.getState().snapEnabled;
      store.setSnap(snapEnabled);
      toolbar.updateSnap(snapEnabled);
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
    case 'Delete':
    case 'Backspace': {
      // Delete selected point (only when a single curve is selected with a point)
      const s = store.getState();
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

function computeComposeCursorPitch(sy: number): { cursorWorldY: number; snappedWorldY: number } {
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

function composeUpdatePlanchette(sy: number) {
  if (sy < RULER_HEIGHT && !composeEngine.isLmbDown()) {
    store.setPlanchetteY('primary', null, null);
    return;
  }
  const { cursorWorldY, snappedWorldY } = computeComposeCursorPitch(sy);
  const prev = store.getState().performance.planchettes.find(p => p.voiceId === 'primary');
  const prevSnapped = prev?.snappedWorldY ?? null;
  store.setPlanchetteY('primary', cursorWorldY, snappedWorldY);
  // Snap-line-cross pulse tracking (mirrors Gliss behaviour).
  if (prevSnapped != null && prevSnapped !== snappedWorldY) {
    store.markPlanchetteCrossed('primary', Date.now());
  }
}

function getSelectedTrackTone() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  if (!trackId) return null;
  const track = st.composition.tracks.find(t => t.id === trackId);
  if (!track) return null;
  return st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null;
}

function startComposePerformSounding(snappedY: number) {
  const tone = getSelectedTrackTone();
  if (!tone) return;
  preview.startDrawPreview(tone, snappedY, 'primary');
  store.setPerformLmbSounding(true);
}
function updateComposePerformPitch(snappedY: number) {
  if (preview.isDrawPreviewActive('primary')) {
    preview.updateDrawPitch(snappedY, 'primary');
  }
}
function stopComposePerformSounding() {
  preview.stopDrawPreview('primary');
  store.setPerformLmbSounding(false);
}

function captureComposeRecordingSample() {
  const g = store.getState().performance;
  if (g.phase !== 'playing' || !g.recordArmed || !composeEngine.isLmbDown()) return;
  const planchette = g.planchettes[0];
  if (!planchette || planchette.snappedWorldY == null) return;
  composeEngine.captureSample('primary', {
    beat: playback.getPositionBeats(),
    note: planchette.snappedWorldY,
    volume: 0.8,
  });
}

function finalizeComposeRecordedCurve() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
  if (!track) {
    composeEngine.clearBuffer('primary');
    return;
  }
  const curve = composeEngine.finalizeCurve('primary', () => history.snapshot());
  if (!curve) return;
  store.mutate(() => { track.curves.push(curve); });
  store.setPerformCurrentCurve('primary', curve.id);
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
      if (g.recordArmed && composeEngine.isLmbDown()) finalizeComposeRecordedCurve();
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
    finalizeComposeRecordedCurve();
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
  }
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
  stopComposePerformSounding();
  if (store.getState().performance.recordArmed) {
    finalizeComposeRecordedCurve();
  } else {
    composeEngine.clearBuffer('primary');
  }
});

// ── Shared HUD + countdown DOM updaters ─────────────────────────
function updatePitchHudDom(state: AppState) {
  const planchette = state.performance.planchettes[0];
  const show = state.pitchHudVisible && planchette?.snappedWorldY != null;
  if (show) {
    const text = formatPlanchetteHud(planchette!.snappedWorldY, planchette!.cursorWorldY);
    if (text !== lastHudText) {
      pitchHud.textContent = text;
      lastHudText = text;
    }
    pitchHud.removeAttribute('hidden');
  } else if (!pitchHud.hasAttribute('hidden')) {
    pitchHud.setAttribute('hidden', '');
    pitchHud.textContent = '';
    lastHudText = '';
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
  const state = store.getState();
  const comp = state.composition;
  const rect = canvasContainer.getBoundingClientRect();

  // "Scroll Canvas" view: when the toggle is effectively on during Playback,
  // scroll the viewport each frame so the playhead sits centred on the rail.
  // Toggle off → classic static canvas with the playhead moving across.
  // Recording forces the scrolling view on via `effectiveScrollCanvas()`.
  const composeScrolling = effectiveScrollCanvas() && playback.isPlaying();
  if (composeScrolling) {
    scrollViewportToBeat(viewport, playback.getPositionBeats(), rect.width, rect.height);
    bgDirty = true;
  }

  // Compose performance tick: countdown advance, loop-wrap detection, AFK auto-stop.
  tickComposePerform();

  // Per-frame sync for Compose UI affordances
  toolbar.setXYToolsDisabled(isComposePerformActive());
  updatePitchHudDom(state);
  updateCountdownOverlayDom(state);

  // Compose perform: record-sample capture each frame while armed + sounding + playing.
  captureComposeRecordingSample();

  // Background: staff grid
  if (bgDirty) {
    const scaleRoot = state.scaleRoot;
    const scale = state.scaleId ? getScaleById(state.scaleId) ?? null : null;
    renderStaff(bgCtx, viewport, rect.width, rect.height, comp.beatsPerMeasure, scaleRoot, scale);
    renderRuler(bgCtx, viewport, rect.width, comp.beatsPerMeasure, comp.bpm);
    bgDirty = false;
  }

  // Clear stale drawingCurve reference (e.g. after undo removed the curve)
  if (interaction.drawingCurve) {
    const track = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (!track || !track.curves.includes(interaction.drawingCurve)) {
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

  // Playhead vs Rail.
  // Scroll Canvas ON (or Record forcing it on): the playhead becomes a stationary rail
  // at canvas-centre — visible in Idle too, so pressing Play starts from where the user
  // already sees the rail. Rendering mirrors Gliss exactly (rail + planchette dot + pulse).
  // Scroll Canvas OFF: classic moving playhead at the stored position.
  const railVisible = effectiveScrollCanvas();
  if (railVisible) {
    renderPlanchettes(fgCtx, viewport, rect.width, rect.height, state.performance.planchettes, composeEngine.getLastLoopWrapAt());
  } else {
    const playheadBeat = playback.isPlaying()
      ? playback.getPositionBeats()
      : state.playback.positionBeats;
    renderPlayhead(fgCtx, viewport, playheadBeat, rect.height);
  }

  // Free planchette: Idle + Space-hold draw preview + cursor over canvas.
  // Rendered at cursor X so the user sees exactly where they'd place / are hearing.
  if (!playback.isPlaying() && previewActive && interaction.cursorInCanvas && interaction.cursorWorld) {
    const cursorScreenX = viewport.worldToScreen(interaction.cursorWorld.x, 0).sx;
    const snapConfig = {
      enabled: state.snapEnabled,
      subdivisionsPerBeat: getAdaptiveSubdivisions(viewport.state.zoomX),
      scaleRoot: state.scaleRoot,
      scale: state.scaleId ? getScaleById(state.scaleId) ?? null : null,
    };
    const snapped = snapToGrid(0, interaction.cursorWorld.y, snapConfig);
    renderFreePlanchette(
      fgCtx, viewport, cursorScreenX, snapped.wy,
      interaction.cursorWorld.y, rect.height,
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

// Default view: zoomed all the way out in X, middle 3 octaves in Y
// (within the area below the top rulers).
{
  const rect = canvasContainer.getBoundingClientRect();
  const midNote = (MIN_NOTE + MAX_NOTE) / 2;          // F#4 for the 12–120 range
  const visibleSemitones = 36;                         // 3 octaves
  viewport.setZoomX(MIN_ZOOM_X);
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
requestAnimationFrame(render);
