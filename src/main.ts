import { createViewport } from './canvas/viewport';
import { renderStaff } from './canvas/staff-renderer';
import { renderCurves, renderDrawPreview } from './canvas/curve-renderer';
import { renderTransformBox } from './canvas/transform-box-renderer';
import { renderPlayhead } from './canvas/playhead';
import { createInteraction } from './canvas/interaction';
import { createToolbar } from './ui/toolbar';
import { createPlaybackEngine } from './audio/playback';
import { renderPropertyPanel } from './ui/property-panel';
import { openToneBuilder } from './ui/tone-builder';
import { openTonePicker } from './ui/tone-picker';
import { serializeComposition, deserializeComposition, downloadFile, openFile, openBinaryFile } from './export/json-export';
import { midiToComposition } from './export/midi-import';
import { exportWav } from './export/wav-export';
import { store } from './state/store';
import { createTrack } from './model/track';
import type { ToolMode } from './types';

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

// ── Interaction ─────────────────────────────────────────────────
const interaction = createInteraction(fgCanvas, viewport);

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
  },
  onSnapToggle(enabled: boolean) {
    store.setSnap(enabled);
  },
  onBpmChange(bpm: number) {
    store.setBpm(bpm);
  },
  onLengthChange(beats: number) {
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

// ── Save / Load / Export buttons (added to toolbar) ─────────────
const toolbarRow = toolbarContainer.querySelector('.toolbar-row')!;

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
    playback.stop();
    store.loadComposition(comp);
    viewport.totalBeats = comp.totalBeats;
    toolbar.updateLength(comp.totalBeats);
    toolbar.updatePlayState(false);
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
    playback.stop();
    store.loadComposition(comp);
    viewport.totalBeats = comp.totalBeats;
    toolbar.updateLength(comp.totalBeats);
    toolbar.updatePlayState(false);
  } catch (e) {
    console.error('MIDI import failed:', e);
  }
});

// ── Keyboard shortcuts ──────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (playback.isPlaying()) {
        playback.pause();
        store.setPlaybackState('paused');
        toolbar.updatePlayState(false);
      } else {
        const state = store.getState();
        playback.play(state.composition, state.playback.positionBeats);
        store.setPlaybackState('playing');
        toolbar.updatePlayState(true);
      }
      break;
    case 'd':
      store.setTool('draw');
      break;
    case 'v':
      store.setTool('select');
      break;
    case 'x':
      store.setTool('delete');
      break;
    case 'l':
    case 'L': {
      const loopCb = document.getElementById('loop-toggle') as HTMLInputElement | null;
      if (loopCb) {
        loopCb.checked = !loopCb.checked;
        playback.setLoop(loopCb.checked);
      }
      break;
    }
    case 'Delete':
    case 'Backspace': {
      // Delete selected point
      const s = store.getState();
      if (s.selectedCurveId && s.selectedPointIndex !== null) {
        const track = s.composition.tracks.find(t => t.id === s.selectedTrackId);
        const curve = track?.curves.find(c => c.id === s.selectedCurveId);
        if (curve) {
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
        store.mutate(() => { track.muted = !track.muted; });
        return;
      }
      if (target.classList.contains('track-solo')) {
        store.mutate(() => { track.solo = !track.solo; });
        return;
      }
      if (target.classList.contains('track-edit-tone')) {
        const currentTone = comp.toneLibrary.find(t => t.id === track.toneId);
        if (currentTone) {
          openToneBuilder(currentTone).then(result => {
            if (result.action === 'save') {
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
            store.mutate(() => { track.toneId = picked.id; });
          }
        });
        return;
      }
      store.setSelectedTrack(track.id);
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
  const track = createTrack(`Track ${comp.tracks.length + 1}`, picked.id);
  store.mutate(c => { c.tracks.push(track); });
  store.setSelectedTrack(track.id);
});

document.getElementById('new-tone-btn')!.addEventListener('click', async () => {
  const result = await openToneBuilder();
  if (result.action === 'save') {
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
    renderStaff(bgCtx, viewport, rect.width, rect.height, comp.totalBeats, comp.beatsPerMeasure);
    bgDirty = false;
  }

  // Foreground: curves + playhead + interaction
  const rect = canvasContainer.getBoundingClientRect();
  fgCtx.clearRect(0, 0, rect.width, rect.height);

  // Render curves for all tracks
  for (const track of comp.tracks) {
    if (track.muted) continue;
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    if (!tone) continue;

    const isActiveTrack = track.id === state.selectedTrackId;
    renderCurves(
      fgCtx, viewport, track.curves, tone,
      isActiveTrack ? state.selectedCurveId : null,
      isActiveTrack ? state.selectedPointIndex : null,
    );
  }

  // Transform box
  if (interaction.transformBox) {
    renderTransformBox(fgCtx, viewport, interaction.transformBox.bbox, interaction.transformBox.activeHandle);
  }

  // Draw preview line when in draw mode (hidden during Ctrl-select)
  if (state.activeTool === 'draw' && interaction.cursorWorld) {
    // Use the drawing curve, or the selected curve if not actively drawing
    const previewCurve = interaction.drawingCurve
      ?? (state.selectedCurveId
        ? comp.tracks.find(t => t.id === state.selectedTrackId)
            ?.curves.find(c => c.id === state.selectedCurveId)
        : null);
    const points = previewCurve?.points;
    if (points && points.length > 0) {
      const track = comp.tracks.find(t => t.id === state.selectedTrackId);
      const tone = track ? comp.toneLibrary.find(t => t.id === track.toneId) : null;
      const color = tone?.color ?? '#4fc3f7';
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
    }
  }

  // Playhead
  if (playback.isPlaying()) {
    renderPlayhead(fgCtx, viewport, playback.getPositionBeats(), rect.height);
  } else if (state.playback.positionBeats > 0) {
    renderPlayhead(fgCtx, viewport, state.playback.positionBeats, rect.height);
  }

  requestAnimationFrame(render);
}

// ── Store subscription ──────────────────────────────────────────
store.subscribe(() => {
  bgDirty = true;
  // Sync viewport totalBeats in case composition was loaded or length changed
  viewport.totalBeats = store.getComposition().totalBeats;
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
