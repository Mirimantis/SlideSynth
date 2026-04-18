import { createViewport } from './canvas/viewport';
import { MIN_CANVAS_EXTENT, MAX_CANVAS_EXTENT, SCROLL_BUFFER, MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y } from './constants';
import { renderStaff } from './canvas/staff-renderer';
import { renderCurves, renderDrawPreview } from './canvas/curve-renderer';
import { renderTransformBox } from './canvas/transform-box-renderer';
import { renderPlayhead } from './canvas/playhead';
import { createInteraction, rebuildTransformBox, RULER_HEIGHT } from './canvas/interaction';
import { createPreviewManager } from './audio/preview';
import { renderRuler } from './canvas/ruler-renderer';
import { createToolbar } from './ui/toolbar';
import { createPlaybackEngine } from './audio/playback';
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
import { getScaleById } from './utils/scales';
import type { ToolMode, ControlPoint } from './types';

// ── Viewport ────────────────────────────────────────────────────
const viewport = createViewport();

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
          <label class="toolbar-loop-label" title="Loop playback (L)">
            <input type="checkbox" id="loop-toggle" />
            <span>Loop</span>
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

  bgDirty = true;
}

// ── Audio preview ──────────────────────────────────────────────
const preview = createPreviewManager();
let previewActive = false;

// ── Interaction ─────────────────────────────────────────────────
let scrubWasPlaying = false;
const interaction = createInteraction(fgCanvas, viewport, {
  onPlayheadScrub(beats, phase) {
    if (phase === 'start') {
      scrubWasPlaying = playback.isPlaying();
      if (scrubWasPlaying) {
        playback.pause();
      }
      store.setPlaybackPosition(beats);
    } else if (phase === 'move') {
      store.setPlaybackPosition(beats);
      if (previewActive && preview.isScrubPreviewActive()) {
        preview.updateScrubPosition(beats, store.getComposition());
      }
    } else {
      store.setPlaybackPosition(beats);
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
    }
  },
  onCursorLeave() {
    if (previewActive && store.getState().activeTool === 'draw') {
      preview.stopAll();
      previewActive = false;
    }
  },
});

// ── Playback engine ─────────────────────────────────────────────
const playback = createPlaybackEngine((beats) => {
  store.setPlaybackPosition(beats);
  // Detect when playback auto-stopped (reached end without loop)
  if (!playback.isPlaying() && store.getState().playback.state === 'playing') {
    store.setPlaybackState('stopped');
    updatePlayState(false);
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
const bpmInput = document.getElementById('input-bpm') as HTMLInputElement;
const loopToggle = document.getElementById('loop-toggle') as HTMLInputElement;

function updatePlayState(playing: boolean) {
  btnPlay.disabled = playing;
  btnPause.disabled = !playing;
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

btnPlay.addEventListener('click', () => {
  if (previewActive) { preview.stopAll(); previewActive = false; }
  const state = store.getState();
  playback.play(state.composition, state.playback.positionBeats);
  if (!playback.isPlaying()) return; // empty composition — nothing to play
  store.setPlaybackState('playing');
  updatePlayState(true);
});

btnPause.addEventListener('click', () => {
  playback.pause();
  store.setPlaybackState('paused');
  updatePlayState(false);
});

btnStop.addEventListener('click', () => {
  playback.stop();
  store.setPlaybackState('stopped');
  store.setPlaybackPosition(0);
  updatePlayState(false);
});

bpmInput.addEventListener('change', () => {
  const bpm = Math.max(20, Math.min(300, Number(bpmInput.value)));
  bpmInput.value = String(bpm);
  history.snapshot();
  store.setBpm(bpm);
});

loopToggle.addEventListener('change', () => playback.setLoop(loopToggle.checked));

// ── Zoom controls (on canvas) ──────────────────────────────────
const zoomX = document.getElementById('zoom-x') as HTMLInputElement;
const zoomY = document.getElementById('zoom-y') as HTMLInputElement;

zoomX.addEventListener('input', () => { viewport.setZoomX(Number(zoomX.value)); bgDirty = true; });
zoomY.addEventListener('input', () => { viewport.setZoomY(Number(zoomY.value)); bgDirty = true; });

function updateZoom() {
  zoomX.value = String(viewport.state.zoomX);
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
      if (e.repeat) break; // prevent rapid toggling when holding space

      const state = store.getState();
      const inDrawContext = state.activeTool === 'draw'
        && interaction.cursorInCanvas
        && interaction.cursorScreenY >= RULER_HEIGHT
        && interaction.cursorWorld !== null;
      const inScrubContext = interaction.scrubbing;

      if (inDrawContext) {
        const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
        const tone = track ? state.composition.toneLibrary.find(t => t.id === track.toneId) : null;
        if (state.drawPreviewMode === 'composition' && interaction.cursorWorld) {
          // Preview what the composition would sound like if a point were placed here:
          // play all existing curves at cursor X, plus the cursor tone at cursor Y.
          preview.startScrubPreview(state.composition);
          preview.updateScrubPosition(interaction.cursorWorld.x, state.composition);
          if (tone) {
            preview.startDrawPreview(tone, interaction.cursorWorld.y);
          }
          previewActive = true;
        } else if (tone && interaction.cursorWorld) {
          // Tone-only preview — play the track's tone at cursor pitch.
          preview.startDrawPreview(tone, interaction.cursorWorld.y);
          previewActive = true;
        }
      } else if (inScrubContext) {
        // Start scrub preview — play all curves at scrub position
        preview.startScrubPreview(state.composition);
        preview.updateScrubPosition(state.playback.positionBeats, state.composition);
        previewActive = true;
      } else {
        // Normal play/pause toggle
        if (playback.isPlaying()) {
          playback.pause();
          store.setPlaybackState('paused');
          updatePlayState(false);
        } else {
          playback.play(state.composition, state.playback.positionBeats);
          if (playback.isPlaying()) {
            store.setPlaybackState('playing');
            updatePlayState(true);
          }
        }
      }
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
  if (e.key === ' ' && previewActive) {
    preview.stopAll();
    previewActive = false;
  }
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
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    viewport.panBy(dx, dy);
    const rect = canvasContainer.getBoundingClientRect();
    viewport.clampOffset(rect.width, rect.height);
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

  if (e.ctrlKey) {
    viewport.zoomYAt(factor, sy);
  } else {
    viewport.zoomXAt(factor, sx);
  }

  const rect2 = canvasContainer.getBoundingClientRect();
  viewport.clampOffset(rect2.width, rect2.height);
  updateZoom();
  bgDirty = true;
}, { passive: false });

// ── Render loop ─────────────────────────────────────────────────
function render() {
  const state = store.getState();
  const comp = state.composition;

  // Background: staff grid
  if (bgDirty) {
    const rect = canvasContainer.getBoundingClientRect();
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
  const rect = canvasContainer.getBoundingClientRect();
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

  // Playhead
  const playheadBeat = playback.isPlaying()
    ? playback.getPositionBeats()
    : state.playback.positionBeats;
  renderPlayhead(fgCtx, viewport, playheadBeat, rect.height);

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
});

// ── Initialization ──────────────────────────────────────────────
syncCompositionDerived();
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
renderTrackList();
renderPropertyPanel(document.getElementById('prop-content')!);
renderToolPropertyPanel(document.getElementById('tool-prop-content')!);
requestAnimationFrame(render);
