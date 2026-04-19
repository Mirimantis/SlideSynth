import { store } from '../state/store';

/**
 * Render the tool property panel contents based on the active tool.
 * Holds per-tool variable settings (e.g. Draw preview mode).
 */
export function renderToolPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  switch (state.activeTool) {
    case 'draw':
      renderDrawToolProps(container, state.drawPreviewMode, state.bezierAutoSmooth);
      return;
    default:
      container.innerHTML = '<p class="placeholder-text">No settings for this tool</p>';
      return;
  }
}

function renderDrawToolProps(
  container: HTMLElement,
  mode: 'tone' | 'composition',
  autoSmooth: boolean,
) {
  container.innerHTML = `
    <div class="prop-section">
      <div class="prop-label">Draw Preview</div>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="tone" ${mode === 'tone' ? 'checked' : ''}/> Tone only</label>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="composition" ${mode === 'composition' ? 'checked' : ''}/> Composition + tone</label>
    </div>
    <div class="prop-section">
      <label class="prop-radio"><input type="checkbox" id="draw-auto-smooth" ${autoSmooth ? 'checked' : ''}/> Bezier Auto-Smoothing</label>
    </div>
  `;

  container.querySelectorAll('input[name="draw-preview-mode"]').forEach(el => {
    el.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value as 'tone' | 'composition';
      store.setDrawPreviewMode(v);
    });
  });

  container.querySelector('#draw-auto-smooth')?.addEventListener('change', (e) => {
    store.setBezierAutoSmooth((e.target as HTMLInputElement).checked);
  });
}
