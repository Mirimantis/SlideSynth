import { createViewport } from './canvas/viewport';
import { createParamViewport } from './canvas/param-viewport';
import { renderParamGraph } from './canvas/param-graph-renderer';
import { createParamInteraction } from './canvas/param-interaction';
import { ensureLane, getLane, deepCopyLanes } from './model/lane';
import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, OPEN_END_BEAT, JAM_IDLE_TIMEOUT_MS, KEEP_BUFFER_MS, MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y, MIN_PITCH_CENTS, MAX_PITCH_CENTS, Y_PAN_MARGIN, CENTS_PER_SEMITONE, midiToCents, centsToNoteName, centsToFrequency, setReferenceAHz, getReferenceAHz, centsToReferenceAHz, referenceAHzToCents, STANDARD_A4_HZ } from './constants';
import { renderStaff } from './canvas/staff-renderer';
import { renderCurves, renderDrawPreview } from './canvas/curve-renderer';
import { renderTransformBox } from './canvas/transform-box-renderer';
import { renderMarquee } from './canvas/marquee-renderer';
import { renderProjection, renderProjectionSourceHighlight, renderPrismDrawPreview } from './canvas/projection-renderer';
import { renderPlayhead } from './canvas/playhead';
import { renderLoopMarkers } from './canvas/loop-markers';
import { renderGuides } from './canvas/guides';
import { scrollViewportToBeat } from './canvas/scrolling-play';
import { snapToGrid, getAdaptiveSubdivisions, findAdaptiveSnap } from './utils/snap';
import type { SnapConfig } from './utils/snap';
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
import { renderPlanchettes, renderFreePlanchette, renderRail, renderRecordingTrails, renderMetronomeFlash, METRONOME_FLASH_DURATION_MS, RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { renderPropertyPanel } from './ui/property-panel';
import { renderToolPropertyPanel } from './ui/tool-property-panel';
import { openToneBuilder } from './ui/tone-builder';
import { openTonePicker } from './ui/tone-picker';
import { openPresetSaveDialog } from './ui/preset-save-dialog';
import { openMidiArmDialog } from './ui/midi-arm-dialog';
import { createPerfHud } from './ui/perf-hud';
import { getActiveSynthCount, getActiveOscillatorCount } from './audio/tone-synth';
import { BUILTIN_SNAP_PRESETS, loadUserSnapPresets, saveUserSnapPresets, presetMatches, snapshotPreset, type SnapPreset } from './utils/snap-presets';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from './export/json-export';
import { midiToComposition } from './export/midi-import';
import { exportWav } from './export/wav-export';
import { store } from './state/store';
import { history } from './state/history';
import { copySelectedCurves, cutSelectedCurves, pasteCurves, duplicateCurves, continueCurves } from './state/clipboard';
import { createTrack } from './model/track';
import { getCompositionLength, measureLengthInBeats } from './model/composition';
import { computeMultiCurveBBox, deepCopyPoints, joinCurves, sharpenCurveHandles, smoothCurveHandles, pitchPoints } from './model/curve';
import { assignGroup, dissolveGroup, allShareGroup, anyGrouped, createGroupId } from './model/curve-groups';
import { chordOffsets } from './utils/harmonics';
import { showToast } from './ui/toast';
import { createPerformanceEngine } from './canvas/performance-engine';
import { getScaleById } from './utils/scales';
import { ensureResumed, getAudioContext, getMasterGain } from './audio/engine';
import { createDrawerRail } from './ui/drawer';
import { setIcon } from './utils/svg-helpers';
import iconTransport from './assets/icons/transport.svg?raw';
import iconTools from './assets/icons/tools.svg?raw';
import iconSnap from './assets/icons/snap.svg?raw';
import iconPrism from './assets/icons/prism.svg?raw';
import iconTuning from './assets/icons/tuning.svg?raw';
import iconPlay from './assets/icons/play.svg?raw';
import iconPause from './assets/icons/pause.svg?raw';
import iconStop from './assets/icons/stop.svg?raw';
import iconRecord from './assets/icons/record.svg?raw';
import iconJam from './assets/icons/jam.svg?raw';
import iconKeep from './assets/icons/keep.svg?raw';
import { canOpenLayer, createLayerTrack, newestLayerTrack, nextPassRecordState, LAYER_TRACK_LIMIT } from './model/layer';
import { findDroppablePass, dropPassCurves, type CommittedPass } from './model/pass-log';
import type { AppState, ToolMode, Lane, LanePoint, BezierCurve } from './types';

// ── Viewport ────────────────────────────────────────────────────
const viewport = createViewport();
viewport.topInset = RULER_HEIGHT;

// ── DOM layout ──────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="toolbar">
    <div class="toolbar-row" id="toolbar-left"></div>
    <div class="toolbar-zone center">
      <label class="toggle-switch" title="Lock the playhead rail at canvas centre during playback (the canvas scrolls past it). Off = stationary canvas with a moving playhead.">
        <span class="toggle-switch-track">
          <input type="checkbox" id="lock-rail-toggle" />
          <span class="toggle-switch-thumb"></span>
        </span>
        <span class="toggle-switch-label">Lock Rail</span>
      </label>
    </div>
    <div class="toolbar-zone right">
      <div class="transport-buttons transport">
        <button id="btn-play" title="Play (Space)"></button>
        <button id="btn-pause" title="Pause" disabled></button>
        <button id="btn-stop" title="Stop"></button>
        <button id="btn-record" class="record-btn" title="Record (R) — captures curves onto the selected track" hidden></button>
        <button id="btn-jam" class="jam-btn" title="Jam (J) — free-running clock: sound on, nothing recorded"></button>
        <button id="btn-keep" class="keep-btn" title="Keep that (K) — commit the phrase you just played" disabled></button>
      </div>
      <label class="toggle-switch" title="Toggle snap (S)">
        <span class="toggle-switch-track">
          <input type="checkbox" id="snap-toggle" checked />
          <span class="toggle-switch-thumb"></span>
        </span>
        <span class="toggle-switch-label">Snap</span>
      </label>
    </div>
  </div>
  <div id="main-area">
    <div id="rail">
      <button class="rail-icon" data-drawer="transport" title="Transport" aria-label="Transport"></button>
      <button class="rail-icon" data-drawer="tools" title="Tools" aria-label="Tools"></button>
      <button class="rail-icon" data-drawer="snap" title="Snap" aria-label="Snap"></button>
      <button class="rail-icon" data-drawer="prism" title="Harmonic Prism" aria-label="Harmonic Prism"></button>
      <button class="rail-icon" data-drawer="tuning" title="Tuning" aria-label="Tuning"></button>
    </div>
    <div id="drawer-host">
      <div class="drawer" id="drawer-transport" data-drawer="transport">
        <div class="drawer-header">Transport</div>
        <div id="transport-section">
          <div class="transport-row">
            <label class="toggle-switch" title="Loop playback (L)">
              <span class="toggle-switch-track">
                <input type="checkbox" id="loop-toggle" />
                <span class="toggle-switch-thumb"></span>
              </span>
              <span class="toggle-switch-label">Loop</span>
            </label>
            <label class="toggle-switch" title="Layer mode — each loop pass becomes its own track">
              <span class="toggle-switch-track">
                <input type="checkbox" id="layer-toggle" />
                <span class="toggle-switch-thumb"></span>
              </span>
              <span class="toggle-switch-label">Layer</span>
            </label>
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
            <label id="perf-hud-label" class="toggle-switch" title="Show frame ms, synth/oscillator/voice counts, and audio latency (!)">
              <span class="toggle-switch-track">
                <input type="checkbox" id="perf-hud-toggle" />
                <span class="toggle-switch-thumb"></span>
              </span>
              <span class="toggle-switch-label">Perf HUD</span>
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
      </div>
      <div class="drawer" id="drawer-tools" data-drawer="tools">
        <div class="drawer-header">Tools</div>
        <div id="tool-panel"></div>
      </div>
      <div class="drawer" id="drawer-snap" data-drawer="snap">
        <div class="drawer-header">Snap</div>
        <div id="snap-section">
          <div class="transport-row snap-preset-row">
            <label for="snap-preset-select">Preset</label>
            <select id="snap-preset-select" title="Snap preset — load a saved combo of snap + magnetic settings"></select>
            <button id="snap-preset-save" class="snap-preset-btn" title="Save current snap settings as a new preset">Save</button>
            <button id="snap-preset-delete" class="snap-preset-btn" title="Delete the active user preset" disabled>Del</button>
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
            <input type="range" id="input-magnetic-damping" class="magnetic-damping-slider" min="0.25" max="15" value="3" step="0.25" title="Velocity damping (low = long vibrato wobbles, high = quick settle)" />
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
            <label class="toggle-switch" title="Lock guides — when locked, guides can't be selected, dragged, or deleted from the canvas (snap pull still works)">
              <span class="toggle-switch-track">
                <input type="checkbox" id="guides-locked-toggle" />
                <span class="toggle-switch-thumb"></span>
              </span>
              <span class="toggle-switch-label">Lock</span>
            </label>
            <button id="add-guide-x-btn" class="snap-preset-btn" title="Add a vertical (beat) guide at the centre of the viewport">+ X</button>
            <button id="add-guide-y-btn" class="snap-preset-btn" title="Add a horizontal (pitch) guide at the centre of the viewport">+ Y</button>
          </div>
        </div>
      </div>
      <div class="drawer" id="drawer-prism" data-drawer="prism">
        <div class="drawer-header" title="Harmonic Prism — press H on a selected curve to project harmonic echoes">Harmonic Prism</div>
        <div id="prism-panel"></div>
      </div>
      <div class="drawer" id="drawer-tuning" data-drawer="tuning">
        <div class="drawer-header">Tuning</div>
        <div id="tuning-scale-slot"></div>
        <div id="tuning-section">
          <div class="transport-row">
            <label title="Reference frequency for A4. 440 = standard, 432 = 'Verdi tuning', 415 = Baroque pitch, etc.">Tune A4</label>
            <input type="number" id="input-tuning" value="440" min="380" max="500" step="0.1" title="Reference frequency for A4 in Hz (default 440)" />
            <span class="transport-hint" id="tuning-cents-display" title="Cents offset from A=440">0¢</span>
          </div>
        </div>
      </div>
    </div>
    <div id="center-stack">
      <div id="canvas-container">
        <canvas id="bg-canvas"></canvas>
        <canvas id="fg-canvas"></canvas>
        <div id="zoom-controls">
          <span class="zoom-label">Zoom</span>
          <input type="range" id="zoom-x" min="0" max="1000" value="0" step="1" title="Zoom X (time) — logarithmic" />
          <input type="range" id="zoom-y" min="${MIN_ZOOM_Y}" max="${MAX_ZOOM_Y}" value="${viewport.state.zoomY}" step="0.001" title="Zoom Y (pitch)" />
        </div>
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
      <div id="param-container">
        <div id="param-resize-handle" title="Drag to resize the Parameters Graph"></div>
        <div id="param-graph-label">Volume</div>
        <canvas id="param-canvas"></canvas>
      </div>
    </div>
    <div id="property-panel">
      <div class="panel-header">Tool Properties</div>
      <div id="tool-prop-content"></div>
      <div class="panel-header">Object Properties</div>
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
let lastParamCurveId: string | null = null;
store.subscribe(() => {
  const id = store.getSelectedCurveId();
  if (id !== lastParamCurveId) {
    lastParamCurveId = id;
    paramInteraction.resetSelection();
  }
});

// ── Parameters Graph: drag-to-resize height ────────────────────
const PARAM_HEIGHT_KEY = 'slidesynth.paramGraphHeight';
const PARAM_MIN_H = 60;
function setParamGraphHeight(px: number): void {
  document.documentElement.style.setProperty('--param-graph-height', `${Math.round(px)}px`);
}
// Restore a saved height before the initial canvas sizing.
{
  const saved = Number(localStorage.getItem(PARAM_HEIGHT_KEY));
  if (Number.isFinite(saved) && saved >= PARAM_MIN_H && saved <= 600) setParamGraphHeight(saved);
}
{
  const handle = document.getElementById('param-resize-handle')!;
  const centerStack = document.getElementById('center-stack')!;
  let resizing = false;
  handle.addEventListener('mousedown', (e) => {
    resizing = true;
    handle.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const stack = centerStack.getBoundingClientRect();
    // Keep at least 120px of main canvas above the graph.
    const maxH = Math.max(PARAM_MIN_H, stack.height - 120);
    const h = Math.max(PARAM_MIN_H, Math.min(maxH, stack.bottom - e.clientY));
    setParamGraphHeight(h);
    resizeCanvases();
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('dragging');
    const cur = getComputedStyle(document.documentElement)
      .getPropertyValue('--param-graph-height').trim();
    const px = parseInt(cur, 10);
    if (px) { try { localStorage.setItem(PARAM_HEIGHT_KEY, String(px)); } catch { /* ignore */ } }
  });
}

const pitchHud = document.getElementById('pitch-hud') as HTMLDivElement;

// Fixed-width HUD slots — one <span> per field so the numbers don't shift
// horizontally as cents flip between e.g. "+3¢" and "-12¢". Slots are created
// once and their textContent is updated in place.
pitchHud.innerHTML = `
  <span class="hud-slot hud-note" id="hud-snap-name"></span>
  <span class="hud-slot hud-cents" id="hud-snap-cents"></span>
  <span class="hud-slot hud-hz" id="hud-snap-hz"></span>
  <span class="hud-slot hud-sep" id="hud-sep"></span>
  <span class="hud-slot hud-note" id="hud-raw-name"></span>
  <span class="hud-slot hud-cents" id="hud-raw-cents"></span>
`;
const hudSnapName = document.getElementById('hud-snap-name') as HTMLSpanElement;
const hudSnapCents = document.getElementById('hud-snap-cents') as HTMLSpanElement;
const hudSnapHz = document.getElementById('hud-snap-hz') as HTMLSpanElement;
const hudSep = document.getElementById('hud-sep') as HTMLSpanElement;
const hudRawName = document.getElementById('hud-raw-name') as HTMLSpanElement;
const hudRawCents = document.getElementById('hud-raw-cents') as HTMLSpanElement;

function formatCents(cents: number): string {
  if (cents === 0) return '';
  return `${cents > 0 ? '+' : ''}${cents}¢`;
}

/** Format Hz for the Pitch HUD: 2 decimals below 100Hz (more precision where
 *  semitones span only a couple Hz), 1 decimal otherwise. */
function formatHz(hz: number): string {
  if (hz < 100) return `${hz.toFixed(2)} Hz`;
  return `${hz.toFixed(1)} Hz`;
}

/** Fill each HUD slot in place — no innerHTML, no text concatenation. */
function writePitchHud(snappedY: number | null, rawY: number | null): void {
  if (snappedY == null) {
    hudSnapName.textContent = '';
    hudSnapCents.textContent = '';
    hudSnapHz.textContent = '';
    hudSep.textContent = '';
    hudRawName.textContent = '';
    hudRawCents.textContent = '';
    return;
  }
  // Y is cents; the HUD shows the nearest 12-TET line + signed ¢ remainder.
  const nearestLine = Math.round(snappedY / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
  const cents = Math.round(snappedY - nearestLine);
  hudSnapName.textContent = centsToNoteName(snappedY);
  hudSnapCents.textContent = formatCents(cents);
  // Hz reflects the current global tuning offset since centsToFrequency reads
  // the module-level reference A4. A=432 etc. shifts every readout in lockstep.
  hudSnapHz.textContent = formatHz(centsToFrequency(snappedY));

  const hasRaw = rawY != null
    && Math.abs(rawY - snappedY) >= 2
    && rawY >= MIN_PITCH_CENTS - CENTS_PER_SEMITONE / 2
    && rawY <= MAX_PITCH_CENTS + CENTS_PER_SEMITONE / 2;
  if (hasRaw) {
    const rawNearestLine = Math.round(rawY! / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
    const rawCents = Math.round(rawY! - rawNearestLine);
    hudSep.textContent = '·';
    hudRawName.textContent = centsToNoteName(rawY!);
    hudRawCents.textContent = formatCents(rawCents);
  } else {
    hudSep.textContent = '';
    hudRawName.textContent = '';
    hudRawCents.textContent = '';
  }
}

let bgDirty = true;
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

/** Short-tap action: stop recording/jam if active, else toggle play/pause. */
function handleSpaceTap() {
  const state = store.getState();
  if (state.performance.recordArmed || state.performance.jamActive) {
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
// Dev-only debug accessor: lets the verification harness probe interaction
// + store state. Stripped by the bundler in production via tree-shaking on
// import.meta.env.DEV (Vite). Safe to leave in place — it only attaches under
// the dev server.
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
// Key + Scale selection now lives in the Tuning drawer (WS3), not the top bar.
const tuningScaleSlot = document.getElementById('tuning-scale-slot')!;

const toolbar = createToolbar(tuningScaleSlot, {
  onScaleRootChange(root: number | null, hidePitchLines: boolean) {
    store.setScaleRoot(root, hidePitchLines);
    bgDirty = true;
  },
  onScaleIdChange(scaleId: string | null) {
    store.setScaleId(scaleId);
    bgDirty = true;
  },
});

// Sync toolbar dropdowns to AppState — so load-composition / undo / redo restore
// the visible Key + Scale Type selection. Tracks last-rendered values to avoid
// thrashing the <select> on every store notify.
let lastToolbarScaleRoot: number | null | undefined = undefined;
let lastToolbarHidePitchLines: boolean | undefined = undefined;
let lastToolbarScaleId: string | null | undefined = undefined;
store.subscribe(() => {
  const s = store.getState();
  if (s.scaleRoot !== lastToolbarScaleRoot || s.hidePitchLines !== lastToolbarHidePitchLines) {
    toolbar.updateScaleRoot(s.scaleRoot, s.hidePitchLines);
    lastToolbarScaleRoot = s.scaleRoot;
    lastToolbarHidePitchLines = s.hidePitchLines;
    bgDirty = true;
  }
  if (s.scaleId !== lastToolbarScaleId) {
    toolbar.updateScaleId(s.scaleId);
    lastToolbarScaleId = s.scaleId;
  }
});

// ── Icon rail + sliding drawers (WS3) ──────────────────────────
// Inject shape-only SVG icons (color comes from CSS currentColor) and wire the
// rail so each icon toggles its overlay drawer.
{
  const railEl = document.getElementById('rail')!;
  const drawerHost = document.getElementById('drawer-host')!;
  const railIcons: Record<string, string> = {
    transport: iconTransport,
    tools: iconTools,
    snap: iconSnap,
    prism: iconPrism,
    tuning: iconTuning,
  };
  railEl.querySelectorAll<HTMLElement>('.rail-icon').forEach(btn => {
    const id = btn.dataset.drawer;
    const svg = id ? railIcons[id] : undefined;
    if (svg) setIcon(btn, svg);
  });
  createDrawerRail(railEl, drawerHost);
}
// Transport-button icons (top bar).
setIcon(document.getElementById('btn-play')!, iconPlay);
setIcon(document.getElementById('btn-pause')!, iconPause);
setIcon(document.getElementById('btn-stop')!, iconStop);
setIcon(document.getElementById('btn-record')!, iconRecord);
setIcon(document.getElementById('btn-jam')!, iconJam);
setIcon(document.getElementById('btn-keep')!, iconKeep);

// ── Tool panel (Tools drawer) ──────────────────────────────────
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
const btnJam = document.getElementById('btn-jam') as HTMLButtonElement;
const btnKeep = document.getElementById('btn-keep') as HTMLButtonElement;
const bpmInput = document.getElementById('input-bpm') as HTMLInputElement;
const loopToggle = document.getElementById('loop-toggle') as HTMLInputElement;
const layerToggle = document.getElementById('layer-toggle') as HTMLInputElement;
layerToggle.checked = store.getState().layerModeEnabled;
layerToggle.addEventListener('change', () => {
  store.setLayerMode(layerToggle.checked);
  layerToggle.blur();
});
const lockRailToggle = document.getElementById('lock-rail-toggle') as HTMLInputElement;
// "Lock Rail" semantics (non-inverted): checked = rail locked at canvas centre =
// the canvas scrolls during playback = scrollCanvasEnabled true. Unchecked =
// stationary canvas with a moving playhead. Store API keeps the legacy
// `scrollCanvasEnabled` name; only the label/polarity changed.
lockRailToggle.checked = store.getState().scrollCanvasEnabled;
lockRailToggle.addEventListener('change', () => {
  store.setScrollCanvas(lockRailToggle.checked);
  lockRailToggle.blur();
});
const pitchHudToggle = document.getElementById('pitch-hud-toggle') as HTMLInputElement;
pitchHudToggle.checked = store.getState().pitchHudVisible;
pitchHudToggle.addEventListener('change', () => {
  store.setPitchHudVisible(pitchHudToggle.checked);
  pitchHudToggle.blur();
});
const perfHudToggle = document.getElementById('perf-hud-toggle') as HTMLInputElement;
perfHudToggle.checked = store.getState().perfHudVisible;
perfHudToggle.addEventListener('change', () => {
  store.setPerfHudVisible(perfHudToggle.checked);
  perfHudToggle.blur();
});
const perfHud = createPerfHud(document.getElementById('perf-hud') as HTMLDivElement);
perfHud.setVisible(store.getState().perfHudVisible);
// Mirror external state changes (hotkey, undo, etc.) back into the checkbox so
// the two stay in sync. Cheap — only runs on store.notify, only branches on
// actual changes.
let lastPerfHudVisible = store.getState().perfHudVisible;
store.subscribe(() => {
  const v = store.getState().perfHudVisible;
  if (v === lastPerfHudVisible) return;
  lastPerfHudVisible = v;
  perfHudToggle.checked = v;
  perfHud.setVisible(v);
});

// Rolling frame-time buffer (~2 s at 60 fps). Push every render frame; sort a
// copy when the HUD refreshes. Push is O(1); sort is O(n log n) over 125
// entries — only paid when the HUD is visible.
const FRAME_BUFFER_SIZE = 125;
const frameTimes = new Float32Array(FRAME_BUFFER_SIZE);
let frameTimesFilled = 0;
let frameTimesIndex = 0;
let lastFrameNow = 0;
function pushFrameTime(now: number) {
  if (lastFrameNow !== 0) {
    frameTimes[frameTimesIndex] = now - lastFrameNow;
    frameTimesIndex = (frameTimesIndex + 1) % FRAME_BUFFER_SIZE;
    if (frameTimesFilled < FRAME_BUFFER_SIZE) frameTimesFilled++;
  }
  lastFrameNow = now;
}
function frameTimePercentile(p: number): number {
  if (frameTimesFilled === 0) return 0;
  const sorted = Array.from(frameTimes.subarray(0, frameTimesFilled)).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}
const countdownOverlay = document.getElementById('countdown-overlay') as HTMLDivElement;
const afkWarning = document.getElementById('afk-warning') as HTMLDivElement;
const afkWarningCountdown = document.getElementById('afk-warning-countdown') as HTMLDivElement;
/** Show the AFK warning popup once `afkTimeoutMs - 30s` of remaining time is left
 *  — i.e. after 30 seconds of inactivity. The popup races the engine's auto-stop
 *  using the same constant, so the countdown reaches 0 at the moment recording
 *  pauses. */
const AFK_WARNING_LEAD_MS = 30_000;

/** Scroll Canvas effective value — forced on while recording (Perform with capture)
 *  and while jamming (the free-running clock is a scrolling-view experience). */
function effectiveScrollCanvas(): boolean {
  const st = store.getState();
  return st.scrollCanvasEnabled
    || st.performance.recordArmed
    || st.performance.jamActive
    // Queued pass-record counts too, so the view doesn't switch modes at the
    // moment capture starts (BACKLOG 10.5).
    || st.performance.passRecordState !== 'off';
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
  // Queued (10.5) is its own state: waiting for the loop point, not yet capturing.
  const queued = g.passRecordState === 'queued';
  btnRecord.classList.toggle('queued', queued);
  btnRecord.classList.toggle('armed', !queued && g.recordArmed && g.phase !== 'playing');
  btnRecord.classList.toggle('recording', !queued && g.recordArmed && g.phase === 'playing');
  btnRecord.disabled = st.selectedTrackId === null;

  btnJam.classList.toggle('jamming', g.jamActive);
  // A record session owns the transport; jam can't start (or stop) under it.
  btnJam.disabled = g.recordArmed || g.phase === 'countdown';

  lockRailToggle.checked = st.scrollCanvasEnabled;
  layerToggle.checked = st.layerModeEnabled;

  // Lock loop toggle while recording.
  loopToggle.disabled = g.recordArmed && g.phase === 'playing';
}

/** Keep button doubles as the "keepable material pending" indicator (BACKLOG
 *  10.2): it lights whenever the rolling buffer holds a committable phrase,
 *  and stays lit after the session stops until the phrase ages out.
 *
 *  Polled per frame rather than from the store subscription, because the two
 *  events that change keepability — sealing a phrase on release, and
 *  time-based eviction — are pure engine state and never notify the store.
 *  Cached so the common case writes no DOM. */
let lastKeepDomKey = '';
function updateKeepButtonDom() {
  const keepable = composeEngine.getKeepablePhraseCount();
  const noTrack = store.getState().selectedTrackId === null;
  const key = `${keepable}:${noTrack}`;
  if (key === lastKeepDomKey) return;
  lastKeepDomKey = key;
  btnKeep.disabled = keepable === 0 || noTrack;
  btnKeep.classList.toggle('keepable', keepable > 0);
  btnKeep.title = keepable > 0
    ? `Keep that (K) — commit the phrase you just played (${keepable} keepable)`
    : 'Keep that (K) — commit the phrase you just played';
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
  // otherwise the record would silently continue on next play. Same for jam:
  // a free-running clock has no meaningful paused state to resume into.
  const g = store.getState().performance;
  if (g.recordArmed || g.jamActive) {
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

btnRecord.addEventListener('click', (e) => {
  if (store.getState().selectedTrackId === null) return; // no track to record onto
  // Shift+click mirrors Shift+R — one obvious place for both record styles.
  if (e.shiftKey) toggleRecordNextPass();
  else composeToggleArmed();
  updateRecordButtonVisuals();
});

btnJam.addEventListener('click', () => {
  jamToggle();
  updateRecordButtonVisuals();
});

btnKeep.addEventListener('click', () => {
  keepLastPhrase();
  updateRecordButtonVisuals();
});

bpmInput.addEventListener('change', () => {
  const bpm = Math.max(20, Math.min(300, Number(bpmInput.value)));
  bpmInput.value = String(bpm);
  history.snapshot();
  store.setBpm(bpm);
});

// ── Tune A4 (BACKLOG 8.27) ──────────────────────────────────────
// Pitch-shifts the entire staff by changing the reference frequency for A4.
// Persisted as cents-offset relative to A=440 in the composition; the audio
// module's `currentReferenceAHz` is the runtime source of truth that
// noteToFrequency reads (sync via syncTuningToAudio below).
const tuningInput = document.getElementById('input-tuning') as HTMLInputElement;
const tuningCentsDisplay = document.getElementById('tuning-cents-display') as HTMLSpanElement;

function formatTuningCentsLabel(cents: number): string {
  if (Math.abs(cents) < 0.05) return '0¢';
  const sign = cents > 0 ? '+' : '';
  return `${sign}${cents.toFixed(1)}¢`;
}

/** Push the composition's tuningOffsetCents into the audio module + UI inputs.
 *  Called on app startup, composition load (Load JSON / Import MIDI), and
 *  history undo/redo via the store subscription below. */
function syncTuningToAudio() {
  const cents = store.getComposition().tuningOffsetCents;
  const hz = centsToReferenceAHz(cents);
  setReferenceAHz(hz);
  // Reflect in the input + cents readout, but only if the user isn't currently
  // editing the input (would steal focus / clobber half-typed values).
  if (document.activeElement !== tuningInput) {
    tuningInput.value = String(Number(getReferenceAHz().toFixed(2)));
  }
  tuningCentsDisplay.textContent = formatTuningCentsLabel(cents);
  // Pitch HUD reads frequency on render — mark dirty so any open HUD reflects
  // the new tuning on the next frame.
  bgDirty = true;
}

tuningInput.addEventListener('change', () => {
  const hz = Math.max(380, Math.min(500, Number(tuningInput.value) || STANDARD_A4_HZ));
  const cents = referenceAHzToCents(hz);
  history.snapshot();
  store.setTuningOffsetCents(cents);
  // syncTuningToAudio runs via the subscription, but call it directly so the
  // input value gets normalized (e.g. user types "430.123" → display "430.12").
  syncTuningToAudio();
  tuningInput.blur();
});

// Apply the composition's tuning whenever it changes (load, undo/redo, setter).
// The check skips redundant work when nothing tuning-related changed.
let lastAppliedTuningCents: number | null = null;
store.subscribe(() => {
  const cents = store.getComposition().tuningOffsetCents;
  if (cents === lastAppliedTuningCents) return;
  lastAppliedTuningCents = cents;
  syncTuningToAudio();
});
// Initial sync on app boot.
syncTuningToAudio();

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

// One-shot guard for the "you have MIDI but no track is armed" toast. Reset
// when the user changes device or disarms a track, so the hint can fire again
// the next time the user falls into the same state.
let midiArmHintShown = false;

function refreshMidiDeviceList() {
  const active = midiInput.getActiveDeviceId();
  const devices = midiInput.getDevices();
  midiDeviceSelect.innerHTML = '<option value="">None</option>'
    + devices.map(d => `<option value="${d.id}">${d.name || d.manufacturer || d.id}</option>`).join('');
  midiDeviceSelect.value = active ?? '';
}

midiInput.onDevicesChanged(refreshMidiDeviceList);

// Live MIDI pitch-bend state (BACKLOG 8.25). Range hardcoded to ±2 semitones
// (GM standard); RPN sniffing on the wire isn't worth doing — almost no
// controllers send it. The offset persists across loop wraps and across
// noteOn/noteOff because it's just module state, so the held-key planchette
// continues at the bent pitch through a wrap (mirrors 8.21).
const LIVE_BEND_RANGE_SEMITONES = 2;
let liveBendCents = 0;
// Track currently-held MIDI keys so the bend handler can re-tune every active
// preview synth without scanning the audio engine. Voice id is `midi-${note}`.
const heldMidiNotes = new Set<number>();

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
  bgDirty = true;
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
  preview.startDrawPreview(tone, midiToCents(note) + liveBendCents, `midi-${note}`);
  // velocity reserved for a future loudness-mapped preview; stable mid-volume for now.
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
    if (existing) finalizeMidiVoice(note);
    // Apply current bend offset on creation so the planchette spawns at the
    // bent pitch if the wheel was already off-centre when the key was struck.
    const initialY = midiToCents(note) + liveBendCents;
    store.addPerformPlanchette({
      voiceId,
      trackId: state.midiArmedTrackId,
      cursorWorldY: initialY,
      snappedWorldY: initialY,
      lastCrossedAt: performance.now(),
    });
    bgDirty = true;
  }
});

midiInput.onNoteOff((note) => {
  // MIDI key release counts as activity for the perform-engine AFK gate.
  composeEngine.markActivity(performance.now());
  heldMidiNotes.delete(note);
  preview.stopDrawPreview(`midi-${note}`);
  // If this voice was recording, finalize the curve into the MIDI-armed track.
  // Safe to call unconditionally — finalizeMidiVoice no-ops if no planchette.
  finalizeMidiVoice(note);
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

  // Just enabled a device with no armed track — prompt the user before they
  // hit the silent-no-curves trap. The toast in noteOn is the safety net for
  // the case where they cancel here and play anyway.
  if (id && store.getState().midiArmedTrackId === null) {
    midiArmHintShown = false;
    await promptForMidiArm();
  }
});

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
  // 'arm-new' — same flow as the "+ Add Track" button, then arm.
  const comp = store.getComposition();
  const btn = document.getElementById('add-track-btn')!;
  const picked = await openTonePicker(comp.toneLibrary, null, btn);
  if (!picked) return;
  history.snapshot();
  const track = createTrack(`Track ${comp.tracks.length + 1}`, picked.id);
  store.mutate(c => { c.tracks.push(track); });
  store.setSelectedTrack(track.id);
  store.setMidiArmedTrackId(track.id);
}

// Reset the noteOn-toast gate on arm/disarm transitions only — not on every
// store notify, or unrelated state changes would clobber the once-per-episode
// behavior. While armed: suppress (hint is irrelevant). On disarm: re-enable
// so the next time the user falls into the no-armed-track trap, the hint
// fires again.
let lastMidiArmedState = store.getState().midiArmedTrackId !== null;
store.subscribe(() => {
  const armedNow = store.getState().midiArmedTrackId !== null;
  if (armedNow === lastMidiArmedState) return;
  midiArmHintShown = armedNow;
  lastMidiArmedState = armedNow;
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
const guidesLockedToggle = document.getElementById('guides-locked-toggle') as HTMLInputElement;
const addGuideXBtn = document.getElementById('add-guide-x-btn') as HTMLButtonElement;
const addGuideYBtn = document.getElementById('add-guide-y-btn') as HTMLButtonElement;
guidesVisibleToggle.checked = store.getState().guidesVisible;
guidesLockedToggle.checked = store.getState().guidesLocked;

/** Disable the + X / + Y buttons when guides are locked so the user can't add a
 *  new guide and leave it stuck-selected (the lock prevents deselect-on-canvas). */
function syncGuideAddButtonsEnabled(): void {
  const locked = store.getState().guidesLocked;
  addGuideXBtn.disabled = locked;
  addGuideYBtn.disabled = locked;
  const tip = locked
    ? 'Unlock guides to add a new one'
    : null;
  addGuideXBtn.title = tip ?? 'Add a vertical (beat) guide at the centre of the viewport';
  addGuideYBtn.title = tip ?? 'Add a horizontal (pitch) guide at the centre of the viewport';
}
syncGuideAddButtonsEnabled();

guidesVisibleToggle.addEventListener('change', () => {
  store.setGuidesVisible(guidesVisibleToggle.checked);
  bgDirty = true;
  guidesVisibleToggle.blur();
});
guidesLockedToggle.addEventListener('change', () => {
  store.setGuidesLocked(guidesLockedToggle.checked);
  syncGuideAddButtonsEnabled();
  bgDirty = true;
  guidesLockedToggle.blur();
});

/** Add a guide at the centre of the current viewport on the requested axis,
 *  then auto-select it so the user can immediately drag or rename it. */
function addGuideAtViewportCenter(orientation: 'x' | 'y'): void {
  const r = canvasContainer.getBoundingClientRect();
  const centre = viewport.screenToWorld(r.width / 2, r.height / 2);
  const position = orientation === 'x'
    ? Math.max(0, Math.round(centre.wx * 4) / 4)   // round to nearest 1/4 beat for tidiness
    : Math.round(centre.wy / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE; // nearest 12-TET line
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
  downloadFile(json, `${comp.name || 'composition'}.gliss`);
});

addFileMenuItem('Load Composition', async () => {
  try {
    // .gliss is the native format; .json accepts legacy flat saves.
    const json = await openFile('.gliss,.json');
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
    // Shift+R = deliberate one-pass record (10.5); plain R = open-ended record.
    if (e.shiftKey) toggleRecordNextPass();
    else composeToggleArmed();
    updateRecordButtonVisuals();
    return;
  }
  if (e.key.toLowerCase() === 'j' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.repeat) return;
    jamToggle();
    updateRecordButtonVisuals();
    return;
  }
  if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.repeat) return;
    keepLastPhrase();
    updateRecordButtonVisuals();
    return;
  }
  if (e.key.toLowerCase() === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.repeat) return;
    dropLastPass();
    return;
  }
  if (e.key === 'Escape') {
    const g = store.getState().performance;
    if (g.phase === 'countdown' || g.recordArmed || g.jamActive) {
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
    case '!':
      // Toggle the Perf HUD. The store.subscribe binding above mirrors the
      // change back into the Transport-panel checkbox.
      store.setPerfHudVisible(!store.getState().perfHudVisible);
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
          for (const pt of pitchPoints(curve)) {
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
      // Locked guides can't be deleted; the user must unlock first.
      if (s.selectedGuideId && !s.guidesLocked) {
        history.snapshot();
        store.removeGuide(s.selectedGuideId);
        bgDirty = true;
        break;
      }
      // Multi-point delete (BACKLOG 8.3): when there are 2+ selected points
      // (or a single multi-point selection that doesn't match selectedPointIndex
      // single-point semantics), remove every selected point. Curves that drop
      // below 2 points are removed entirely (a 0/1-point curve is degenerate
      // and won't render any segment).
      if (s.selectedPointKeys.size >= 1 && (s.selectedPointKeys.size > 1 || s.selectedPointIndex === null)) {
        history.snapshot();
        const byCurve = new Map<string, number[]>();
        for (const key of s.selectedPointKeys) {
          const sep = key.lastIndexOf(':');
          if (sep < 0) continue;
          const cid = key.slice(0, sep);
          const idx = Number(key.slice(sep + 1));
          if (!Number.isFinite(idx)) continue;
          let arr = byCurve.get(cid);
          if (!arr) { arr = []; byCurve.set(cid, arr); }
          arr.push(idx);
        }
        store.mutate(comp => {
          for (const track of comp.tracks) {
            for (let ci = track.curves.length - 1; ci >= 0; ci--) {
              const curve = track.curves[ci]!;
              const indices = byCurve.get(curve.id);
              if (!indices) continue;
              // Sort descending so splice doesn't shift later indices we still need.
              indices.sort((a, b) => b - a);
              for (const idx of indices) {
                if (idx >= 0 && idx < pitchPoints(curve).length) pitchPoints(curve).splice(idx, 1);
              }
              if (pitchPoints(curve).length < 2) {
                track.curves.splice(ci, 1);
              }
            }
          }
        });
        store.clearPointSelection();
        store.setSelectedCurve(null);
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
            pitchPoints(curve).splice(s.selectedPointIndex!, 1);
            if (pitchPoints(curve).length === 0 && track) {
              const idx = track.curves.indexOf(curve);
              if (idx >= 0) track.curves.splice(idx, 1);
            }
          });
          store.setSelectedPoint(null);
          store.setSelectedCurve(pitchPoints(curve).length > 0 ? curve.id : null);
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
    const isMidiArmed = state.midiArmedTrackId === track.id;
    const isMidiRecording = isMidiArmed && state.performance.planchettes.some(
      p => p.voiceId.startsWith('midi-') && p.trackId === track.id,
    );
    const midiArmClass = isMidiRecording ? 'recording' : isMidiArmed ? 'armed' : '';
    const midiArmTitle = isMidiArmed
      ? 'MIDI input armed — click to disarm'
      : 'Arm this track for MIDI input recording';
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
        <button class="track-midi-arm ${midiArmClass}" title="${midiArmTitle}">I</button>
        <button class="track-edit-tone" title="Edit tone">T</button>
        <button class="track-delete" title="Delete track (undoable)">X</button>
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
      if (target.classList.contains('track-delete')) {
        // In-flight MIDI voices on this track would otherwise keep capturing
        // into a track that no longer exists.
        if (store.getState().midiArmedTrackId === track.id) finalizeAllInFlightMidiVoices();
        history.snapshot();
        // If the current layer lived here, clear it so the next pass opens a new one.
        if (currentLayerTrackId === track.id) currentLayerTrackId = null;
        store.removeTrack(track.id);
        showToast(`Deleted ${track.name} — Ctrl+Z to restore`, 2500);
        bgDirty = true;
        return;
      }
      if (target.classList.contains('track-midi-arm')) {
        const current = store.getState().midiArmedTrackId;
        // If switching arm or disarming while notes are still held, finalize
        // those in-flight voices first so we don't lose recorded samples (the
        // arm change would orphan the planchettes otherwise).
        if (current !== null) finalizeAllInFlightMidiVoices();
        // Toggle: arm this track if not already armed; disarm if it was.
        store.setMidiArmedTrackId(current === track.id ? null : track.id);
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
        const map = new Map<string, LanePoint[]>();
        const nonPitchMap = new Map<string, Lane[]>();
        for (const c of track.curves) {
          map.set(c.id, deepCopyPoints(pitchPoints(c)));
          nonPitchMap.set(c.id, deepCopyLanes(c.lanes.filter(l => l.type !== 'pitch')));
        }
        interaction.transformBox = {
          curveIds,
          originalPointsMap: map,
          originalNonPitchLanesMap: nonPitchMap,
          bbox: computeMultiCurveBBox(track.curves),
          activeHandle: null,
          dragStart: null,
          pointIndicesPerCurve: null,
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

// Middle-mouse drag in the Parameters Graph pans the shared X (both canvases)
// and the pitch Y (the param Y axis is fixed 0..1, so it's unaffected). Reuses
// the same isPanning flow handled by the window mousemove/mouseup below.
paramCanvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    paramCanvas.style.cursor = 'grabbing';
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
    paramCanvas.style.cursor = '';
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
  afkTimeoutMs: 60_000,
  recordingBufferMax: 3600,
  loopWrapThresholdBeats: 0.5,
  keepBufferMs: KEEP_BUFFER_MS,
});

const magneticState = createMagneticState();

// ── Magnetic perform-clock (BACKLOG 10.1) ──────────────────────
// Monotonic beat-time for the magnetic integrator, derived from the wall clock
// rather than the playback position. Physics only needs dt, and wall-clock dt
// equals playback dt (both real time), so one clock covers every case — including
// transport-stopped hover (record-armed idle, countdown), where the playback
// position is frozen and the old time base starved the physics of dt.
// MAX_DT_BEATS inside updateMagnetic absorbs long gaps (tab throttling, pauses).
let magneticClockLastMs = 0;
let magneticClockBeats = 0;
function magneticNowBeats(): number {
  const now = performance.now();
  if (magneticClockLastMs !== 0) {
    magneticClockBeats += ((now - magneticClockLastMs) / 1000) * (store.getComposition().bpm / 60);
  }
  magneticClockLastMs = now;
  return magneticClockBeats;
}

/** Last known compose-mode cursor screen Y. Cached so the per-frame pitch-mode
 *  tick can keep advancing the planchette pitch even when the mouse isn't moving. */
let lastComposeSy: number | null = null;

function computeComposeCursorPitch(sy: number): { cursorWorldY: number; snappedWorldY: number; snapTarget: number | null } {
  const { wy } = viewport.screenToWorld(0, sy);
  const st = store.getState();
  const scale = st.scaleId ? getScaleById(st.scaleId) ?? null : null;
  // Pull Y guides into the snap candidates so Perform/Record planchette pitch
  // honors user-placed pitch guides. X-guides are ignored here — time progression
  // during perform is BPM-clamped, so X-snap doesn't apply.
  let guideYTargets: readonly number[] | undefined;
  if (st.guidesVisible && st.composition.guides.length > 0) {
    const ys = st.composition.guides
      .filter(g => g.orientation === 'y')
      .map(g => g.position);
    if (ys.length > 0) guideYTargets = ys;
  }
  const snapConfig: SnapConfig = {
    enabled: st.snapEnabled,
    subdivisionsPerBeat: getAdaptiveSubdivisions(viewport.state.zoomX),
    scaleRoot: st.scaleRoot,
    scale,
    hidePitchLines: st.hidePitchLines,
    guideYTargets,
  };

  // Adaptive snap: nearest target plus a well radius scaled to neighbor
  // spacing. Pentatonic scales and sparse guides get wider wells than
  // chromatic — magnetic pull reaches the cursor wherever the grid is sparse.
  const adaptive = st.snapEnabled
    ? findAdaptiveSnap(wy, snapConfig)
    : { target: null, radius: 0, captured: false };

  // None Key mode is the only mode where snap can fail to engage (cursor
  // outside the captured well between sparse guides). In scale or chromatic
  // mode there's always a nearest target, so the cursor always snaps.
  const inNoneMode = st.hidePitchLines && st.scaleRoot === null;
  const snapEngaged = adaptive.target !== null && (!inNoneMode || adaptive.captured);
  const snappedWy = snapEngaged ? adaptive.target! : wy;
  const snapTarget = snapEngaged ? adaptive.target : null;

  // Perform context = the rail planchette is (or is about to be) the sounding
  // instrument: scroll-canvas playback (jam / perform / record) or an armed
  // session hovering before playback starts (idle-armed, countdown). Edit
  // tools and the free-planchette draw preview keep instant snap.
  const performContext = isComposePerformActive() || st.performance.recordArmed;

  // Magnetic mode: spring-mass physics. The attractor only acts when the
  // cursor is inside its well; outside, the particle falls back to
  // spring-tracks-cursor (smooth, no snap force). State stays continuous
  // across well boundaries, so wells hand off without a kick. Runs on the
  // wall-clock perform-clock, so gravity settles even at rest (transport
  // stopped) — LMB is not required; hover feels the pull too.
  if (st.snapEnabled && performContext && st.magneticEnabled) {
    const attractor = adaptive.target !== null && adaptive.captured
      ? { target: adaptive.target, radius: adaptive.radius }
      : null;
    const magneticPitch = updateMagnetic(magneticState, wy, magneticNowBeats(), st.magneticStrength, st.magneticSpringK, st.magneticDamping, attractor);
    return { cursorWorldY: wy, snappedWorldY: magneticPitch, snapTarget };
  }

  // Non-magnetic path: instant snap (or raw cursor Y when snap is off, or no
  // attractor in None mode between guides).
  resetMagnetic(magneticState);
  return { cursorWorldY: wy, snappedWorldY: snappedWy, snapTarget };
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
  // Snap-line-cross pulse — fire only when crossing between two real targets.
  // Skip when either side is null (no attractor in None-mode between-guides
  // zones) so the flash doesn't fire on every frame.
  if (prevSnapTarget != null && snapTarget != null && prevSnapTarget !== snapTarget) {
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
    const inRange = harmonyY >= MIN_PITCH_CENTS && harmonyY <= MAX_PITCH_CENTS;
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
  if (y < MIN_PITCH_CENTS || y > MAX_PITCH_CENTS) return null;
  return y;
}

/** Parse 'harmony-N' → N. Returns null for non-harmony voiceIds. */
function parseHarmonyIndex(voiceId: string): number | null {
  if (!voiceId.startsWith('harmony-')) return null;
  const n = Number(voiceId.slice('harmony-'.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Reconcile the planchette array with current Prism Draw + playback/record
 *  state. Called every render frame; cheap when state already matches.
 *  Only touches Harmonic Prism harmony voices ('harmony-*'); MIDI input
 *  planchettes ('midi-*') have their own lifecycle (noteOn / noteOff) and
 *  must not be reaped here. */
function syncHarmonyPlanchettes() {
  const st = store.getState();
  const wantHarmonies = st.harmonicPrism.drawMode &&
    (playback.isPlaying() || st.performance.recordArmed);

  if (!wantHarmonies) {
    for (const p of st.performance.planchettes) {
      if (p.voiceId.startsWith('harmony-')) preview.stopDrawPreview(p.voiceId);
    }
    store.removeHarmonyPlanchettes();
    return;
  }

  const offsets = chordOffsets(st.harmonicPrism.chordSpec);
  const desiredHarmonyIds = new Set<string>();
  for (let i = 1; i < offsets.length; i++) desiredHarmonyIds.add(harmonyVoiceId(i - 1));

  // Remove harmony voices no longer in spec (numVoices reduced).
  const toRemove: string[] = [];
  for (const p of st.performance.planchettes) {
    if (!p.voiceId.startsWith('harmony-')) continue;
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
      if (y >= MIN_PITCH_CENTS && y <= MAX_PITCH_CENTS) initialY = y;
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
    if (y < MIN_PITCH_CENTS || y > MAX_PITCH_CENTS) continue;
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
    if (y >= MIN_PITCH_CENTS && y <= MAX_PITCH_CENTS) preview.updateDrawPitch(y, voiceId);
  }
}

function captureComposeRecordingSample() {
  const st = store.getState();
  const g = st.performance;
  // Capture runs whenever a voice is actually SOUNDING in a perform context —
  // not just while armed (BACKLOG 10.2). That is what fills the rolling buffer
  // during an un-armed jam so "keep that" has something to commit. isLmbDown()
  // can only be true inside isComposePerformActive(), so it already implies the
  // perform context and a running transport. Silent cursor movement is never
  // captured: "what was just played" means what was heard.
  const lmbActive = composeEngine.isLmbDown();
  const midiActive = st.midiArmedTrackId !== null && g.phase === 'playing';
  if (!lmbActive && !midiActive) return;
  const beat = playback.getPositionBeats();
  // Capture every active voice (primary + any chord-cluster harmonies + every
  // held MIDI note). The engine's captureSample is keyed by voiceId and already
  // supports N parallel buffers. Per-voice gating: LMB voices when LMB is the
  // active source; MIDI voices when MIDI input is the armed source. Both can
  // run in parallel, recording into independent voices.
  for (const p of g.planchettes) {
    if (p.snappedWorldY == null) continue;
    const isMidiVoice = p.voiceId.startsWith('midi-');
    if (isMidiVoice ? !midiActive : !lmbActive) continue;
    composeEngine.captureSample(p.voiceId, {
      beat,
      note: p.snappedWorldY,
      volume: 0.8,
    });
  }
}

/** Finalize one MIDI voice's recording into the MIDI-armed track. Called on
 *  noteOff and on stop boundaries (composePerformStop, loop wrap, disarm).
 *  `keepPlanchette: true` is used by the loop-wrap path so the held key keeps
 *  capturing on the loop-in side under the same voiceId — matches LMB-held
 *  perform behaviour (see finalizeComposeRecordedCurves below). BACKLOG 8.21. */
function finalizeMidiVoice(
  midiNote: number,
  opts: { keepPlanchette?: boolean } = {},
) {
  const voiceId = `midi-${midiNote}`;
  const st = store.getState();
  const planchettePresent = st.performance.planchettes.some(p => p.voiceId === voiceId);
  if (!planchettePresent) return;
  const trackId = st.midiArmedTrackId;
  const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
  // Seal the note's phrase before claiming it, so the buffer never carries an
  // open phrase for a voice that has stopped sounding.
  composeEngine.closePhrase(voiceId, performance.now());
  const curve = composeEngine.finalizeCurve(voiceId, () => history.snapshot());
  if (curve && track) {
    store.mutate(() => { track.curves.push(curve); });
  } else if (!track) {
    composeEngine.clearBuffer(voiceId);
  }
  if (!opts.keepPlanchette) {
    store.removePerformPlanchette(voiceId);
  }
  bgDirty = true;
}

/** Finalize every in-flight MIDI voice. Used on stop boundaries (Stop button,
 *  ESC, AFK, loop wrap) and when un-arming MIDI mid-recording. */
function finalizeAllInFlightMidiVoices(opts: { keepPlanchette?: boolean } = {}) {
  const notes: number[] = [];
  for (const p of store.getState().performance.planchettes) {
    if (!p.voiceId.startsWith('midi-')) continue;
    const n = Number(p.voiceId.slice('midi-'.length));
    if (Number.isFinite(n)) notes.push(n);
  }
  for (const n of notes) finalizeMidiVoice(n, opts);
}

function finalizeComposeRecordedCurves() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
  // Voice ids the LMB session owns (primary + every active harmony). MIDI
  // voices ('midi-*') deliberately excluded — they live on the MIDI-armed
  // track, not the LMB-selected track, and have their own finalize path
  // (finalizeMidiVoice / finalizeAllInFlightMidiVoices). Without this filter
  // an LMB release that lands on the same beat as a MIDI noteOff would push
  // the MIDI curve onto the LMB track.
  const voiceIds = lmbVoiceIds();
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
  commitFinalizedCurves(finalized, track);
}

/** Voice ids the LMB session owns (primary + harmonies), excluding MIDI voices
 *  which have their own finalize path. */
function lmbVoiceIds(): string[] {
  return store.getState().performance.planchettes
    .map(p => p.voiceId)
    .filter(v => !v.startsWith('midi-'));
}

/** Seal every LMB-owned phrase. Called on release, stop, and loop wrap — after
 *  this the phrase is committable by either the armed path or "keep that". */
function closeLmbPhrases() {
  const now = performance.now();
  for (const voiceId of lmbVoiceIds()) composeEngine.closePhrase(voiceId, now);
}

// ── Layer-per-pass looping (BACKLOG 10.3) ──────────────────────
/** Track the current pass is committing onto while Layer mode is on. Runtime
 *  only. Cleared at every loop wrap, which is what makes "one pass = one
 *  layer" true, and on session start/stop. */
let currentLayerTrackId: string | null = null;
/** One-shot so the track-cap toast doesn't fire on every commit. */
let layerCapToastShown = false;

/** Reset per-session layer state. Called on jam/record start and on stop. */
function resetLayerSession() {
  currentLayerTrackId = null;
  layerCapToastShown = false;
}

/**
 * Where should this pass's curves land? With Layer mode off, the source track,
 * exactly as before. With it on, the layer this pass belongs to — opened lazily
 * on the first commit after a loop wrap, so a pass where nothing was played
 * leaves no empty track behind.
 *
 * Mutates `comp` when it opens a layer, so it must be called inside store.mutate.
 */
function resolveCommitTrack(
  source: import('./types').Track,
  comp: import('./types').Composition,
): { track: import('./types').Track; createdTrack: boolean } {
  if (!store.getState().layerModeEnabled) return { track: source, createdTrack: false };

  if (currentLayerTrackId !== null) {
    const existing = comp.tracks.find(t => t.id === currentLayerTrackId);
    if (existing) return { track: existing, createdTrack: false };
    currentLayerTrackId = null;   // layer was deleted (e.g. dropped) — open a new one
  }

  if (!canOpenLayer(comp.tracks)) {
    // At the ceiling: keep performing into the newest layer rather than
    // silently dropping the pass or exceeding the export-safe track count.
    if (!layerCapToastShown) {
      showToast(`Layer limit reached (${LAYER_TRACK_LIMIT} tracks) — adding to the last layer`, 3500);
      layerCapToastShown = true;
    }
    const newest = newestLayerTrack(comp.tracks);
    return { track: newest ?? source, createdTrack: false };
  }

  const layer = createLayerTrack(source, comp.tracks);
  comp.tracks.push(layer);
  currentLayerTrackId = layer.id;
  return { track: layer, createdTrack: true };
}

/** Log of performed passes, newest last. Append-only — see pass-log.ts for why
 *  droppability is derived rather than tracked. */
const passLog: CommittedPass[] = [];

/** Push finalized curves onto a track, stamping a chord-cluster group when the
 *  gesture had multiple voices. Shared by the armed-release path and
 *  retrospective keep so both commit identically — and therefore the one place
 *  layer routing (10.3) and pass registration (10.4) need to hook. */
function commitFinalizedCurves(
  finalized: Array<{ voiceId: string; curve: import('./types').BezierCurve }>,
  source: import('./types').Track,
) {
  const groupId = finalized.length > 1 ? createGroupId() : null;
  store.mutate((comp) => {
    // Resolved inside the mutation so opening a layer shares the caller's
    // history snapshot: creating the track and filling it are one undo step.
    const { track, createdTrack } = resolveCommitTrack(source, comp);
    for (let i = 0; i < finalized.length; i++) {
      const { curve, voiceId } = finalized[i]!;
      if (groupId) {
        curve.groupId = groupId;
        curve.voiceIndex = i;
      }
      track.curves.push(curve);
      store.setPerformCurrentCurve(voiceId, curve.id);
    }
    passLog.push({
      trackId: track.id,
      curveIds: finalized.map(f => f.curve.id),
      createdTrack,
    });
  });
}

/**
 * Drop the most recent performed pass (BACKLOG 10.4) — the live-looper's "undo
 * last layer". A forward, undoable delete rather than a history rewind: the
 * undo stack is linear whole-composition snapshots, so once you have edited
 * after performing, no rewind can remove just that pass. Ctrl+Z restores what
 * this drops, which is the looper's "redo layer".
 */
function dropLastPass() {
  const comp = store.getComposition();
  const droppable = findDroppablePass(passLog, comp);
  if (!droppable) {
    showToast('No performed pass to drop', 2000);
    return;
  }

  history.snapshot();
  let removedTrackName: string | null = null;
  let curvesRemoved = 0;
  let trackToRemove: string | null = null;
  store.mutate((c) => {
    const result = dropPassCurves(c, droppable.pass, droppable.surviving);
    if (!result) return;
    curvesRemoved = result.curvesRemoved;
    if (result.shouldRemoveTrack) {
      trackToRemove = result.track.id;
      removedTrackName = result.track.name;
    }
  });
  // Track removal is a separate store call: it sweeps selection, MIDI arm,
  // projection source and planchettes, which doesn't belong inside a mutate.
  if (trackToRemove !== null) {
    if (currentLayerTrackId === trackToRemove) currentLayerTrackId = null;
    store.removeTrack(trackToRemove);
  }

  showToast(
    removedTrackName !== null
      ? `Dropped ${removedTrackName}`
      : `Dropped last pass (${curvesRemoved} curve${curvesRemoved === 1 ? '' : 's'})`,
    2000,
  );
  bgDirty = true;
}

/**
 * Retrospective capture (BACKLOG 10.2): commit the newest *closed* uncommitted
 * phrase into a curve, after the fact. Pressing repeatedly walks backward
 * through the rolling buffer, since each keep marks its phrase committed.
 * Multi-voice gestures (Prism clusters) commit as one group.
 */
function keepLastPhrase() {
  const st = store.getState();
  const trackId = st.selectedTrackId;
  const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
  if (!track) {
    showToast('Select a track to keep onto', 2500);
    return;
  }
  if (composeEngine.getKeepablePhraseCount() === 0) {
    showToast('Nothing to keep', 2000);
    return;
  }

  // Build curves BEFORE snapshotting: curveFromRecording produces detached
  // curves without touching the composition, so if every candidate turns out
  // too short to fit we bail without having pushed a bogus undo entry.
  // Keep every voice that has a keepable phrase, so a chord cluster played as
  // one gesture commits as one group. MIDI voices are excluded — they belong to
  // the MIDI-armed track and commit on noteOff.
  const finalized: Array<{ voiceId: string; curve: import('./types').BezierCurve }> = [];
  for (const voiceId of composeEngine.getKeepableVoiceIds()) {
    if (voiceId.startsWith('midi-')) continue;
    const curve = composeEngine.keepCurve(voiceId);
    if (curve) finalized.push({ voiceId, curve });
  }
  if (finalized.length === 0) {
    showToast('Nothing to keep', 2000);
    return;
  }

  // Snapshot once per keep — each kept pass is exactly one undo entry
  // (the 10.4 decision). The engine's once-per-session debounce used by the
  // armed path deliberately doesn't apply here, or repeat keeps would collapse
  // into a single undo step.
  history.snapshot();
  commitFinalizedCurves(finalized, track);
  const beats = curveDurationBeats(finalized[0]!.curve);
  showToast(
    finalized.length > 1
      ? `Kept ${finalized.length}-voice phrase (${beats.toFixed(1)} beats)`
      : `Kept phrase (${beats.toFixed(1)} beats)`,
    2000,
  );
  bgDirty = true;
}

/** Duration of a curve's pitch lane in beats — for the keep confirmation toast. */
function curveDurationBeats(curve: import('./types').BezierCurve): number {
  const pts = pitchPoints(curve);
  if (pts.length < 2) return 0;
  return pts[pts.length - 1]!.position.x - pts[0]!.position.x;
}

function tickComposePerform() {
  const st = store.getState();
  const g = st.performance;
  // Treat MIDI-armed as record-armed for engine purposes (countdown, AFK gate)
  // so the player gets the same affordances when arming via MIDI alone.
  const anyArmed = g.recordArmed || st.midiArmedTrackId !== null;
  const playbackBeat = playback.getPositionBeats();

  // Keep the AFK timer fresh while there's a meaningful reason to keep waiting:
  // (a) Loop is on (intentional record-over-loops), or (b) the playhead hasn't
  // crossed the rightmost control point yet (still future content to record over).
  // Refresh per tick so the user gets a full afkTimeoutMs window after the
  // suppressing condition lifts, instead of an immediate auto-stop.
  if (anyArmed && g.phase === 'playing' && playback.isPlaying()) {
    const rightmost = getCompositionLength(st.composition);
    if (playback.isLoopEnabled() || playbackBeat < rightmost) {
      composeEngine.markActivity(performance.now());
    }
  }

  // Idle-window selection: armed recording keeps the short AFK timeout; an
  // un-armed jam gets the long jam timeout; anything else never auto-stops.
  const idleTimeoutMs = anyArmed
    ? composeEngine.getAfkTimeoutMs()
    : (g.jamActive ? JAM_IDLE_TIMEOUT_MS : Infinity);

  composeEngine.tick({
    now: performance.now(),
    audioNow: getAudioContext().currentTime,
    isPlaying: playback.isPlaying(),
    phase: g.phase,
    idleTimeoutMs,
    countdownStartedAt: g.countdownStartedAt,
    playbackBeat,
    onCountdownElapsed: startComposePerformPlayback,
    onLoopWrap: () => {
      // Seal phrases at the seam so none ever spans the loop boundary — a
      // phrase containing the wrap would carry a backwards beat jump and
      // couldn't be fitted. Held voices resume into a fresh phrase on the
      // loop-in side (captureSample opens one on the next sample), so a
      // gesture across the seam keeps as two contiguous curves. This is the
      // un-armed mirror of the armed 8.21 behaviour below.
      closeLmbPhrases();
      if (g.recordArmed && composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
      // Loop wrap during sustained MIDI notes splits the curves at the wrap so
      // recordings don't cross the loop boundary as a single curve. Keep the
      // planchettes around so capture continues for still-held keys on the
      // loop-in side under the same voiceId — matches LMB-held perform
      // behaviour, which the surrounding finalizeComposeRecordedCurves call
      // already does. (BACKLOG 8.21)
      finalizeAllInFlightMidiVoices({ keepPlanchette: true });

      // Deliberate one-pass record (BACKLOG 10.5): a queued arm starts here,
      // a pass in progress ends here. Runs after the commits above so the
      // finishing pass's material is captured before we disarm.
      const passState = store.getState().performance.passRecordState;
      if (passState !== 'off') {
        const next = nextPassRecordState(passState);
        store.setPassRecordState(next);
        store.setPerformArmed(next === 'recording');
        if (next === 'recording') showToast('Recording this pass', 1500);
        else showToast('Pass recorded', 2000);
      }

      // One pass = one layer (BACKLOG 10.3): closing the layer here means the
      // next commit opens a fresh one. Deliberately AFTER the commits above —
      // resetting first would push a gesture held across the seam into the
      // NEXT pass's layer, and anything kept during that pass would join it.
      currentLayerTrackId = null;
    },
    onAfkTimeout: composePerformStop,
  });
}

function startComposePerformPlayback() {
  const st = store.getState();
  const comp = st.composition;
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
    endBeat = OPEN_END_BEAT;
  }
  playback.play(comp, startBeat, endBeat, loopStart);
  store.setPlaybackState('playing');
  store.setPerformPhase('playing');
  composeEngine.startSession(performance.now());
  resetLayerSession();
  updatePlayState(true);
  // Snap viewport immediately to avoid first-frame flash.
  scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
  bgDirty = true;
}

function composeToggleArmed() {
  if (store.getState().selectedTrackId === null) return;
  const g = store.getState().performance;

  // Plain R takes over from a queued one-pass arm (10.5) rather than running
  // both — otherwise the pass's end-of-loop disarm would silently stop an
  // open-ended recording the user started afterwards.
  if (g.passRecordState !== 'off') store.setPassRecordState('off');

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
      playback.setPlayRange(0, OPEN_END_BEAT);
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

/**
 * Deliberate "record next full pass" (BACKLOG 10.5) — the structured
 * counterpart to retrospective keep. Arms exactly one loop pass: recording
 * starts at the loop point and auto-commits and disarms at the next one.
 */
function toggleRecordNextPass() {
  const g = store.getState().performance;

  // Already armed or running → cancel. Anything captured so far commits, the
  // same as stopping an ordinary recording.
  if (g.passRecordState !== 'off') {
    if (g.passRecordState === 'recording') {
      if (composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
      finalizeAllInFlightMidiVoices({ keepPlanchette: true });
    }
    store.setPassRecordState('off');
    store.setPerformArmed(false);
    showToast('Pass record cancelled', 2000);
    return;
  }

  if (store.getState().selectedTrackId === null) return;
  ensureResumed();

  // A "pass" is defined by the loop, so turn Loop on rather than refusing —
  // but say so, since it changes the transport out from under the user.
  if (!playback.isLoopEnabled()) {
    playback.setLoop(true);
    loopToggle.checked = true;
    showToast('Record next Pass: Loop On', 2000);
  }

  const comp = store.getComposition();
  if (!playback.isPlaying()) {
    // From idle: start at the loop point and record that first cycle — it *is*
    // the full pass, so recording is live immediately rather than queued.
    const r = canvasContainer.getBoundingClientRect();
    playback.play(comp, comp.loopStartBeats, comp.loopEndBeats, comp.loopStartBeats);
    if (!playback.isPlaying()) {
      showToast('Set a loop range first', 2500);
      return;
    }
    store.setPlaybackState('playing');
    store.setPerformPhase('playing');
    store.setPassRecordState('recording');
    store.setPerformArmed(true);
    composeEngine.startSession(performance.now());
    resetLayerSession();
    updatePlayState(true);
    scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
    bgDirty = true;
    showToast('Recording this pass', 1500);
    return;
  }

  // Transport already running → queue it; the wrap handler starts the capture
  // so the pass is always whole.
  store.setPerformPhase('playing');
  composeEngine.startSession(performance.now());
  store.setPassRecordState('queued');
  showToast('Armed — recording starts at the loop point', 2500);
}

/** Toggle the free-running jam clock (BACKLOG 10.1). Starts instantly — no
 *  countdown, nothing armed: the transport rolls open-ended (or around the
 *  loop range when Loop is on), LMB perform sounds tones, magnetic snap is
 *  live, and nothing is recorded until the user arms Record mid-jam. */
function jamToggle() {
  const g = store.getState().performance;
  if (g.jamActive) {
    composePerformStop();
    store.setPlaybackState('stopped');
    return;
  }
  // A record session owns the transport — don't fight it.
  if (g.recordArmed || g.phase === 'countdown') return;

  ensureResumed();
  store.setJamActive(true);
  if (playback.isPlaying()) {
    // Convert running playback into a jam: open the end (Loop off) and keep rolling.
    if (!playback.isLoopEnabled()) playback.setPlayRange(0, OPEN_END_BEAT);
  } else {
    const comp = store.getComposition();
    const r = canvasContainer.getBoundingClientRect();
    // Jam forces the scrolling view (effectiveScrollCanvas), so start from the
    // beat the user sees under the rail — same convention as Record.
    let startBeat = Math.max(0, viewport.screenToWorld(r.width * RAIL_SCREEN_X_RATIO, 0).wx);
    let endBeat = OPEN_END_BEAT;
    let loopStart = 0;
    if (playback.isLoopEnabled()) {
      const lStart = comp.loopStartBeats;
      const lEnd = comp.loopEndBeats;
      if (startBeat < lStart || startBeat >= lEnd) startBeat = lStart;
      endBeat = lEnd;
      loopStart = lStart;
    }
    playback.play(comp, startBeat, endBeat, loopStart);
    // play() can decline (empty range, bad bounds). Without this guard the UI
    // would show a lit Jam button and a "playing" transport while the clock
    // never actually runs — mirrors the same check in startPlayback().
    if (!playback.isPlaying()) {
      store.setJamActive(false);
      return;
    }
    store.setPlaybackState('playing');
    updatePlayState(true);
    // Snap viewport immediately to avoid first-frame flash.
    scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
    bgDirty = true;
  }
  // Phase 'playing' turns on the engine tick's loop-wrap detection (planchette
  // flash when jamming over a loop) and the idle-timeout check.
  store.setPerformPhase('playing');
  composeEngine.startSession(performance.now());
  resetLayerSession();
}

function composePerformStop() {
  const g = store.getState().performance;
  // Seal in-flight phrases before teardown so a gesture interrupted by Stop
  // stays keepable (the buffer survives the session — BACKLOG 10.2).
  closeLmbPhrases();
  if (g.phase === 'playing' && g.recordArmed && composeEngine.isLmbDown()) {
    finalizeComposeRecordedCurves();
  }
  // Finalize any in-flight MIDI voices before tearing down — otherwise their
  // buffers would be discarded by composeEngine.stopSession() below.
  finalizeAllInFlightMidiVoices();
  if (composeEngine.isLmbDown()) {
    stopComposePerformSounding();
  }
  preview.stopDrawPreview('primary');
  if (playback.isPlaying()) playback.stop();
  composeEngine.stopSession();
  store.setPerformPhase('idle');
  store.setPerformArmed(false);
  store.setJamActive(false);
  store.setPassRecordState('off');
  resetLayerSession();
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
  // Cursor movement counts as presence for the idle auto-stop — an un-armed
  // jam has no captureSample activity marks, so this is its heartbeat.
  if (isComposePerformActive()) composeEngine.markActivity(performance.now());
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
  composeEngine.markActivity(performance.now());
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
  // Close first: the phrase must be sealed before either path claims it.
  closeLmbPhrases();
  if (store.getState().performance.recordArmed) {
    finalizeComposeRecordedCurves();
  }
  // Un-armed perform no longer discards the buffer — the closed phrase stays
  // keepable for KEEP_BUFFER_MS so retrospective capture can commit it
  // after the fact (BACKLOG 10.2). Eviction ages it out.
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

/** AFK warning popup: appears once the user has been idle past
 *  `afkTimeoutMs - AFK_WARNING_LEAD_MS`, counts down the seconds remaining,
 *  and disappears as soon as activity resumes (engine resets idle to 0) or
 *  recording stops. Suppression (loop on / playhead before rightmost) is
 *  inherited automatically — `tickComposePerform` calls `markActivity` every
 *  frame in those cases, so `getIdleMs` stays near zero. */
function updateAfkWarningDom(state: AppState) {
  const g = state.performance;
  const armed = g.recordArmed || state.midiArmedTrackId !== null;
  const shouldShow = (armed || g.jamActive) && g.phase === 'playing' && playback.isPlaying();
  if (!shouldShow) {
    if (!afkWarning.hasAttribute('hidden')) afkWarning.setAttribute('hidden', '');
    return;
  }
  const idleMs = composeEngine.getIdleMs(performance.now());
  // Mirror the timeout selection in tickComposePerform so the popup countdown
  // races the same window the engine will actually fire on.
  const timeoutMs = armed ? composeEngine.getAfkTimeoutMs() : JAM_IDLE_TIMEOUT_MS;
  const remainingMs = timeoutMs - idleMs;
  if (remainingMs > AFK_WARNING_LEAD_MS) {
    if (!afkWarning.hasAttribute('hidden')) afkWarning.setAttribute('hidden', '');
    return;
  }
  // Round up so the user never sees "0" while the engine is still ticking down.
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const label = `${remainingSec}s`;
  if (afkWarningCountdown.textContent !== label) afkWarningCountdown.textContent = label;
  if (afkWarning.hasAttribute('hidden')) afkWarning.removeAttribute('hidden');
}

function updatePerfHudDom(state: AppState) {
  if (!state.perfHudVisible) return;
  perfHud.refresh({
    frameMsP50: frameTimePercentile(0.5),
    frameMsP99: frameTimePercentile(0.99),
    synthCount: getActiveSynthCount(),
    oscillatorCount: getActiveOscillatorCount(),
    voiceCount: state.performance.planchettes.length,
    audioBaseLatencyMs: getAudioContext().baseLatency * 1000,
  });
}

// ── Render loop ─────────────────────────────────────────────────
function render() {
  // Frame-time sample for the Perf HUD's rolling window. Always pushed (the
  // sort cost happens only inside updatePerfHudDom when the HUD is visible)
  // so toggling the HUD on instantly has 2 s of accurate p50/p99.
  pushFrameTime(performance.now());

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
  updateKeepButtonDom();
  updatePitchHudDom(state);
  updateCountdownOverlayDom(state);
  updateAfkWarningDom(state);
  updatePerfHudDom(state);

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
    renderStaff(bgCtx, viewport, rect.width, rect.height, measureLen, scaleRoot, scale, state.hidePitchLines);
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
      isActiveTrack,
      isActiveTrack ? state.selectedPointKeys : null,
    );
  }

  // Rainbow highlight on the projection-source curve (drawn last so it sits
  // on top of the normal curve stroke).
  if (prismSource) {
    renderProjectionSourceHighlight(fgCtx, viewport, prismSource);
  }

  // Draw preview line when in draw mode (hidden during Ctrl-select, and when the
  // cursor has left the canvas so the planchette/dashed preview doesn't freeze
  // at its last position).
  if (state.activeTool === 'draw' && interaction.cursorWorld && interaction.cursorInCanvas) {
    // Use the drawing curve, or the single selected curve if not actively drawing
    const singleId = store.getSelectedCurveId();
    const previewCurve = interaction.drawingCurve
      ?? (singleId
        ? comp.tracks.find(t => t.id === state.selectedTrackId)
            ?.curves.find(c => c.id === singleId)
        : null);
    const points = previewCurve ? pitchPoints(previewCurve) : undefined;
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

  // Live recording trail: polyline of in-flight samples per voice. Drawn above
  // committed curves but below the rail/planchette glyph so the planchette
  // visually leads the trail. Buffers are cleared on finalize, so the trail
  // disappears the same frame the simplified curve commits.
  renderRecordingTrails(
    fgCtx,
    viewport,
    composeEngine.getRecordingBuffers(),
    rect.height,
    state.harmonicPrism.drawMode,
  );

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

  // Drag-marquee rubber-band (BACKLOG 8.3) — drawn on top of everything else
  // so it's always visible during the drag.
  if (interaction.marquee) {
    renderMarquee(fgCtx, viewport, interaction.marquee.startWorld, interaction.marquee.currentWorld);
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
      hidePitchLines: state.hidePitchLines,
    };
    const snapped = snapToGrid(0, cursorWorld.y, snapConfig);
    renderFreePlanchette(
      fgCtx, viewport, cursorScreenX, snapped.wy,
      cursorWorld.y, rect.height,
    );
  }

  // ── Parameters Graph: selected curve's volume lane (X-locked to main canvas) ──
  {
    const selCurve = getSelectedParamCurve();
    let paramColor = '#4fc3f7';
    if (selCurve) {
      for (const track of comp.tracks) {
        if (track.curves.includes(selCurve)) {
          const tone = comp.toneLibrary.find(t => t.id === track.toneId);
          if (tone) paramColor = tone.color;
          break;
        }
      }
    }
    const paramPlayheadBeat = playback.isPlaying()
      ? playback.getPositionBeats()
      : state.playback.positionBeats;
    const selPts = selCurve ? pitchPoints(selCurve) : undefined;
    const pitchStart = selPts && selPts.length > 0 ? selPts[0]!.position.x : null;
    const pitchEnd = selPts && selPts.length > 0 ? selPts[selPts.length - 1]!.position.x : null;
    // Lazily attach a default volume lane to a selected curve that doesn't have
    // one yet (e.g. a just-drawn curve before finishDrawing, or a chord sibling),
    // so the graph shows and is editable immediately — not only after the first
    // draw event. The default matches the audio fallback, so this is a no-op for
    // sound and undo.
    if (selCurve && pitchPoints(selCurve).length >= 2) {
      ensureLane(selCurve, 'volume');
    }
    // While the curve is actively being drawn, keep the trailing volume point
    // pinned to the live end of the pitch curve. Otherwise the end point stays
    // where it was when the lane was first created (at the 2nd pitch point),
    // leaving a stray volume point near the start of a long curve.
    if (selCurve && interaction.drawingCurve === selCurve && pitchEnd !== null) {
      const vpts = getLane(selCurve, 'volume')?.points;
      if (vpts && vpts.length >= 2) {
        const prevX = vpts[vpts.length - 2]!.position.x + 0.001;
        vpts[vpts.length - 1]!.position.x = Math.max(prevX, pitchEnd);
      }
    }
    renderParamGraph(
      paramCtx, paramViewport, viewport,
      paramW, paramH,
      (selCurve ? getLane(selCurve, 'volume') : null) ?? null,
      paramColor,
      paramInteraction.selectedIndex(),
      paramPlayheadBeat,
      pitchStart,
      pitchEnd,
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
  lengthDisplay.textContent = formatLengthMMSS(length, comp.bpm);
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
    // Live voice counts — the observable for "removing a track stops its sound".
    getActiveSynthCount, getActiveOscillatorCount,
  };
}

// ── Store subscription ──────────────────────────────────────────
store.subscribe(() => {
  bgDirty = true;
  const comp = store.getComposition();
  // Undo / redo / file open replace the composition object outright, so keep the
  // scheduler pointed at the live one — otherwise every edit after an undo taken
  // mid-playback would be inaudible until the next play().
  if (playback.isPlaying()) playback.setComposition(comp);
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
  viewport.state.offsetX = 0;
  viewport.state.offsetY = midPitch + visibleCents / 2 + viewport.topInset / viewport.state.zoomY;
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
