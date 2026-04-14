import { createViewport } from './canvas/viewport';
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
import { openToneBuilder } from './ui/tone-builder';
import { openTonePicker } from './ui/tone-picker';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from './export/json-export';
import { midiToComposition } from './export/midi-import';
import { exportWav } from './export/wav-export';
import { store } from './state/store';
import { history } from './state/history';
import { copySelectedCurves, cutSelectedCurves, pasteCurves, duplicateCurves, continueCurves } from './state/clipboard';
import { createTrack } from './model/track';
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
    </div>
    <div id="property-panel">
      <div class="panel-header">Properties</div>
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
  onCursorMove(_worldX, worldY, _screenY) {
    if (previewActive && preview.isDrawPreviewActive()) {
      preview.updateDrawPitch(worldY);
    }
  },
  onCursorLeave() {
    if (previewActive && preview.isDrawPreviewActive()) {
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
    toolbar.updatePlayState(false);
  }
});

// ── Toolbar ─────────────────────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;
const toolbar = createToolbar(toolbarContainer, viewport, {
  onPlay() {
    if (previewActive) { preview.stopAll(); previewActive = false; }
    const state = store.getState();
    playback.play(state.composition, state.playback.positionBeats);
    store.setPlaybackState('playing');
    toolbar.updatePlayState(true);
  },
  onPause() {
    playback.pause();
    store.setPlaybackState('paused');
    toolbar.updatePlayState(false);
  },
  onStop() {
    playback.stop();
    store.setPlaybackState('stopped');
    store.setPlaybackPosition(0);
    toolbar.updatePlayState(false);
  },
  onToolChange(tool: ToolMode) {
    store.setTool(tool);
    if (tool !== 'draw' && interaction.drawingCurve) {
      interaction.drawingCurve = null;
    }
    if (tool !== 'draw' && previewActive && preview.isDrawPreviewActive()) {
      preview.stopAll();
      previewActive = false;
    }
    if (tool === 'scissors') {
      interaction.transformBox = null;
      store.setSelectedCurve(null);
      store.setSelectedPoint(null);
    }
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
  onBpmChange(bpm: number) {
    history.snapshot();
    store.setBpm(bpm);
  },
  onLengthChange(beats: number) {
    history.snapshot();
    store.mutate(c => { c.totalBeats = beats; });
    viewport.totalBeats = beats;
    bgDirty = true;
  },
  onLoopToggle(enabled: boolean) {
    playback.setLoop(enabled);
  },
  onZoomXChange(z: number) {
    viewport.setZoomX(z);
    bgDirty = true;
  },
  onZoomYChange(z: number) {
    viewport.setZoomY(z);
    bgDirty = true;
  },
});

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
toolbarRow.insertBefore(nameGroup, toolbarRow.firstChild);

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

addToolbarButton('Save', 'Save composition (JSON)', () => {
  const comp = store.getComposition();
  const json = serializeComposition(comp);
  downloadFile(json, `${comp.name || 'composition'}.json`);
});

addToolbarButton('Load', 'Load composition (JSON)', async () => {
  try {
    const json = await openFile('.json');
    const comp = deserializeComposition(json);
    history.snapshot();
    playback.stop();
    store.loadComposition(comp);
    viewport.totalBeats = comp.totalBeats;
    toolbar.updateLength(comp.totalBeats);
    toolbar.updatePlayState(false);
    nameInput.value = comp.name || 'Untitled';
  } catch (e) {
    console.error('Failed to load:', e);
  }
});

addToolbarButton('WAV', 'Export as WAV audio file', async () => {
  const comp = store.getComposition();
  try {
    await exportWav(comp);
  } catch (e) {
    console.error('WAV export failed:', e);
  }
});

addToolbarButton('MIDI', 'Import MIDI file', async () => {
  try {
    const buffer = await openBinaryFile('.mid,.midi');
    const comp = midiToComposition(buffer);
    history.snapshot();
    playback.stop();
    store.loadComposition(comp);
    viewport.totalBeats = comp.totalBeats;
    toolbar.updateLength(comp.totalBeats);
    toolbar.updatePlayState(false);
    nameInput.value = comp.name || 'Untitled';
  } catch (e) {
    console.error('MIDI import failed:', e);
  }
});

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

addToolbarButton('Join', 'Join selected curves (Ctrl+J)', performJoin);
addToolbarButton('?', 'User Guide (?)', () => { window.open('/help.html', '_blank'); });
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
        // Start draw preview — play tone at cursor pitch
        const track = state.composition.tracks.find(t => t.id === state.selectedTrackId);
        const tone = track ? state.composition.toneLibrary.find(t => t.id === track.toneId) : null;
        if (tone && interaction.cursorWorld) {
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
          toolbar.updatePlayState(false);
        } else {
          playback.play(state.composition, state.playback.positionBeats);
          store.setPlaybackState('playing');
          toolbar.updatePlayState(true);
        }
      }
      break;
    }
    case 'd':
      store.setTool('draw');
      toolbar.updateTool('draw');
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
  toolbar.updateZoom();
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
    renderStaff(bgCtx, viewport, rect.width, rect.height, comp.totalBeats, comp.beatsPerMeasure, scaleRoot, scale);
    renderRuler(bgCtx, viewport, rect.width, comp.totalBeats, comp.beatsPerMeasure);
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

// ── Store subscription ──────────────────────────────────────────
store.subscribe(() => {
  bgDirty = true;
  const comp = store.getComposition();
  // Sync viewport and toolbar in case composition was loaded, undone, or changed
  viewport.totalBeats = comp.totalBeats;
  toolbar.updateBpm(comp.bpm);
  toolbar.updateLength(comp.totalBeats);
  renderTrackList();
  renderPropertyPanel(document.getElementById('prop-content')!);
});

// ── Initialization ──────────────────────────────────────────────
viewport.totalBeats = store.getComposition().totalBeats;
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
renderTrackList();
renderPropertyPanel(document.getElementById('prop-content')!);
requestAnimationFrame(render);
