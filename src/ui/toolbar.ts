import type { ToolMode } from '../types';
import type { Viewport } from '../canvas/viewport';
import { MIN_ZOOM_X, MAX_ZOOM_X, MIN_ZOOM_Y, MAX_ZOOM_Y } from '../constants';

export interface ToolbarCallbacks {
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onToolChange(tool: ToolMode): void;
  onSnapToggle(enabled: boolean): void;
  onBpmChange(bpm: number): void;
  onZoomXChange(zoom: number): void;
  onZoomYChange(zoom: number): void;
}

export function createToolbar(
  container: HTMLElement,
  viewport: Viewport,
  callbacks: ToolbarCallbacks,
): { updatePlayState(playing: boolean): void; updateZoom(): void } {
  container.innerHTML = `
    <div class="toolbar-row">
      <div class="toolbar-group transport">
        <button id="btn-play" title="Play (Space)">&#9654;</button>
        <button id="btn-pause" title="Pause" disabled>&#10074;&#10074;</button>
        <button id="btn-stop" title="Stop">&#9632;</button>
      </div>

      <div class="toolbar-group">
        <label>BPM</label>
        <input type="number" id="input-bpm" value="120" min="20" max="300" step="1" />
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
        <label>
          <input type="checkbox" id="snap-toggle" checked />
          Snap
        </label>
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

  // Tool select
  const toolBtns = container.querySelectorAll('.tool-btn');
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
  const snapToggle = container.querySelector('#snap-toggle') as HTMLInputElement;
  snapToggle.addEventListener('change', () => callbacks.onSnapToggle(snapToggle.checked));

  return {
    updatePlayState(playing: boolean) {
      btnPlay.disabled = playing;
      btnPause.disabled = !playing;
    },
    updateZoom() {
      zoomX.value = String(viewport.state.zoomX);
      zoomY.value = String(viewport.state.zoomY);
    },
  };
}
