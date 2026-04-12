import type { ToolMode } from '../types';
import type { Viewport } from '../canvas/viewport';
import { MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y, MIN_TOTAL_BEATS, MAX_TOTAL_BEATS } from '../constants';
import { SCALE_CATALOG, getScaleGroups } from '../utils/scales';

export interface ToolbarCallbacks {
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onToolChange(tool: ToolMode): void;
  onSnapToggle(enabled: boolean): void;
  onScaleRootChange(root: number | null): void;
  onScaleIdChange(scaleId: string | null): void;
  onBpmChange(bpm: number): void;
  onLengthChange(beats: number): void;
  onLoopToggle(enabled: boolean): void;
  onZoomXChange(zoom: number): void;
  onZoomYChange(zoom: number): void;
}

export function createToolbar(
  container: HTMLElement,
  viewport: Viewport,
  callbacks: ToolbarCallbacks,
): {
  updatePlayState(playing: boolean): void;
  updateZoom(): void;
  updateLength(beats: number): void;
  updateBpm(bpm: number): void;
  updateSnap(enabled: boolean): void;
  updateScaleRoot(root: number | null): void;
  updateScaleId(scaleId: string | null): void;
} {
  // Build scale type <optgroup> options
  const groups = getScaleGroups();
  let scaleOptionsHtml = '';
  for (const group of groups) {
    scaleOptionsHtml += `<optgroup label="${group}">`;
    for (const s of SCALE_CATALOG.filter(sc => sc.group === group)) {
      scaleOptionsHtml += `<option value="${s.id}">${s.name}</option>`;
    }
    scaleOptionsHtml += '</optgroup>';
  }

  container.innerHTML = `
    <div class="toolbar-row">
      <div class="toolbar-group transport">
        <button id="btn-play" title="Play (Space)">&#9654;</button>
        <button id="btn-pause" title="Pause" disabled>&#10074;&#10074;</button>
        <button id="btn-stop" title="Stop">&#9632;</button>
        <label class="toolbar-loop-label" title="Loop playback (L)">
          <input type="checkbox" id="loop-toggle" />
          <span>Loop</span>
        </label>
      </div>

      <div class="toolbar-group">
        <label>BPM</label>
        <input type="number" id="input-bpm" value="120" min="20" max="300" step="1" />
      </div>

      <div class="toolbar-group">
        <label>Length</label>
        <input type="number" id="input-length" value="${viewport.totalBeats}" min="${MIN_TOTAL_BEATS}" max="${MAX_TOTAL_BEATS}" step="1" title="Composition length in beats" />
        <span id="length-time" class="toolbar-time-display"></span>
      </div>

      <div class="toolbar-group tools">
        <button id="tool-draw" class="tool-btn active" data-tool="draw" title="Draw (D)">Draw</button>
        <button id="tool-select" class="tool-btn" data-tool="select" title="Select (V)">Select</button>
        <button id="tool-delete" class="tool-btn" data-tool="delete" title="Delete (X)">Delete</button>
      </div>

      <div class="toolbar-group">
        <label>Zoom X</label>
        <input type="range" id="zoom-x" min="${MIN_ZOOM_X}" max="${MAX_ZOOM_X}" value="${viewport.state.zoomX}" step="1" />
      </div>

      <div class="toolbar-group">
        <label>Zoom Y</label>
        <input type="range" id="zoom-y" min="${MIN_ZOOM_Y}" max="${MAX_ZOOM_Y}" value="${viewport.state.zoomY}" step="1" />
      </div>

      <div class="toolbar-group">
        <button id="snap-toggle" class="tool-btn active" title="Toggle snap (S)">Snap</button>
      </div>

      <div class="toolbar-group scale">
        <label>Key</label>
        <select id="scale-root">
          <option value="none">None</option>
          <option value="0">C</option>
          <option value="1">C#</option>
          <option value="2">D</option>
          <option value="3">D#</option>
          <option value="4">E</option>
          <option value="5">F</option>
          <option value="6">F#</option>
          <option value="7">G</option>
          <option value="8">G#</option>
          <option value="9">A</option>
          <option value="10">A#</option>
          <option value="11">B</option>
        </select>
        <select id="scale-type" disabled>
          ${scaleOptionsHtml}
        </select>
      </div>
    </div>
  `;

  // Transport
  const btnPlay = container.querySelector('#btn-play') as HTMLButtonElement;
  const btnPause = container.querySelector('#btn-pause') as HTMLButtonElement;
  const btnStop = container.querySelector('#btn-stop') as HTMLButtonElement;

  btnPlay.addEventListener('click', () => callbacks.onPlay());
  btnPause.addEventListener('click', () => callbacks.onPause());
  btnStop.addEventListener('click', () => callbacks.onStop());

  // BPM
  const bpmInput = container.querySelector('#input-bpm') as HTMLInputElement;
  bpmInput.addEventListener('change', () => {
    const bpm = Math.max(20, Math.min(300, Number(bpmInput.value)));
    bpmInput.value = String(bpm);
    callbacks.onBpmChange(bpm);
  });

  // Tool select — only buttons with data-tool, not snap toggle
  const toolBtns = container.querySelectorAll('.tool-btn[data-tool]');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callbacks.onToolChange(btn.getAttribute('data-tool') as ToolMode);
    });
  });

  // Zoom sliders
  const zoomX = container.querySelector('#zoom-x') as HTMLInputElement;
  const zoomY = container.querySelector('#zoom-y') as HTMLInputElement;

  zoomX.addEventListener('input', () => callbacks.onZoomXChange(Number(zoomX.value)));
  zoomY.addEventListener('input', () => callbacks.onZoomYChange(Number(zoomY.value)));

  // Snap toggle
  const snapToggle = container.querySelector('#snap-toggle') as HTMLButtonElement;
  let snapOn = true;
  snapToggle.addEventListener('click', () => {
    snapOn = !snapOn;
    snapToggle.classList.toggle('active', snapOn);
    callbacks.onSnapToggle(snapOn);
  });

  // Scale root / type
  const scaleRootSelect = container.querySelector('#scale-root') as HTMLSelectElement;
  const scaleTypeSelect = container.querySelector('#scale-type') as HTMLSelectElement;

  scaleRootSelect.addEventListener('change', () => {
    const val = scaleRootSelect.value;
    if (val === 'none') {
      scaleTypeSelect.disabled = true;
      callbacks.onScaleRootChange(null);
    } else {
      scaleTypeSelect.disabled = false;
      callbacks.onScaleRootChange(Number(val));
      callbacks.onScaleIdChange(scaleTypeSelect.value);
    }
  });

  scaleTypeSelect.addEventListener('change', () => {
    callbacks.onScaleIdChange(scaleTypeSelect.value);
  });

  // Length
  const lengthInput = container.querySelector('#input-length') as HTMLInputElement;
  const lengthTimeSpan = container.querySelector('#length-time') as HTMLElement;

  function updateLengthDisplay() {
    const beats = Number(lengthInput.value);
    const bpm = Number(bpmInput.value) || 120;
    const seconds = beats * 60 / bpm;
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    lengthTimeSpan.textContent = `${min}:${String(sec).padStart(2, '0')}`;
  }

  lengthInput.addEventListener('change', () => {
    const beats = Math.max(MIN_TOTAL_BEATS, Math.min(MAX_TOTAL_BEATS, Math.round(Number(lengthInput.value))));
    lengthInput.value = String(beats);
    updateLengthDisplay();
    callbacks.onLengthChange(beats);
  });

  // Update time display when BPM changes too
  bpmInput.addEventListener('change', updateLengthDisplay);
  updateLengthDisplay();

  // Loop toggle
  const loopToggle = container.querySelector('#loop-toggle') as HTMLInputElement;
  loopToggle.addEventListener('change', () => callbacks.onLoopToggle(loopToggle.checked));

  return {
    updatePlayState(playing: boolean) {
      btnPlay.disabled = playing;
      btnPause.disabled = !playing;
    },
    updateZoom() {
      zoomX.value = String(viewport.state.zoomX);
      zoomY.value = String(viewport.state.zoomY);
    },
    updateLength(beats: number) {
      lengthInput.value = String(beats);
      updateLengthDisplay();
    },
    updateBpm(bpm: number) {
      bpmInput.value = String(bpm);
      updateLengthDisplay();
    },
    updateSnap(enabled: boolean) {
      snapOn = enabled;
      snapToggle.classList.toggle('active', enabled);
    },
    updateScaleRoot(root: number | null) {
      scaleRootSelect.value = root === null ? 'none' : String(root);
      scaleTypeSelect.disabled = root === null;
    },
    updateScaleId(scaleId: string | null) {
      if (scaleId) scaleTypeSelect.value = scaleId;
    },
  };
}
