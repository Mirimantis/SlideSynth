import '@preact/signals'; // components re-render when the store fields they read change
import { store } from '../state/store';
import { primaryShortcut } from '../commands/catalog';
import { DYNAMICS_SOURCES, type DynamicsSource } from '../types';

/**
 * Tool Properties (BACKLOG 15.4): per-tool settings for the active tool. A
 * Preact component, so the handle-length slider can be dragged while the panel
 * re-renders around it.
 */
export function ToolPropertyPanel() {
  const st = store.getState();
  if (st.performMode) return <PerformSettings source={st.dynamicsSource} />;
  if (st.activeTool !== 'draw') return <p class="placeholder-text">No settings for this tool</p>;

  const mode = st.drawPreviewMode;
  const ratio = st.autoSmoothXRatio;
  return (
    <>
      <div class="prop-section">
        <div class="prop-label">Draw Preview</div>
        <label class="prop-radio">
          <input type="radio" name="draw-preview-mode" value="tone" checked={mode === 'tone'}
            onChange={() => store.setDrawPreviewMode('tone')} /> Tone only
        </label>
        <label class="prop-radio">
          <input type="radio" name="draw-preview-mode" value="composition" checked={mode === 'composition'}
            onChange={() => store.setDrawPreviewMode('composition')} /> Composition + tone
        </label>
      </div>
      <div class="prop-section">
        <label class="prop-radio">
          <input type="checkbox" id="draw-auto-smooth" checked={st.bezierAutoSmooth}
            onChange={e => store.setBezierAutoSmooth((e.currentTarget as HTMLInputElement).checked)} /> Bezier Auto-Smoothing
        </label>
        <div
          class="prop-slider-row"
          title={`Handle length as fraction of the neighbor segment's X distance. Shared by Auto-Smoothing and the Smooth Curve action (${primaryShortcut('edit.smooth')}).`}
        >
          <label for="auto-smooth-ratio">Handle length</label>
          <input
            type="range"
            id="auto-smooth-ratio"
            class="auto-smooth-ratio-slider"
            min="0"
            max="1"
            step="0.05"
            value={ratio}
            onInput={e => store.setAutoSmoothXRatio(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="auto-smooth-ratio-value">{ratio.toFixed(2)}</span>
        </div>
      </div>
    </>
  );
}

/** Perform's settings (BACKLOG 16.3, moved from the old Transport drawer):
 *  what sets the volume of what you play. The Perform session (16.8) gives it
 *  a clearer name. */
function PerformSettings({ source }: { source: DynamicsSource }) {
  return (
    <div class="prop-section">
      <div class="prop-label">Dynamics</div>
      <select
        id="perform-dynamics-source"
        title="What sets the volume of what you perform"
        value={source}
        onChange={e => {
          const value = (e.currentTarget as HTMLSelectElement).value as DynamicsSource;
          if (DYNAMICS_SOURCES.includes(value)) store.setDynamicsSource(value);
        }}
      >
        <option value="fixed">Fixed</option>
        <option value="key-swell">Key swell (hold F)</option>
      </select>
    </div>
  );
}
