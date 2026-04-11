import type { ToneDefinition, OscillatorShape, OversampleAmount } from '../types';
import { generateId } from '../model/tone';
import { ensureResumed, getMasterGain } from '../audio/engine';
import { createToneSynth, type ToneSynth } from '../audio/tone-synth';
import { noteToFrequency } from '../constants';

const DASH_PRESETS: { label: string; pattern: number[] }[] = [
  { label: 'Solid', pattern: [] },
  { label: 'Dashed', pattern: [12, 4] },
  { label: 'Dotted', pattern: [3, 3] },
  { label: 'Dash-Dot', pattern: [10, 4, 3, 4] },
  { label: 'Long Dash', pattern: [20, 6] },
];

interface ToneBuilderResult {
  tone: ToneDefinition;
  action: 'save' | 'cancel';
}

/**
 * Open the tone builder modal. Returns a promise that resolves when the user saves or cancels.
 */
export function openToneBuilder(
  existing?: ToneDefinition,
): Promise<ToneBuilderResult> {
  return new Promise((resolve) => {
    // Build working copy
    const tone: ToneDefinition = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: generateId('tone'),
          name: 'New Tone',
          color: '#4fc3f7',
          dashPattern: [],
          layers: [{ type: 'sine' as OscillatorShape, gain: 1.0, detune: 0 }],
          distortion: null,
        };

    let previewSynth: ToneSynth | null = null;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal tone-builder-modal';

    function renderModal() {
      modal.innerHTML = `
        <h2>${existing ? 'Edit Tone' : 'New Tone'}</h2>

        <div class="tb-row">
          <label>Name</label>
          <input type="text" id="tb-name" value="${tone.name}" />
        </div>

        <div class="tb-row">
          <label>Color</label>
          <input type="color" id="tb-color" value="${tone.color}" />
          <div class="tb-color-preview" style="background:${tone.color}; width:40px; height:24px; border-radius:4px;"></div>
        </div>

        <div class="tb-row">
          <label>Line Style</label>
          <select id="tb-dash">
            ${DASH_PRESETS.map((d, i) =>
              `<option value="${i}" ${JSON.stringify(d.pattern) === JSON.stringify(tone.dashPattern) ? 'selected' : ''}>${d.label}</option>`
            ).join('')}
          </select>
          <canvas id="tb-dash-preview" width="80" height="16"></canvas>
        </div>

        <div class="tb-section">
          <div class="tb-section-header">
            <span>Waveform Layers</span>
            <button id="tb-add-layer" class="tb-small-btn">+ Add</button>
          </div>
          <div id="tb-layers">
            ${tone.layers.map((layer, i) => `
              <div class="tb-layer" data-index="${i}">
                <select class="tb-layer-type" data-index="${i}">
                  ${(['sine', 'square', 'sawtooth', 'triangle'] as const).map(t =>
                    `<option value="${t}" ${layer.type === t ? 'selected' : ''}>${t}</option>`
                  ).join('')}
                </select>
                <label>Vol</label>
                <input type="range" class="tb-layer-gain" data-index="${i}" min="0" max="1" step="0.05" value="${layer.gain}" />
                <span class="tb-layer-gain-val">${layer.gain.toFixed(2)}</span>
                <label>Detune</label>
                <input type="number" class="tb-layer-detune" data-index="${i}" min="-1200" max="1200" step="1" value="${layer.detune}" />
                <span>ct</span>
                ${tone.layers.length > 1 ? `<button class="tb-remove-layer tb-small-btn" data-index="${i}">X</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="tb-section">
          <div class="tb-section-header">
            <span>Distortion</span>
            <label class="tb-toggle">
              <input type="checkbox" id="tb-dist-enabled" ${tone.distortion ? 'checked' : ''} />
              Enable
            </label>
          </div>
          <div id="tb-dist-controls" style="${tone.distortion ? '' : 'display:none'}">
            <div class="tb-row">
              <label>Amount</label>
              <input type="range" id="tb-dist-amount" min="0" max="1" step="0.01" value="${tone.distortion?.amount ?? 0.3}" />
              <span id="tb-dist-amount-val">${(tone.distortion?.amount ?? 0.3).toFixed(2)}</span>
            </div>
            <div class="tb-row">
              <label>Oversample</label>
              <select id="tb-dist-oversample">
                ${(['none', '2x', '4x'] as const).map(v =>
                  `<option value="${v}" ${(tone.distortion?.oversample ?? '4x') === v ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="tb-actions">
          <button id="tb-preview" class="tb-btn">Preview</button>
          <button id="tb-stop-preview" class="tb-btn" disabled>Stop</button>
          <div style="flex:1"></div>
          <button id="tb-cancel" class="tb-btn">Cancel</button>
          <button id="tb-save" class="tb-btn primary">Save</button>
        </div>
      `;

      // Draw dash preview
      requestAnimationFrame(() => {
        const dashCanvas = modal.querySelector('#tb-dash-preview') as HTMLCanvasElement | null;
        if (dashCanvas) {
          const ctx = dashCanvas.getContext('2d')!;
          ctx.clearRect(0, 0, 80, 16);
          ctx.strokeStyle = tone.color;
          ctx.lineWidth = 2;
          ctx.setLineDash(tone.dashPattern);
          ctx.beginPath();
          ctx.moveTo(0, 8);
          ctx.lineTo(80, 8);
          ctx.stroke();
        }
      });

      wireEvents();
    }

    function wireEvents() {
      // Name
      modal.querySelector('#tb-name')!.addEventListener('input', (e) => {
        tone.name = (e.target as HTMLInputElement).value;
      });

      // Color
      modal.querySelector('#tb-color')!.addEventListener('input', (e) => {
        tone.color = (e.target as HTMLInputElement).value;
        renderModal();
      });

      // Dash
      modal.querySelector('#tb-dash')!.addEventListener('change', (e) => {
        const idx = Number((e.target as HTMLSelectElement).value);
        tone.dashPattern = [...(DASH_PRESETS[idx]?.pattern ?? [])];
        renderModal();
      });

      // Layer controls
      modal.querySelectorAll('.tb-layer-type').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const i = Number((e.target as HTMLElement).dataset['index']);
          const layer = tone.layers[i];
          if (layer) layer.type = (e.target as HTMLSelectElement).value as OscillatorShape;
        });
      });

      modal.querySelectorAll('.tb-layer-gain').forEach(input => {
        input.addEventListener('input', (e) => {
          const i = Number((e.target as HTMLElement).dataset['index']);
          const layer = tone.layers[i];
          if (layer) layer.gain = Number((e.target as HTMLInputElement).value);
          const valSpan = (e.target as HTMLElement).nextElementSibling as HTMLElement;
          if (valSpan) valSpan.textContent = layer?.gain.toFixed(2) ?? '';
        });
      });

      modal.querySelectorAll('.tb-layer-detune').forEach(input => {
        input.addEventListener('change', (e) => {
          const i = Number((e.target as HTMLElement).dataset['index']);
          const layer = tone.layers[i];
          if (layer) layer.detune = Number((e.target as HTMLInputElement).value);
        });
      });

      modal.querySelectorAll('.tb-remove-layer').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const i = Number((e.target as HTMLElement).dataset['index']);
          tone.layers.splice(i, 1);
          renderModal();
        });
      });

      modal.querySelector('#tb-add-layer')?.addEventListener('click', () => {
        tone.layers.push({ type: 'sine', gain: 0.5, detune: 0 });
        renderModal();
      });

      // Distortion
      modal.querySelector('#tb-dist-enabled')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
          tone.distortion = { amount: 0.3, oversample: '4x' };
        } else {
          tone.distortion = null;
        }
        renderModal();
      });

      const distAmount = modal.querySelector('#tb-dist-amount') as HTMLInputElement | null;
      distAmount?.addEventListener('input', () => {
        if (tone.distortion) {
          tone.distortion.amount = Number(distAmount.value);
          const valSpan = modal.querySelector('#tb-dist-amount-val');
          if (valSpan) valSpan.textContent = tone.distortion.amount.toFixed(2);
        }
      });

      const distOversample = modal.querySelector('#tb-dist-oversample') as HTMLSelectElement | null;
      distOversample?.addEventListener('change', () => {
        if (tone.distortion) {
          tone.distortion.oversample = distOversample.value as OversampleAmount;
        }
      });

      // Preview
      modal.querySelector('#tb-preview')?.addEventListener('click', async () => {
        stopPreview();
        await ensureResumed();
        previewSynth = createToneSynth(tone);
        previewSynth.connect(getMasterGain());
        previewSynth.setFrequency(noteToFrequency(69)); // A4
        previewSynth.setVolume(0.5);
        previewSynth.start();
        (modal.querySelector('#tb-preview') as HTMLButtonElement).disabled = true;
        (modal.querySelector('#tb-stop-preview') as HTMLButtonElement).disabled = false;
      });

      modal.querySelector('#tb-stop-preview')?.addEventListener('click', () => {
        stopPreview();
        (modal.querySelector('#tb-preview') as HTMLButtonElement).disabled = false;
        (modal.querySelector('#tb-stop-preview') as HTMLButtonElement).disabled = true;
      });

      // Save / Cancel
      modal.querySelector('#tb-save')?.addEventListener('click', () => {
        stopPreview();
        cleanup();
        resolve({ tone, action: 'save' });
      });

      modal.querySelector('#tb-cancel')?.addEventListener('click', () => {
        stopPreview();
        cleanup();
        resolve({ tone, action: 'cancel' });
      });
    }

    function stopPreview() {
      if (previewSynth) {
        try {
          previewSynth.setVolume(0);
          previewSynth.stop();
        } catch { /* already stopped */ }
        previewSynth = null;
      }
    }

    function cleanup() {
      overlay.remove();
    }

    // Mount
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderModal();
  });
}
