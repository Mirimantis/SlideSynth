import { createViewport } from './canvas/viewport';
import { createParamViewport } from './canvas/param-viewport';
import { renderParamGraph } from './canvas/param-graph-renderer';
import { createParamInteraction } from './canvas/param-interaction';
import { displayedLane } from './model/lane';
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
import { snapToGrid, findAdaptiveSnap } from './utils/snap';
import { createInteraction, rebuildTransformBox, RULER_HEIGHT } from './canvas/interaction';
import { currentSnapConfig } from './state/snap-config';
import { createInputRouter, type GestureHandlers } from './canvas/input-router';
import { createPreviewManager } from './audio/preview';
import { renderRuler } from './canvas/ruler-renderer';
import { createToolbar } from './ui/toolbar';
import { createToolPanel } from './ui/tool-panel';
import { createPrismPanel } from './ui/prism-panel';
import { openContextMenu, type ContextMenuItem } from './ui/context-menu';
import { createPlaybackEngine } from './audio/playback';
import { createMetronome } from './audio/metronome';
import { createMidiInput } from './audio/midi-input';
import { createDynamicsBus, isDynamicsSource } from './audio/dynamics-bus';
import { createMagneticState, updateMagnetic, resetMagnetic } from './utils/snap-magnetic';
import { renderPlanchettes, renderFreePlanchette, renderRail, renderRecordingTrails, renderMetronomeFlash, METRONOME_FLASH_DURATION_MS, LOOP_WRAP_FLASH_MS, PULSE_DURATION_MS, RAIL_SCREEN_X_RATIO } from './canvas/planchette';
import { h, render } from 'preact';
import { PropertyPanel } from './ui/property-panel';
import { ToolPropertyPanel } from './ui/tool-property-panel';
import { TrackList, type TrackListActions } from './ui/track-list';
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
import { createTrack } from './model/track';
import { getCompositionLength, measureLengthInBeats } from './model/composition';
import { computeMultiCurveBBox, pitchPoints } from './model/curve';
import { createGroupId } from './model/curve-groups';
import { chordOffsets } from './utils/harmonics';
import { showToast } from './ui/toast';
import { commandSpec, commandTitle, primaryShortcut, type CommandId } from './commands/catalog';
import { createCommandRegistry } from './commands/registry';
import { createEditCommands } from './commands/edit-commands';
import { TOOL_COMMANDS } from './ui/tool-panel';
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
import iconLoop from './assets/icons/loop.svg?raw';
import { canOpenLayer, createLayerTrack, newestLayerTrack, LAYER_TRACK_LIMIT } from './model/layer';
import { findDroppablePass, dropPassCurves, type CommittedPass } from './model/pass-log';
import { effectiveScrollCanvas as effectiveScrollCanvasFor, isPerformInputActive } from './state/perform-mode';
import { effect, watch } from './state/reactive';
import type { AppState, Composition, ToolMode, BezierCurve, TransportState } from './types';
import { TRANSPORT_STOPPED, transition, type TransportEvent, isRolling, isRecordArmed, isCapturing, isJamming, passRecordState, performPhase } from './state/transport';

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
        <button id="btn-play" title="${commandSpec('transport.play').label} (${primaryShortcut('transport.playPause')})"></button>
        <button id="btn-pause" title="${commandTitle('transport.pause')}" disabled></button>
        <button id="btn-stop" title="${commandTitle('transport.stop')}"></button>
        <button id="btn-record" class="record-btn" title="${commandTitle('transport.record')}" hidden></button>
        <button id="btn-jam" class="jam-btn" title="${commandTitle('transport.jam')}"></button>
        <button id="btn-keep" class="keep-btn" title="${commandTitle('perform.keep')}" disabled></button>
      </div>
      <div class="toolbar-toggles">
        <button id="snap-toggle" class="icon-toggle" title="${commandTitle('snap.toggle')}" aria-label="Snap" aria-pressed="true"></button>
        <button id="loop-toggle-btn" class="icon-toggle" title="${commandTitle('transport.loop')}" aria-label="Loop" aria-pressed="false"></button>
      </div>
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
            <label class="toggle-switch" title="${commandTitle('transport.loop')}">
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
            <label id="perf-hud-label" class="toggle-switch" title="Show frame ms, synth/oscillator/voice counts, and audio latency (${primaryShortcut('view.perfHud')})">
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
            <label>Dynamics</label>
            <select id="input-dynamics-source" title="What drives performed volume">
              <option value="fixed">Fixed</option>
              <option value="key-swell">Key swell (hold F)</option>
            </select>
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
                <input type="checkbox" id="magnetic-toggle" checked />
                <span class="toggle-switch-thumb"></span>
              </span>
              <span class="toggle-switch-label">Magnetic</span>
            </label>
          </div>
          <div class="transport-row">
            <label for="input-magnetic-strength">Force</label>
            <input type="range" id="input-magnetic-strength" class="magnetic-strength-slider" min="0" max="1" value="0.85" step="0.05" title="Force: how hard snap lines pull the pitch (0 = smooth cursor follow, 1 = strong snap pull)" />
            <span class="magnetic-strength-value">0.85</span>
          </div>
          <div class="transport-row">
            <label for="input-magnetic-spring">Spring</label>
            <input type="range" id="input-magnetic-spring" class="magnetic-spring-slider" min="1" max="50" value="50" step="1" title="Cursor-to-pitch spring stiffness (1 = loose, 50 = tight tracking)" />
            <span class="magnetic-spring-value">50</span>
          </div>
          <div class="transport-row">
            <label for="input-magnetic-damping">Damping</label>
            <input type="range" id="input-magnetic-damping" class="magnetic-damping-slider" min="0.25" max="15" value="6" step="0.25" title="Velocity damping (low = long vibrato wobbles, high = quick settle)" />
            <span class="magnetic-damping-value">6</span>
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
        <div class="drawer-header" title="Harmonic Prism — ${primaryShortcut('prism.drawMode')}: Draw mode; ${primaryShortcut('prism.projection')}: projection from the selected curve">Harmonic Prism</div>
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
watch(() => store.getSelectedCurveId(), () => paramInteraction.resetSelection());

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
  <span class="hud-slot hud-dyn" id="hud-dyn"></span>
`;
const hudSnapName = document.getElementById('hud-snap-name') as HTMLSpanElement;
const hudSnapCents = document.getElementById('hud-snap-cents') as HTMLSpanElement;
const hudSnapHz = document.getElementById('hud-snap-hz') as HTMLSpanElement;
const hudSep = document.getElementById('hud-sep') as HTMLSpanElement;
const hudRawName = document.getElementById('hud-raw-name') as HTMLSpanElement;
const hudRawCents = document.getElementById('hud-raw-cents') as HTMLSpanElement;
const hudDyn = document.getElementById('hud-dyn') as HTMLSpanElement;

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

/** Four-step bar for the dynamics readout, quietest to loudest. */
const DYNAMICS_BAR_GLYPHS = ['▁', '▃', '▅', '▇'];

function formatDynamics(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.max(1, Math.ceil(clamped * DYNAMICS_BAR_GLYPHS.length));
  return `${DYNAMICS_BAR_GLYPHS.slice(0, filled).join('')} ${clamped.toFixed(2)}`;
}

/** Fill each HUD slot in place — no innerHTML, no text concatenation.
 *  `dynamics` is null when the bus isn't driving (fixed source), which blanks
 *  the slot so the HUD reads exactly as it did pre-bus. */
function writePitchHud(snappedY: number | null, rawY: number | null, dynamics: number | null = null): void {
  hudDyn.textContent = dynamics == null ? '' : formatDynamics(dynamics);
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
function setPreviewActive(on: boolean): void {
  previewActive = on;
  requestRedraw(); // the free planchette appears / disappears
}

// ── Dynamics bus (BACKLOG 11.1) ────────────────────────────────
// One normalized channel driving live perform loudness AND the recorded volume
// lane. Seeded from the persisted workspace preference; `fixed` reproduces the
// pre-bus constant exactly.
const dynamics = createDynamicsBus(store.getState().dynamicsSource);
const dynamicsSourceSelect = document.getElementById('input-dynamics-source') as HTMLSelectElement;
dynamicsSourceSelect.value = dynamics.getSource();
dynamicsSourceSelect.addEventListener('change', () => {
  const value = dynamicsSourceSelect.value;
  if (!isDynamicsSource(value)) return;
  dynamics.setSource(value);
  store.setDynamicsSource(value);
  dynamicsSourceSelect.blur();
});
// A keyup that lands while the window is unfocused never reaches us, which
// would leave the swell latched on. Releasing on blur is the cheap fix.
window.addEventListener('blur', () => dynamics.setSwellHeld(false));

// Spacebar tap-vs-hold: under this threshold, Space is a transport tap (play / pause /
// stop-recording). Past it, Space becomes a hold-to-preview. The timer fires the preview
// activation so a quick tap never triggers audio preview.
const SPACE_HOLD_MS = 250;
let spaceHoldTimer: number | null = null;

/** Start the preview appropriate to current context (Draw cursor, scrubbing). No-op during recording. */
function activateSpacePreview() {
  spaceHoldTimer = null;
  const state = store.getState();
  if (isRecordArmed(state.transport)) return;
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
      setPreviewActive(true);
      // Classic-playhead mode: snap the playhead to the cursor so the user sees the scrub
      // location. Leaves it there on preview end (easy way to summon a far-away playhead).
      if (!state.scrollCanvasEnabled) {
        store.setPlaybackPosition(Math.max(0, interaction.cursorWorld.x));
      }
    } else if (tone && interaction.cursorWorld) {
      startPrismDrawPreview(tone, interaction.cursorWorld.y);
      setPreviewActive(true);
    }
  } else if (inScrubContext) {
    preview.startScrubPreview(state.composition);
    preview.updateScrubPosition(state.playback.positionBeats, state.composition);
    setPreviewActive(true);
  }
}

/** Short-tap action: pause plain playback (a jam or recording stops instead),
 *  cancel a count-in, or start playing. */
function handleSpaceTap() {
  const t = store.getState().transport;
  if (isRolling(t)) transport({ type: 'pause' });
  else if (t.mode === 'countdown') transport({ type: 'escape' });
  else transport({ type: 'play' });
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
      if (!isRecordArmed(store.getState().transport) && !preview.isScrubPreviewActive()) {
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
      if (scrubWasPlaying) playEngineFrom(store.getState().transport, beats);
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
  if (!applyingTransport && !playback.isPlaying() && isRolling(store.getState().transport)) {
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
watch(
  () => `${store.getState().scaleRoot}|${store.getState().hidePitchLines}`,
  () => {
    const s = store.getState();
    toolbar.updateScaleRoot(s.scaleRoot, s.hidePitchLines);
  },
);
watch(() => store.getState().scaleId, id => toolbar.updateScaleId(id));

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
// Top-bar icon toggles. Snap reuses the Snap drawer's icon so the two read as
// the same feature — the button is the on/off, the drawer is the detail.
setIcon(document.getElementById('snap-toggle')!, iconSnap);
setIcon(document.getElementById('loop-toggle-btn')!, iconLoop);

/** Drive an `.icon-toggle` button's on/off state. `aria-pressed` is both the
 *  accessible state and the CSS hook, so there's one source of truth. Writes
 *  only on change — these are called from the per-frame sync. */
function setIconTogglePressed(btn: HTMLButtonElement, on: boolean): void {
  const next = on ? 'true' : 'false';
  if (btn.getAttribute('aria-pressed') !== next) btn.setAttribute('aria-pressed', next);
}

// ── Tool panel (Tools drawer) ──────────────────────────────────
/** Entering Select with curves already selected (e.g. a track clicked while in
 *  Draw) shows their transform box straight away. */
function buildTransformBoxFromSelection(): void {
  const st = store.getState();
  if (st.selectedCurveIds.size === 0 || interaction.transformBox) return;
  const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
  if (track) rebuildTransformBox(interaction, track);
}

const toolPanelContainer = document.getElementById('tool-panel')!;
const toolPanel = createToolPanel(toolPanelContainer, {
  onToolChange: tool => commands.run(TOOL_COMMANDS[tool]),
});

// ── Harmonic Prism panel (chord-spec picker) ───────────────────
const prismPanelContainer = document.getElementById('prism-panel')!;
const prismPanel = createPrismPanel(prismPanelContainer);
// The panel shows only the Prism settings, so it re-renders only when they change.
watch(() => JSON.stringify(store.getState().harmonicPrism), () => prismPanel.refresh());

// ── Transport controls (in track panel) ────────────────────────
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnRecord = document.getElementById('btn-record') as HTMLButtonElement;
const btnJam = document.getElementById('btn-jam') as HTMLButtonElement;
const btnKeep = document.getElementById('btn-keep') as HTMLButtonElement;
const bpmInput = document.getElementById('input-bpm') as HTMLInputElement;
const loopToggle = document.getElementById('loop-toggle') as HTMLInputElement;
const loopToggleBtn = document.getElementById('loop-toggle-btn') as HTMLButtonElement;
setIconTogglePressed(loopToggleBtn, loopToggle.checked);
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
  // Same reasoning as the boot case (BACKLOG 13.3): once the rail is where the
  // next gesture lands, beat 0 belongs under it. Only on an empty composition —
  // with content on the canvas, yanking the view out from under the user would
  // be worse than leaving it, and playback re-centres on the playhead anyway.
  if (lockRailToggle.checked && getCompositionLength(store.getComposition()) === 0) {
    const r = canvasContainer.getBoundingClientRect();
    scrollViewportToBeat(viewport, 0, r.width, r.height);
    updateZoom();
    bgDirty = true;
  }
  lockRailToggle.blur();
});
const pitchHudToggle = document.getElementById('pitch-hud-toggle') as HTMLInputElement;
watch(() => store.getState().pitchHudVisible, v => { pitchHudToggle.checked = v; });
pitchHudToggle.addEventListener('change', () => {
  store.setPitchHudVisible(pitchHudToggle.checked);
  pitchHudToggle.blur();
});
const perfHudToggle = document.getElementById('perf-hud-toggle') as HTMLInputElement;
perfHudToggle.addEventListener('change', () => {
  store.setPerfHudVisible(perfHudToggle.checked);
  perfHudToggle.blur();
});
const perfHud = createPerfHud(document.getElementById('perf-hud') as HTMLDivElement);
// Follows the store, so the `!` hotkey and the checkbox stay in step.
watch(() => store.getState().perfHudVisible, v => {
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
/** Minimum offsetX for clamping — negative when Scroll Canvas is on so beat 0 can
 * reach the rail at canvas centre. */
function minPanOffsetX(canvasWidth: number): number {
  return store.getState().scrollCanvasEnabled
    ? -(canvasWidth * RAIL_SCREEN_X_RATIO) / viewport.state.zoomX
    : 0;
}
/** True when a Scroll-Canvas Playback state hijacks LMB for Perform. The tool
 *  handlers in interaction.ts ask this same function (BACKLOG 14.1). */
function isComposePerformActive(): boolean {
  return isPerformInputActive(store.getState());
}

function updatePlayState(playing: boolean) {
  btnPlay.disabled = playing;
  btnPause.disabled = !playing;
}

function updateRecordButtonVisuals() {
  const st = store.getState();
  const t = st.transport;

  btnRecord.removeAttribute('hidden');
  // Queued (10.5) is its own state: waiting for the loop point, not yet capturing.
  btnRecord.classList.toggle('queued', passRecordState(t) === 'queued');
  btnRecord.classList.toggle('armed', t.mode === 'countdown');
  btnRecord.classList.toggle('recording', isCapturing(t));
  btnRecord.disabled = st.selectedTrackId === null;

  btnJam.classList.toggle('jamming', isJamming(t));
  // A record session owns the transport; jam can't start (or stop) under it.
  btnJam.disabled = isRecordArmed(t);

  lockRailToggle.checked = st.scrollCanvasEnabled;
  layerToggle.checked = st.layerModeEnabled;

  // Lock loop toggle while recording — both controls that expose it.
  const loopLocked = isCapturing(t);
  loopToggle.disabled = loopLocked;
  loopToggleBtn.disabled = loopLocked;
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
    ? `${commandTitle('perform.keep')} (${keepable} keepable)`
    : commandTitle('perform.keep');
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

btnPlay.addEventListener('click', () => commands.run('transport.play'));
btnPause.addEventListener('click', () => commands.run('transport.pause'));
btnStop.addEventListener('click', () => commands.run('transport.stop'));
// Shift+click mirrors Shift+R — one obvious place for both record styles.
btnRecord.addEventListener('click', (e) => commands.run(e.shiftKey ? 'transport.recordPass' : 'transport.record'));
btnJam.addEventListener('click', () => commands.run('transport.jam'));
btnKeep.addEventListener('click', () => commands.run('perform.keep'));

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

// Apply the composition's tuning now and whenever it changes (load, undo/redo, setter).
watch(() => store.getComposition().tuningOffsetCents, () => syncTuningToAudio());

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
watch(() => store.getState().midiArmedTrackId !== null, armed => { midiArmHintShown = armed; });

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

// ── Snap toggle (top bar icon button) ──────────────────────────
const snapToggleBtn = document.getElementById('snap-toggle') as HTMLButtonElement;
snapToggleBtn.addEventListener('click', () => {
  commands.run('snap.toggle');
  snapToggleBtn.blur();
});

// ── Magnetic Snap toggle + Force / Spring / Damping sliders (Transport) ─
// The Force slider is `magneticStrength` internally — the field is persisted in
// the composition file, so the rename (BACKLOG 13.1) is display-only.
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

/** Push the current snap values into the DOM controls. Runs from the snap
 *  watch below — on load, undo/redo, file open, presets, hotkeys and the
 *  controls themselves (re-setting a dragged slider's own value is harmless). */
function syncSnapSectionDom(): void {
  const st = store.getState();
  setIconTogglePressed(snapToggleBtn, st.snapEnabled);
  magneticToggle.checked = st.magneticEnabled;
  magneticStrengthSlider.value = String(st.magneticStrength);
  magneticStrengthValue.textContent = st.magneticStrength.toFixed(2);
  magneticSpringSlider.value = String(st.magneticSpringK);
  magneticSpringValue.textContent = String(Math.round(st.magneticSpringK));
  magneticDampingSlider.value = String(st.magneticDamping);
  magneticDampingValue.textContent = formatDamping(st.magneticDamping);
}

magneticToggle.addEventListener('change', () => {
  store.setMagneticEnabled(magneticToggle.checked);
  magneticToggle.blur();
});
magneticStrengthSlider.addEventListener('input', () => {
  store.setMagneticStrength(Number(magneticStrengthSlider.value));
});
magneticSpringSlider.addEventListener('input', () => {
  store.setMagneticSpringK(Number(magneticSpringSlider.value));
});
magneticDampingSlider.addEventListener('input', () => {
  store.setMagneticDamping(Number(magneticDampingSlider.value));
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

// The whole snap drawer follows composition.snap.
watch(
  () => {
    const st = store.getState();
    return `${st.snapEnabled}|${st.magneticEnabled}|${st.magneticStrength}|${st.magneticSpringK}|${st.magneticDamping}`;
  },
  () => {
    syncSnapSectionDom();
    syncSnapPresetUi();
  },
);

snapPresetSelect.addEventListener('change', () => {
  const id = snapPresetSelect.value;
  if (id === CUSTOM_PRESET_VALUE) return;
  const preset = getAllPresets().find(p => p.id === id);
  if (!preset) return;
  // Presets are feel-only (BACKLOG 13.2), but magnetic physics is gated on
  // `snapEnabled && magneticEnabled` — so a load with either toggle off would be
  // silently inaudible. Turn both on and say so, per the 10.5 auto-Loop precedent.
  const st = store.getState();
  const turnedOn: string[] = [];
  if (!st.snapEnabled) { store.setSnap(true); turnedOn.push('Snap'); }
  if (!st.magneticEnabled) { store.setMagneticEnabled(true); turnedOn.push('Magnetic'); }
  if (turnedOn.length > 0) showToast(`${preset.name}: ${turnedOn.join(' + ')} On`);

  // Apply each defined field via the corresponding setter (write-through to comp.snap).
  // Note: no history.snapshot() — preset loading mirrors the magnetic-slider precedent.
  const s = preset.settings;
  if (s.magneticStrength !== undefined) store.setMagneticStrength(s.magneticStrength);
  if (s.magneticSpringK !== undefined) store.setMagneticSpringK(s.magneticSpringK);
  if (s.magneticDamping !== undefined) store.setMagneticDamping(s.magneticDamping);
  // The setters above already re-synced the drawer; sync again now that the
  // picked preset is active, so it wins over any other preset that also matches.
  activeSnapPresetId = preset.id;
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
watch(() => store.getState().guidesVisible, v => { guidesVisibleToggle.checked = v; });

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
watch(() => store.getState().guidesLocked, locked => {
  guidesLockedToggle.checked = locked;
  syncGuideAddButtonsEnabled();
});

guidesVisibleToggle.addEventListener('change', () => {
  store.setGuidesVisible(guidesVisibleToggle.checked);
  bgDirty = true;
  guidesVisibleToggle.blur();
});
guidesLockedToggle.addEventListener('change', () => {
  store.setGuidesLocked(guidesLockedToggle.checked);
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
watch(() => store.getState().metronomeEnabled, on => {
  metronomeToggle.checked = on;
  metronome.setEnabled(on);
});
watch(() => store.getState().metronomeVolume, v => {
  metronomeVolumeSlider.value = String(Math.round(v * 100));
  metronome.setVolume(v);
});
metronomeToggle.addEventListener('change', () => {
  store.setMetronomeEnabled(metronomeToggle.checked);
  metronomeToggle.blur();
});
metronomeVolumeSlider.addEventListener('input', () => {
  store.setMetronomeVolume(Number(metronomeVolumeSlider.value) / 100);
});

/** Loop on/off. Three controls reach it — the top-bar icon button, the
 *  Transport drawer checkbox, and the L hotkey — plus Record-next-Pass forcing
 *  it on. State owns the flag; the engine, both controls and the play range
 *  follow it (the watch below and the play-range watch at the end of the file). */
function applyLoopEnabled(enabled: boolean): void {
  store.setLoopEnabled(enabled);
}
watch(() => store.getState().loopEnabled, enabled => {
  playback.setLoop(enabled);
  loopToggle.checked = enabled;
  setIconTogglePressed(loopToggleBtn, enabled);
});

loopToggle.addEventListener('change', () => {
  applyLoopEnabled(loopToggle.checked);
  loopToggle.blur();
});

loopToggleBtn.addEventListener('click', () => {
  commands.run('transport.loop');
  loopToggleBtn.blur();
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

function addFileMenuItem(id: CommandId) {
  const item = document.createElement('button');
  item.className = 'file-menu-item';
  const keys = primaryShortcut(id);
  item.textContent = keys ? `${commandSpec(id).label} (${keys})` : commandSpec(id).label;
  item.addEventListener('click', () => {
    closeFileMenu();
    commands.run(id);
  });
  fileDropdown.appendChild(item);
}
for (const id of ['file.save', 'file.open', 'file.importMidi', 'file.exportWav', 'help.open'] as const) {
  addFileMenuItem(id);
}

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

// ── Undo / Redo buttons ────────────────────────────────────────
const undoBtn = addToolbarButton(commandSpec('edit.undo').label, commandTitle('edit.undo'), () => commands.run('edit.undo'));
const redoBtn = addToolbarButton(commandSpec('edit.redo').label, commandTitle('edit.redo'), () => commands.run('edit.redo'));

undoBtn.disabled = true;
redoBtn.disabled = true;

history.subscribe(() => {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
});

// ── Commands (BACKLOG 15.3) ─────────────────────────────────────
// What each command in the catalog (commands/catalog.ts) does. The keyboard,
// buttons and menus all run commands through `commands`, so a key and the
// button for the same action can't drift apart. Edit commands live in
// commands/edit-commands.ts.

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
  } else if (tool === 'draw') {
    // Clear the transform box but keep the curve selection so Draw extends it.
    interaction.transformBox = null;
  } else if (tool === 'select') {
    buildTransformBoxFromSelection();
  }
}

/** Escape backs out: a count-in, recording or jam first; otherwise the edit
 *  in progress (transform box, or the curve being drawn) and Prism projection. */
function escapeCommand() {
  const before = store.getState().transport;
  transport({ type: 'escape' });
  if (store.getState().transport !== before) return;
  if (!isComposePerformActive()) {
    if (interaction.transformBox) interaction.dismissTransformBox();
    else if (store.getState().activeTool === 'draw' && interaction.hasDrawTarget()) interaction.finishDrawing();
  }
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

/** Centre the view on a beat. */
function scrollToBeat(beat: number) {
  const r = canvasContainer.getBoundingClientRect();
  scrollViewportToBeat(viewport, beat, r.width, r.height);
  bgDirty = true;
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

/** Paste lands at the playhead. With Lock Rail on and stopped, the rail is
 *  what reads as "here" — the stored playhead can lag behind a manual pan. */
function pasteBeat(): number {
  const st = store.getState();
  return st.scrollCanvasEnabled && !playback.isPlaying() ? railBeat() : st.playback.positionBeats;
}

/** Load a whole composition (file open, MIDI import) as one undoable step. */
function replaceComposition(comp: Composition) {
  // Stop first so anything a running session captured commits into the
  // composition the undo snapshot below preserves.
  transport({ type: 'stop' });
  history.snapshot();
  store.loadComposition(comp);
  nameInput.value = comp.name || 'Untitled';
}

const notWhilePerforming = () => !isComposePerformActive();

const commands = createCommandRegistry({
  ...createEditCommands({ interaction, viewport, isPerformLocked: isComposePerformActive, pasteBeat }),

  // ── Transport ──
  'transport.playPause': {
    // Tap vs hold: a release before SPACE_HOLD_MS is a transport tap; past it,
    // Space becomes hold-to-preview.
    run() {
      if (spaceHoldTimer !== null) window.clearTimeout(spaceHoldTimer);
      spaceHoldTimer = window.setTimeout(activateSpacePreview, SPACE_HOLD_MS);
    },
    // Timer still pending: a tap. Timer fired but no preview started (e.g.
    // recording): still a tap, so the transport responds. Otherwise the end of
    // a hold: stop the preview.
    release() {
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
      setPreviewActive(false);
    },
  },
  'transport.play': { run: () => transport({ type: 'play' }) },
  // Plain playback pauses; a jam, recording or queued pass ends instead — a
  // free-running clock or a capture has no paused state to resume.
  'transport.pause': { run: () => transport({ type: 'pause' }) },
  'transport.stop': {
    run() {
      transport({ type: 'stop' });
      // Stop also rewinds the classic playhead, even when already stopped.
      store.setPlaybackPosition(0);
    },
  },
  'transport.record': { run: toggleRecord },
  'transport.recordPass': { run: toggleRecordNextPass },
  'transport.jam': { run: () => transport({ type: 'toggle-jam' }) },
  'transport.loop': { run: () => applyLoopEnabled(!store.getState().loopEnabled) },
  'transport.escape': { run: escapeCommand },

  // ── Perform ──
  'perform.keep': { run: keepLastPhrase },
  'perform.dropPass': { run: dropLastPass },
  // Dynamics swell (11.1): only on the key-swell source, so F is free otherwise.
  'perform.swell': {
    run: () => dynamics.setSwellHeld(true),
    release: () => dynamics.setSwellHeld(false),
    enabled: () => dynamics.getSource() === 'key-swell',
  },

  // ── Tools ── (off while the left button performs, like the tool buttons)
  'tool.draw': { run: () => selectTool('draw'), enabled: notWhilePerforming },
  'tool.select': { run: () => selectTool('select'), enabled: notWhilePerforming },
  'tool.delete': { run: () => selectTool('delete'), enabled: notWhilePerforming },
  'tool.slice': { run: () => selectTool('scissors'), enabled: notWhilePerforming },
  'edit.finishCurve': {
    run: () => interaction.finishDrawing(),
    enabled: () => notWhilePerforming() && store.getState().activeTool === 'draw' && interaction.hasDrawTarget(),
  },
  'snap.toggle': { run: () => store.setSnap(!store.getState().snapEnabled) },

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
  // The perfHudVisible watch mirrors this into the Transport-panel checkbox.
  'view.perfHud': { run: () => store.setPerfHudVisible(!store.getState().perfHudVisible) },
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
});

commands.installKeyboard(window, e =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement);

// ── Track panel ─────────────────────────────────────────────────
/** What the track list's controls do (the list itself is ui/track-list.tsx).
 *  Each looks the track up by id when it runs — an undo swaps in new objects. */
const trackListActions: TrackListActions = {
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
      if (t) t.solo = !t.solo;
    });
  },
  toggleMidiArm(trackId) {
    const current = store.getState().midiArmedTrackId;
    // Switching or disarming while notes are held: finalize those voices first
    // so their samples aren't orphaned by the arm change.
    if (current !== null) finalizeAllInFlightMidiVoices();
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
    if (store.getState().midiArmedTrackId === trackId) finalizeAllInFlightMidiVoices();
    history.snapshot();
    // If the current layer lived here, clear it so the next pass opens a new one.
    if (currentLayerTrackId === trackId) currentLayerTrackId = null;
    store.removeTrack(trackId);
    showToast(`Deleted ${track.name} — Ctrl+Z to restore`, 2500);
  },
};
render(h(TrackList, { actions: trackListActions }), document.getElementById('track-list')!);

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
      bgDirty = true;
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
  // The same targets drawing uses (15.6): scale or chromatic lines, pitch
  // guides, and Prism projection echoes at the rail's beat. Only Y is snapped
  // here — time advances with the transport.
  const snapConfig = currentSnapConfig({ zoomX: viewport.state.zoomX, atBeat: railBeat() });

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
  const performContext = isComposePerformActive() || isRecordArmed(st.transport);

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
    // Start at the bus's current value so the note doesn't jump on the first
    // frame. Under the `fixed` source this is exactly the old preview level.
    preview.startDrawPreview(tone, y, p.voiceId, dynamics.getValue(p.voiceId));
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
    (playback.isPlaying() || isRecordArmed(st.transport));

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
      if (tone) preview.startDrawPreview(tone, initialY, voiceId, dynamics.getValue(voiceId));
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
  // Any rolling transport captures an armed MIDI track — plain Play included,
  // which used to spawn the note planchettes but never record them (15.2).
  const midiActive = st.midiArmedTrackId !== null && isRolling(st.transport);
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
      // The dynamics bus replaces what used to be a hardcoded 0.8 (BACKLOG
      // 11.1). Its `fixed` source still returns exactly that, so a take made
      // without a dynamics input records identically to before.
      volume: dynamics.getValue(p.voiceId),
    });
  }
}

/** Dynamics halo resolver for the planchette renderer: null while the bus is on
 *  its `fixed` source (draw as before the bus), and null for voices that aren't
 *  sounding (an idle planchette has no dynamics to show). */
function planchetteDynamicsOf(voiceId: string): number | null {
  if (!dynamics.isDriven()) return null;
  if (!preview.isDrawPreviewActive(voiceId)) return null;
  return dynamics.getValue(voiceId);
}

/** Push the bus into every sounding voice, so what you hear tracks the swell.
 *  Runs each frame; `setVoiceVolume` no-ops for voices that aren't sounding and
 *  for values that haven't moved. */
function applyDynamicsToSoundingVoices() {
  if (!dynamics.isDriven()) return;
  for (const p of store.getState().performance.planchettes) {
    preview.setVoiceVolume(p.voiceId, dynamics.getValue(p.voiceId));
  }
  // Held MIDI notes with no armed track have no planchette but are still
  // sounding — the swell should shape them too.
  for (const note of heldMidiNotes) {
    const voiceId = `midi-${note}`;
    preview.setVoiceVolume(voiceId, dynamics.getValue(voiceId));
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
  const t = st.transport;
  // Treat MIDI-armed as record-armed for engine purposes (AFK gate) so the
  // player gets the same affordances when arming via MIDI alone.
  const anyArmed = isRecordArmed(t) || st.midiArmedTrackId !== null;
  const playbackBeat = playback.getPositionBeats();

  // Keep the AFK timer fresh while there's a meaningful reason to keep waiting:
  // (a) Loop is on (intentional record-over-loops), or (b) the playhead hasn't
  // crossed the rightmost control point yet (still future content to record over).
  // Refresh per tick so the user gets a full afkTimeoutMs window after the
  // suppressing condition lifts, instead of an immediate auto-stop.
  if (anyArmed && isRolling(t) && playback.isPlaying()) {
    const rightmost = getCompositionLength(st.composition);
    if (st.loopEnabled || playbackBeat < rightmost) {
      composeEngine.markActivity(performance.now());
    }
  }

  // Idle-window selection: armed recording keeps the short AFK timeout; an
  // un-armed jam gets the long jam timeout; anything else never auto-stops.
  const idleTimeoutMs = anyArmed
    ? composeEngine.getAfkTimeoutMs()
    : (isJamming(t) ? JAM_IDLE_TIMEOUT_MS : Infinity);

  composeEngine.tick({
    now: performance.now(),
    audioNow: getAudioContext().currentTime,
    isPlaying: playback.isPlaying(),
    phase: performPhase(t),
    idleTimeoutMs,
    countdownStartedAt: t.countdownStartedAt,
    playbackBeat,
    onCountdownElapsed: () => transport({ type: 'countdown-elapsed' }),
    onLoopWrap: () => {
      // Seal phrases at the seam so none ever spans the loop boundary — a
      // phrase containing the wrap would carry a backwards beat jump and
      // couldn't be fitted. Held voices resume into a fresh phrase on the
      // loop-in side (captureSample opens one on the next sample), so a
      // gesture across the seam keeps as two contiguous curves. This is the
      // un-armed mirror of the armed 8.21 behaviour below.
      closeLmbPhrases();
      if (isCapturing(store.getState().transport) && composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
      // Loop wrap during sustained MIDI notes splits the curves at the wrap so
      // recordings don't cross the loop boundary as a single curve. Keep the
      // planchettes around so capture continues for still-held keys on the
      // loop-in side under the same voiceId — matches LMB-held perform
      // behaviour, which the surrounding finalizeComposeRecordedCurves call
      // already does. (BACKLOG 8.21)
      finalizeAllInFlightMidiVoices({ keepPlanchette: true });

      // Deliberate one-pass record (BACKLOG 10.5): a queued pass starts here,
      // a pass in progress ends here. After the commits above, so the
      // finishing pass's material is captured before capture stops.
      transport({ type: 'loop-wrap' });

      // One pass = one layer (BACKLOG 10.3): closing the layer here means the
      // next commit opens a fresh one. Deliberately AFTER the commits above —
      // resetting first would push a gesture held across the seam into the
      // NEXT pass's layer, and anything kept during that pass would join it.
      currentLayerTrackId = null;
    },
    onAfkTimeout: () => transport({ type: 'stop' }),
  });
}

// ── Transport controller (BACKLOG 15.2) ─────────────────────────
// Every transport change goes through `transport(event)`: the pure state
// machine in state/transport.ts picks the next state, the store takes it, and
// `applyTransportEffects` does what the change means for audio, capture and
// the view. Buttons, hotkeys, the count-in, loop wraps, the AFK timer and the
// playback engine running out all dispatch events rather than setting flags.

/** True while `transport()` applies a change — see the playback engine's
 *  position callback. */
let applyingTransport = false;

function transport(event: TransportEvent): void {
  const prev = store.getState().transport;
  const next = transition(prev, event);
  if (next === prev) return;
  // Commit first: the effects (and anything they trigger) read the new mode.
  store.setTransport(next);
  applyingTransport = true;
  try {
    applyTransportEffects(prev, next, event);
  } finally {
    applyingTransport = false;
  }
}

function applyTransportEffects(prev: TransportState, next: TransportState, event: TransportEvent): void {
  switch (next.mode) {
    case 'stopped':
      endPerformSession(prev);
      return;
    case 'paused':
      playback.pause();
      return;
    case 'countdown':
      ensureResumed();
      composeEngine.startSession(performance.now());
      return;
    case 'playing':
      break;
  }

  if (prev.mode !== 'playing') {
    // Starting to roll: from stopped, paused, or the end of a count-in.
    ensureResumed();
    if (!startRolling(next)) {
      store.setTransport(TRANSPORT_STOPPED);
      endPerformSession(next);
      return;
    }
    composeEngine.startSession(performance.now());
    resetLayerSession();
    if (next.capture === 'pass-recording') showToast('Recording this pass', 1500);
    return;
  }

  // Already rolling: the clock or capture changed. The play-range watch at the
  // end of the file re-opens the range for jams and recordings.
  if (prev.clock !== next.clock) {
    // Jam converts a running playback: a fresh session, so its idle timer
    // starts now and the next pass opens a new layer.
    ensureResumed();
    composeEngine.startSession(performance.now());
    resetLayerSession();
  }
  if (next.capture === 'armed' && prev.capture !== 'armed') {
    ensureResumed();
    composeEngine.startSession(performance.now());
  }
  if (next.capture === 'pass-queued' && prev.capture === 'none') {
    composeEngine.startSession(performance.now());
    showToast('Armed — recording starts at the loop point', 2500);
  }
  if (event.type === 'loop-wrap') {
    if (next.capture === 'pass-recording') showToast('Recording this pass', 1500);
    else if (prev.capture === 'pass-recording') showToast('Pass recorded', 2000);
  }
  if (event.type === 'toggle-pass-record' && next.capture === 'none') {
    // Cancelling a pass commits whatever it already captured, like stopping
    // an ordinary recording.
    if (prev.capture === 'pass-recording') {
      if (composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
      finalizeAllInFlightMidiVoices({ keepPlanchette: true });
    }
    showToast('Pass record cancelled', 2000);
  }
}

/** The engine's play range `[wrapTo, end]` for a rolling transport. Loop on:
 *  the loop markers. Loop off: plain Play ends with the content; jams and every
 *  kind of capture keep scrolling open-ended. */
function playRangeFor(t: TransportState): [number, number] {
  const st = store.getState();
  const c = st.composition;
  if (st.loopEnabled) return [c.loopStartBeats, c.loopEndBeats];
  const openEnded = t.clock === 'jam' || t.capture !== 'none';
  return [0, openEnded ? OPEN_END_BEAT : getCompositionLength(c)];
}

/** Run the engine from `pos` for transport `t` — pulled into the loop when
 *  Loop is on. False if the engine declined (empty or inverted range). */
function playEngineFrom(t: TransportState, pos: number): boolean {
  const st = store.getState();
  const [wrapTo, end] = playRangeFor(t);
  const startBeat = st.loopEnabled && (pos < wrapTo || pos >= end) ? wrapTo : pos;
  playback.play(st.composition, startBeat, end, wrapTo);
  return playback.isPlaying();
}

/**
 * Start the transport for a session that's beginning to roll. Play starts where
 * the user is looking: under the rail in the scrolling view, else at the stored
 * playhead. A loop pass always starts at loop-in so the pass is whole. Returns
 * false if the engine declined.
 */
function startRolling(next: TransportState): boolean {
  if (previewActive) { preview.stopAll(); setPreviewActive(false); }
  const st = store.getState();
  const pos = next.capture === 'pass-recording'
    ? st.composition.loopStartBeats
    : effectiveScrollCanvas() ? railBeat() : st.playback.positionBeats;
  if (!playEngineFrom(next, pos)) {
    if (next.capture === 'pass-recording') showToast('Set a loop range first', 2500);
    return false;
  }
  // Snap the viewport on the first frame of scrolling playback so there's no
  // flash of the old static offset before the render loop takes over.
  if (effectiveScrollCanvas()) {
    const r = canvasContainer.getBoundingClientRect();
    scrollViewportToBeat(viewport, playback.getPositionBeats(), r.width, r.height);
    bgDirty = true;
  }
  return true;
}

/** Tear down whatever session `prev` was running: commit what it captured,
 *  silence it, and stop the transport. */
function endPerformSession(prev: TransportState): void {
  // Seal in-flight phrases before teardown so a gesture interrupted by Stop
  // stays keepable (the buffer survives the session — BACKLOG 10.2).
  closeLmbPhrases();
  if (isCapturing(prev) && composeEngine.isLmbDown()) {
    finalizeComposeRecordedCurves();
  }
  // Finalize any in-flight MIDI voices before tearing down — otherwise their
  // buffers would be discarded by composeEngine.stopSession() below.
  finalizeAllInFlightMidiVoices();
  if (composeEngine.isLmbDown()) {
    stopComposePerformSounding();
  }
  preview.stopDrawPreview('primary');
  playback.stop();
  composeEngine.stopSession();
  // The next session starts from rest, not from wherever the swell was left.
  dynamics.reset();
  resetLayerSession();
  store.setPerformLmbSounding(false);
}

/** R / the Record button. Needs a track to record onto. */
function toggleRecord(): void {
  if (store.getState().selectedTrackId === null) return;
  transport({ type: 'toggle-record', audioNow: getAudioContext().currentTime });
}

/** Shift+R / Shift+click Record: record exactly the next full loop pass
 *  (BACKLOG 10.5) — the structured counterpart to retrospective keep. */
function toggleRecordNextPass(): void {
  const st = store.getState();
  const t = st.transport;
  const cancelling = t.capture === 'pass-queued' || t.capture === 'pass-recording';
  if (!cancelling) {
    if (st.selectedTrackId === null) return;
    if (isRolling(t) && t.capture === 'armed') {
      showToast('Already recording — press R to stop', 2000);
      return;
    }
    // A "pass" is defined by the loop, so turn Loop on rather than refusing —
    // but say so, since it changes the transport out from under the user.
    if (!st.loopEnabled) {
      applyLoopEnabled(true);
      showToast('Record next Pass: Loop On', 2000);
    }
  }
  transport({ type: 'toggle-pass-record' });
}

// ── Canvas input: one router per canvas (BACKLOG 15.2) ─────────
// The router decides once per press who owns the gesture — perform, pan, or
// the edit tools — and pointer capture keeps the whole press with that owner,
// on or off the canvas. See canvas/input-router.ts.

/** Live performance's share of canvas pointer input. */
const performInput = {
  /** Every move, in every mode: the rail planchette and pitch HUD follow the
   *  cursor, and an un-armed jam counts cursor movement as presence for its
   *  idle auto-stop. */
  track(e: PointerEvent) {
    composeUpdatePlanchette(e.clientY - fgCanvas.getBoundingClientRect().top);
    if (isComposePerformActive()) composeEngine.markActivity(performance.now());
  },
  down(e: PointerEvent) {
    composeUpdatePlanchette(e.clientY - fgCanvas.getBoundingClientRect().top);
    composeEngine.onLmbDown(performance.now());
    const planchette = store.getState().performance.planchettes[0];
    if (planchette?.snappedWorldY != null) {
      startComposePerformSounding(planchette.snappedWorldY);
    }
  },
  move() {
    // track() already moved the planchette; retune the sounding voice to it.
    // Moves arrive off-canvas too while the button is held (pointer capture).
    composeEngine.markActivity(performance.now());
    const p = store.getState().performance.planchettes[0];
    if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
  },
  up() {
    // A session that ended while the button was held has already released it.
    if (!composeEngine.isLmbDown()) return;
    composeEngine.onLmbUp();
    // CRITICAL ORDERING: finalize BEFORE stopping synths so the planchette array
    // (and therefore the voiceIds we finalize) still contains every active voice.
    // syncHarmonyPlanchettes only removes harmonies when playback ends or drawMode
    // toggles off, neither of which happens at LMB-up — so the array is stable here.
    // Close first: the phrase must be sealed before either path claims it.
    closeLmbPhrases();
    if (isCapturing(store.getState().transport)) {
      finalizeComposeRecordedCurves();
    }
    // Un-armed perform no longer discards the buffer — the closed phrase stays
    // keepable for KEEP_BUFFER_MS so retrospective capture can commit it
    // after the fact (BACKLOG 10.2). Eviction ages it out.
    stopComposePerformSounding();
  },
  leave() {
    if (composeEngine.isLmbDown()) return;
    store.setPlanchetteY('primary', null, null);
    resetMagnetic(magneticState);
    prevSnapTarget = null;
    lastComposeSy = null;
  },
};

createInputRouter({
  canvas: fgCanvas,
  isPerforming: isComposePerformActive,
  isInRuler: e => e.clientY - fgCanvas.getBoundingClientRect().top < RULER_HEIGHT,
  perform: performInput,
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
// hover, Space-hold preview), so any of it asks for a redraw (15.5). Capture
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
    (['edit.smooth', 'edit.sharpen', 'edit.join', 'edit.group', 'edit.ungroup'] as const).map(item));
});

// ── Shared HUD + countdown DOM updaters ─────────────────────────
function updatePitchHudDom(state: AppState) {
  const planchette = state.performance.planchettes[0];
  const show = state.pitchHudVisible && planchette?.snappedWorldY != null;
  if (show) {
    // Dynamics is shown whenever a live source is driving the bus, held or not,
    // so the player can see where the swell rests before they lean on it.
    const dyn = dynamics.isDriven() ? dynamics.getValue('primary') : null;
    writePitchHud(planchette!.snappedWorldY, planchette!.cursorWorldY, dyn);
    pitchHud.removeAttribute('hidden');
  } else if (!pitchHud.hasAttribute('hidden')) {
    pitchHud.setAttribute('hidden', '');
    writePitchHud(null, null);
  }
}

function updateCountdownOverlayDom(state: AppState) {
  const t = state.transport;
  if (t.mode !== 'countdown') {
    if (!countdownOverlay.hasAttribute('hidden')) {
      countdownOverlay.setAttribute('hidden', '');
      countdownOverlay.textContent = '';
    }
    return;
  }
  const label = composeEngine.getCountdownLabel(
    getAudioContext().currentTime,
    performPhase(t),
    t.countdownStartedAt,
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
  const t = state.transport;
  const armed = isRecordArmed(t) || state.midiArmedTrackId !== null;
  const shouldShow = (armed || isJamming(t)) && isRolling(t) && playback.isPlaying();
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
//   • bgDirty — every viewport change already sets it.
// "Animating" covers the transport rolling or armed, a held perform note, and
// the tail of a pulse or flash.

let fgDirty = true;
/** Ask for a redraw on the next frame. */
function requestRedraw(): void {
  fgDirty = true;
}
effect(() => {
  store.trackAllChannels();
  fgDirty = true;
});
let wasAnimating = false;
/** Frames actually drawn — the observable for "idle doesn't redraw". */
let drawCount = 0;

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
  pushFrameTime(performance.now());
  tickFrame();

  const state = store.getState();
  updatePerfHudDom(state);
  const animating = isAnimating(state);
  // One more frame after an animation ends clears its last faded step.
  if (fgDirty || bgDirty || animating || wasAnimating) {
    fgDirty = false;
    // Compose UI affordances that follow the same state the canvas draws.
    toolPanel.setDisabled(isComposePerformActive());
    updateKeepButtonDom();
    updatePitchHudDom(state);
    updateCountdownOverlayDom(state);
    updateAfkWarningDom(state);
    draw();
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
    bgDirty = true;
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
 *      toolPanel.onToolChange clear) */
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

/** Draw both canvases from current state. Read-only (15.5). */
function draw() {
  drawCount++;
  const state = store.getState();
  const comp = state.composition;
  const rect = canvasContainer.getBoundingClientRect();

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

  // Foreground: curves + playhead + interaction
  fgCtx.clearRect(0, 0, rect.width, rect.height);

  // Transform box (rendered behind curves so unselected curves remain clickable)
  if (interaction.transformBox) {
    renderTransformBox(fgCtx, viewport, interaction.transformBox.bbox, interaction.transformBox.activeHandle);
  }

  // Harmonic Prism — resolve the projection source curve up front. (The store
  // drops a source whose curve is deleted.)
  let prismSource: BezierCurve | null = null;
  if (state.harmonicPrism.projectionSourceId) {
    const prismSrcId = state.harmonicPrism.projectionSourceId;
    for (const track of comp.tracks) {
      const found = track.curves.find(c => c.id === prismSrcId);
      if (found) { prismSource = found; break; }
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
  const geometryVersion = store.compositionVersion();
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
      isActiveTrack ? state.selectedPoints : null,
      geometryVersion,
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
  const isPerformActiveOrPending = state.transport.mode === 'playing'
    || state.transport.mode === 'countdown';
  if (state.activeTool === 'draw'
      && state.harmonicPrism.drawMode
      && interaction.cursorWorld
      && !isPerformActiveOrPending) {
    const snap = currentSnapConfig({ zoomX: viewport.state.zoomX, atBeat: interaction.cursorWorld.x });
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
  if (store.getState().loopEnabled) {
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
  // already sees the rail (rail + planchette dot + pulse).
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
        || isRecordArmed(state.transport)
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
        planchetteDynamicsOf,
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
    // Same snap config the preview tone is tuned with (guides and Prism
    // echoes included), so the dot sits where the pitch you hear is (14.4).
    const snapped = snapToGrid(0, cursorWorld.y, currentSnapConfig({ zoomX: viewport.state.zoomX, atBeat: cursorWorld.x }));
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
    renderParamGraph(
      paramCtx, paramViewport, viewport,
      paramW, paramH,
      // A curve with no volume lane shows the default it sounds with; the graph
      // attaches it on the first edit (param-interaction.ts).
      (selCurve ? displayedLane(selCurve, 'volume') : null) ?? null,
      paramColor,
      paramInteraction.selectedIndex(),
      paramPlayheadBeat,
      pitchStart,
      pitchEnd,
    );
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
    // The transport controller and the per-frame perform tick (count-in, loop
    // wrap, AFK), so transport flows can be driven with the render loop frozen.
    transport, tickComposePerform,
    // Live voice counts — the observable for "removing a track stops its sound".
    getActiveSynthCount, getActiveOscillatorCount,
    // Frames drawn so far (15.5): flat while idle.
    drawCount: () => drawCount, runFrame,
  };
}

// ── Store → UI bindings (BACKLOG 15.1) ──────────────────────────
// Each binding re-runs only when the state it reads changes. This replaces a
// single subscriber that re-synced every control and rebuilt the track list and
// both property panels on every store change, including every drag mousemove.

// Background layer (staff + rulers) depends on tempo, meter and key only;
// viewport and tuning changes mark it dirty where they happen.
watch(
  () => {
    const st = store.getState();
    const c = st.composition;
    return `${c.bpm}|${c.beatsPerMeasure}/${c.timeSignatureDenominator}|${st.scaleRoot}|${st.scaleId}|${st.hidePitchLines}`;
  },
  () => { bgDirty = true; },
);

// Undo / redo / file open replace the composition object outright, so keep the
// scheduler pointed at the live one — otherwise every edit after an undo taken
// mid-playback would be inaudible until the next play().
watch(() => store.getComposition(), comp => {
  if (playback.isPlaying()) playback.setComposition(comp);
});

watch(() => store.getComposition().bpm, updateBpm);
watch(
  () => `${store.getComposition().beatsPerMeasure}/${store.getComposition().timeSignatureDenominator}`,
  ts => { timeSigSelect.value = ts; },
);

// The tool can change from several places (hotkeys, track click, Ctrl-hold in
// interaction.ts), so the panel follows the store (BACKLOG 14.2).
watch(() => store.getState().activeTool, tool => toolPanel.updateTool(tool));

// These read exactly what they show and skip DOM work when it hasn't changed.
const propContentEl = document.getElementById('prop-content')!;
const toolPropContentEl = document.getElementById('tool-prop-content')!;
effect(() => syncCompositionDerived());
render(h(PropertyPanel, null), propContentEl);
render(h(ToolPropertyPanel, null), toolPropContentEl);
effect(() => updateRecordButtonVisuals());

// Play/Pause buttons follow the transport.
watch(() => isRolling(store.getState().transport), updatePlayState);

// Keep the engine's play range in step with the transport, Loop and the loop
// markers, so toggling Loop, dragging a marker, or arming mid-play takes
// effect on the next wrap. Loop on: the markers. Loop off: plain Play ends with
// the content; jams and every kind of capture stay open-ended (14.7) — which
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
  // With Lock Rail on, the rail — not the left edge — is where the next gesture
  // lands, so beat 0 belongs under it (BACKLOG 13.3). Otherwise a fresh
  // composition starts drawing at whatever beat the rail happens to sit over.
  if (store.getState().scrollCanvasEnabled) {
    scrollViewportToBeat(viewport, 0, rect.width, rect.height);
  } else {
    viewport.state.offsetX = 0;
    viewport.clampOffset(rect.width, rect.height);
  }
  updateZoom();
  bgDirty = true;
}


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
