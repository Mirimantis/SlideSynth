import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToneDefinition, WaveformLayer, OscillatorShape, OversampleAmount } from '../types';
import { generateId } from '../model/tone';
import { ensureResumed, getMasterGain } from '../audio/engine';
import { createToneSynth, type ToneSynth } from '../audio/tone-synth';
import { centsToFrequency, A4_CENTS } from '../constants';
import { showDialog } from './dialog-host';
import { DashPreview } from './dash-preview';

/**
 * The tone builder (BACKLOG 15.4: a Preact component since then): name,
 * colour, line style, waveform layers and distortion, with a preview at A4.
 */

const DASH_PRESETS: { label: string; pattern: number[] }[] = [
  { label: 'Solid', pattern: [] },
  { label: 'Dashed', pattern: [12, 4] },
  { label: 'Dotted', pattern: [3, 3] },
  { label: 'Dash-Dot', pattern: [10, 4, 3, 4] },
  { label: 'Long Dash', pattern: [20, 6] },
];

const SHAPES: readonly OscillatorShape[] = ['sine', 'square', 'sawtooth', 'triangle'];
const OVERSAMPLES: readonly OversampleAmount[] = ['none', '2x', '4x'];

export interface ToneBuilderResult {
  tone: ToneDefinition;
  action: 'save' | 'cancel';
}

/** Open the tone builder: a new tone, or a copy of `existing` to edit.
 *  Resolves when the user saves or cancels. */
export function openToneBuilder(existing?: ToneDefinition): Promise<ToneBuilderResult> {
  return showDialog<ToneBuilderResult>(done => <ToneBuilder existing={existing} onDone={done} />);
}

function newTone(): ToneDefinition {
  return {
    id: generateId('tone'),
    name: 'New Tone',
    color: '#4fc3f7',
    dashPattern: [],
    layers: [{ type: 'sine', gain: 1.0, detune: 0 }],
    distortion: null,
  };
}

export function ToneBuilder({ existing, onDone }: {
  existing?: ToneDefinition;
  onDone(result: ToneBuilderResult): void;
}) {
  const [tone, setTone] = useState<ToneDefinition>(() =>
    existing ? JSON.parse(JSON.stringify(existing)) : newTone());
  const edit = (change: Partial<ToneDefinition>) => setTone(t => ({ ...t, ...change }));
  const editLayer = (i: number, change: Partial<WaveformLayer>) =>
    setTone(t => ({ ...t, layers: t.layers.map((l, j) => (j === i ? { ...l, ...change } : l)) }));

  // The preview plays the tone as it was when Preview was pressed.
  const previewSynth = useRef<ToneSynth | null>(null);
  const [previewing, setPreviewing] = useState(false);
  function stopPreview() {
    const synth = previewSynth.current;
    if (!synth) return;
    try {
      synth.setVolume(0);
      synth.stop();
    } catch { /* already stopped */ }
    previewSynth.current = null;
  }
  async function startPreview() {
    stopPreview();
    await ensureResumed();
    const synth = createToneSynth(tone);
    synth.connect(getMasterGain());
    synth.setFrequency(centsToFrequency(A4_CENTS)); // A4
    synth.setVolume(0.5);
    synth.start();
    previewSynth.current = synth;
    setPreviewing(true);
  }
  // However the builder goes away, the preview stops with it.
  useEffect(() => stopPreview, []);

  const finish = (action: ToneBuilderResult['action']) => {
    stopPreview();
    onDone({ tone, action });
  };

  const dashIndex = DASH_PRESETS.findIndex(d => d.pattern.join(',') === tone.dashPattern.join(','));
  const dist = tone.distortion;

  return (
    <div class="modal-overlay">
      <div class="modal tone-builder-modal">
        <h2>{existing ? 'Edit Tone' : 'New Tone'}</h2>

        <div class="tb-row">
          <label>Name</label>
          <input type="text" id="tb-name" value={tone.name} onInput={e => edit({ name: e.currentTarget.value })} />
        </div>

        <div class="tb-row">
          <label>Color</label>
          <input type="color" id="tb-color" value={tone.color} onInput={e => edit({ color: e.currentTarget.value })} />
          <div class="tb-color-preview" style={{ background: tone.color, width: '40px', height: '24px', borderRadius: '4px' }}></div>
        </div>

        <div class="tb-row">
          <label>Line Style</label>
          <select
            id="tb-dash"
            value={String(Math.max(0, dashIndex))}
            onChange={e => edit({ dashPattern: [...(DASH_PRESETS[Number(e.currentTarget.value)]?.pattern ?? [])] })}
          >
            {DASH_PRESETS.map((d, i) => <option key={d.label} value={String(i)}>{d.label}</option>)}
          </select>
          <DashPreview id="tb-dash-preview" color={tone.color} pattern={tone.dashPattern} width={80} height={16} />
        </div>

        <div class="tb-section">
          <div class="tb-section-header">
            <span>Waveform Layers</span>
            <button
              id="tb-add-layer" class="tb-small-btn"
              onClick={() => setTone(t => ({ ...t, layers: [...t.layers, { type: 'sine', gain: 0.5, detune: 0 }] }))}
            >+ Add</button>
          </div>
          <div id="tb-layers">
            {tone.layers.map((layer, i) => (
              <div class="tb-layer" key={i}>
                <select class="tb-layer-type" value={layer.type} onChange={e => editLayer(i, { type: e.currentTarget.value as OscillatorShape })}>
                  {SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <label>Vol</label>
                <input
                  type="range" class="tb-layer-gain" min="0" max="1" step="0.05" value={layer.gain}
                  onInput={e => editLayer(i, { gain: Number(e.currentTarget.value) })}
                />
                <span class="tb-layer-gain-val">{layer.gain.toFixed(2)}</span>
                <label>Detune</label>
                <input
                  type="number" class="tb-layer-detune" min="-1200" max="1200" step="1" value={layer.detune}
                  onChange={e => editLayer(i, { detune: Number(e.currentTarget.value) })}
                />
                <span>ct</span>
                {tone.layers.length > 1 && (
                  <button
                    class="tb-remove-layer tb-small-btn"
                    onClick={() => setTone(t => ({ ...t, layers: t.layers.filter((_, j) => j !== i) }))}
                  >X</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div class="tb-section">
          <div class="tb-section-header">
            <span>Distortion</span>
            <label class="tb-toggle">
              <input
                type="checkbox" id="tb-dist-enabled" checked={dist !== null}
                onChange={e => edit({ distortion: e.currentTarget.checked ? { amount: 0.3, oversample: '4x' } : null })}
              />
              Enable
            </label>
          </div>
          {dist && (
            <div id="tb-dist-controls">
              <div class="tb-row">
                <label>Amount</label>
                <input
                  type="range" id="tb-dist-amount" min="0" max="1" step="0.01" value={dist.amount}
                  onInput={e => edit({ distortion: { ...dist, amount: Number(e.currentTarget.value) } })}
                />
                <span id="tb-dist-amount-val">{dist.amount.toFixed(2)}</span>
              </div>
              <div class="tb-row">
                <label>Oversample</label>
                <select
                  id="tb-dist-oversample" value={dist.oversample}
                  onChange={e => edit({ distortion: { ...dist, oversample: e.currentTarget.value as OversampleAmount } })}
                >
                  {OVERSAMPLES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <div class="tb-actions">
          <button id="tb-preview" class="tb-btn" disabled={previewing} onClick={() => { void startPreview(); }}>Preview</button>
          <button id="tb-stop-preview" class="tb-btn" disabled={!previewing} onClick={() => { stopPreview(); setPreviewing(false); }}>Stop</button>
          <div style={{ flex: 1 }}></div>
          <button id="tb-cancel" class="tb-btn" onClick={() => finish('cancel')}>Cancel</button>
          <button id="tb-save" class="tb-btn primary" onClick={() => finish('save')}>Save</button>
        </div>
      </div>
    </div>
  );
}
