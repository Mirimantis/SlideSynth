import { store } from '../state/store';

/**
 * Render the tool property panel contents based on the active tool.
 * Holds per-tool variable settings (e.g. Draw preview mode).
 */
export function renderToolPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  switch (state.activeTool) {
    case 'draw':
      renderDrawToolProps(container, state.drawPreviewMode, state.bezierAutoSmooth, state.autoSmoothXRatio);
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
  autoSmoothRatio: number,
) {
  container.innerHTML = `
    <div class="prop-section">
      <div class="prop-label">Draw Preview</div>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="tone" ${mode === 'tone' ? 'checked' : ''}/> Tone only</label>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="composition" ${mode === 'composition' ? 'checked' : ''}/> Composition + tone</label>
    </div>
    <div class="prop-section">
      <label class="prop-radio"><input type="checkbox" id="draw-auto-smooth" ${autoSmooth ? 'checked' : ''}/> Bezier Auto-Smoothing</label>
      <div class="prop-slider-row" title="Handle length as fraction of the neighbor segment's X distance. Shared by Auto-Smoothing and the Smooth Curve action (Shift+S).">
        <label for="auto-smooth-ratio">Handle length</label>
        <input type="range" id="auto-smooth-ratio" class="auto-smooth-ratio-slider" min="0" max="1" step="0.05" value="${autoSmoothRatio}" />
        <span class="auto-smooth-ratio-value">${autoSmoothRatio.toFixed(2)}</span>
      </div>
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

  const ratioSlider = container.querySelector('#auto-smooth-ratio') as HTMLInputElement | null;
  const ratioValue = container.querySelector('.auto-smooth-ratio-value') as HTMLSpanElement | null;
  if (ratioSlider && ratioValue) {
    ratioSlider.addEventListener('input', () => {
      const r = Number(ratioSlider.value);
      store.setAutoSmoothXRatio(r);
      ratioValue.textContent = r.toFixed(2);
    });
  }
}
