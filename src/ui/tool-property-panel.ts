import { store } from '../state/store';
import { setHtmlIfChanged } from '../utils/dom-helpers';

/**
 * Render the tool property panel contents based on the active tool.
 * Holds per-tool variable settings (e.g. Draw preview mode).
 *
 * Runs from an effect (BACKLOG 15.1): the DOM is replaced only when the panel's
 * shape changes, and the handle-length slider is synced in place so dragging it
 * never rebuilds the panel under the pointer.
 */
export function renderToolPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  switch (state.activeTool) {
    case 'draw':
      renderDrawToolProps(container, state.drawPreviewMode, state.bezierAutoSmooth, state.autoSmoothXRatio);
      return;
    default:
      setHtmlIfChanged(container, '<p class="placeholder-text">No settings for this tool</p>');
      return;
  }
}

function renderDrawToolProps(
  container: HTMLElement,
  mode: 'tone' | 'composition',
  autoSmooth: boolean,
  autoSmoothRatio: number,
) {
  const replaced = setHtmlIfChanged(container, `
    <div class="prop-section">
      <div class="prop-label">Draw Preview</div>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="tone" ${mode === 'tone' ? 'checked' : ''}/> Tone only</label>
      <label class="prop-radio"><input type="radio" name="draw-preview-mode" value="composition" ${mode === 'composition' ? 'checked' : ''}/> Composition + tone</label>
    </div>
    <div class="prop-section">
      <label class="prop-radio"><input type="checkbox" id="draw-auto-smooth" ${autoSmooth ? 'checked' : ''}/> Bezier Auto-Smoothing</label>
      <div class="prop-slider-row" title="Handle length as fraction of the neighbor segment's X distance. Shared by Auto-Smoothing and the Smooth Curve action (Shift+S).">
        <label for="auto-smooth-ratio">Handle length</label>
        <input type="range" id="auto-smooth-ratio" class="auto-smooth-ratio-slider" min="0" max="1" step="0.05" />
        <span class="auto-smooth-ratio-value"></span>
      </div>
    </div>
  `);

  const ratioSlider = container.querySelector('#auto-smooth-ratio') as HTMLInputElement;
  const ratioValue = container.querySelector('.auto-smooth-ratio-value') as HTMLSpanElement;

  if (replaced) {
    container.querySelectorAll('input[name="draw-preview-mode"]').forEach(el => {
      el.addEventListener('change', (e) => {
        const v = (e.target as HTMLInputElement).value as 'tone' | 'composition';
        store.setDrawPreviewMode(v);
      });
    });

    container.querySelector('#draw-auto-smooth')?.addEventListener('change', (e) => {
      store.setBezierAutoSmooth((e.target as HTMLInputElement).checked);
    });

    ratioSlider.addEventListener('input', () => {
      store.setAutoSmoothXRatio(Number(ratioSlider.value));
    });
  }

  if (Number(ratioSlider.value) !== autoSmoothRatio) ratioSlider.value = String(autoSmoothRatio);
  const ratioLabel = autoSmoothRatio.toFixed(2);
  if (ratioValue.textContent !== ratioLabel) ratioValue.textContent = ratioLabel;
}
