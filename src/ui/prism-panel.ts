// Harmonic Prism — chord-spec picker panel.

import { store } from '../state/store';
import {
  RELEVANT_QUALITIES,
  STACKING_LABELS,
  QUALITY_LABELS,
  TUNING_LABELS,
  DIRECTION_LABELS,
  type StackingStyle,
  type ChordQuality,
  type TuningSystem,
  type Direction,
  type NumVoices,
} from '../utils/harmonics';

const STACKINGS: StackingStyle[] = ['tertian', 'quartal', 'quintal', 'secondal'];
const TUNINGS: TuningSystem[] = ['12-TET', 'just-intonation'];
const DIRECTIONS: Direction[] = ['up', 'down', 'symmetric'];
const VOICE_COUNTS: NumVoices[] = [2, 3, 4, 5];

export function createPrismPanel(container: HTMLElement): { refresh(): void } {
  function optionsFor<T extends string | number>(values: readonly T[], labels: Record<string, string> | null, current: T): string {
    return values.map(v => {
      const label = labels ? labels[String(v)] ?? String(v) : String(v);
      const selected = v === current ? ' selected' : '';
      return `<option value="${v}"${selected}>${label}</option>`;
    }).join('');
  }

  function render() {
    const s = store.getState().harmonicPrism;
    const spec = s.chordSpec;
    const active = s.projectionSourceId !== null;
    const drawOn = s.drawMode;

    const qualityOptions = RELEVANT_QUALITIES[spec.stacking] ?? ['major'];

    container.innerHTML = `
      <div class="prism-row prism-toggle-row">
        <label class="toggle-switch" title="Press H to toggle Draw mode — clicks place chord clusters at the cursor">
          <span class="toggle-switch-track">
            <input type="checkbox" id="prism-draw-toggle" ${drawOn ? 'checked' : ''} />
            <span class="toggle-switch-thumb"></span>
          </span>
          <span class="toggle-switch-label">Draw</span>
        </label>
      </div>
      <div class="prism-row prism-toggle-row">
        <label class="toggle-switch" title="Press Ctrl+H on a selected curve to toggle Projection mode">
          <span class="toggle-switch-track">
            <input type="checkbox" id="prism-projection-toggle" ${active ? 'checked' : ''} />
            <span class="toggle-switch-thumb"></span>
          </span>
          <span class="toggle-switch-label">Projection</span>
        </label>
      </div>
      <div class="prism-row">
        <label for="prism-stacking">Stacking</label>
        <select id="prism-stacking" title="Interval used to stack the chord voices">
          ${optionsFor(STACKINGS, STACKING_LABELS, spec.stacking)}
        </select>
      </div>
      <div class="prism-row">
        <label for="prism-quality">Quality</label>
        <select id="prism-quality" title="Chord quality (fully applies to tertian; limited options elsewhere)">
          ${optionsFor(qualityOptions as ChordQuality[], QUALITY_LABELS, spec.quality)}
        </select>
      </div>
      <div class="prism-row">
        <label for="prism-num-voices">Voices</label>
        <select id="prism-num-voices" title="Number of simultaneous voices (2 = dyad, 3 = triad, 4 = tetrad, 5 = pentad)">
          ${optionsFor(VOICE_COUNTS, null, spec.numVoices)}
        </select>
      </div>
      <div class="prism-row">
        <label for="prism-tuning">Tuning</label>
        <select id="prism-tuning" title="Equal Temperament: grid-aligned. Just Intonation: pure acoustic ratios (e.g. 5/4 for M3, 7/4 for harmonic 7th)">
          ${optionsFor(TUNINGS, TUNING_LABELS, spec.tuning)}
        </select>
      </div>
      <div class="prism-row">
        <label for="prism-direction">Direction</label>
        <select id="prism-direction" title="Where harmony voices sit relative to the base pitch">
          ${optionsFor(DIRECTIONS, DIRECTION_LABELS, spec.direction)}
        </select>
      </div>
      <div class="prism-row">
        <label for="prism-octaves">Octaves ±</label>
        <input type="number" id="prism-octaves" min="0" max="3" step="1" value="${s.projectionOctaveRange}" title="How many octaves above and below the source to echo" />
      </div>
      <div class="panel-header" style="margin-top:8px">Voicing</div>
      ${voicingRowsHtml(spec.numVoices, spec.voiceOctaveOffsets)}
    `;

    wireInputs();
  }

  function voicingRowsHtml(numVoices: number, offsets: number[]): string {
    const rows: string[] = [];
    for (let i = 0; i < numVoices; i++) {
      const value = offsets[i] ?? 0;
      const label = i === 0 ? 'Voice 1 (root)' : `Voice ${i + 1}`;
      rows.push(`
        <div class="prism-row">
          <label for="prism-voice-oct-${i}">${label}</label>
          <input type="number" id="prism-voice-oct-${i}" data-voice-index="${i}" class="prism-voice-oct" min="-2" max="2" step="1" value="${value}" title="Octave offset for this voice (±2). Lets you spread voicings or build inversions — e.g. 1st inversion = +1 on voice 1." />
        </div>
      `);
    }
    return rows.join('');
  }

  function wireInputs() {
    container.querySelector('#prism-draw-toggle')?.addEventListener('change', (e) => {
      store.setPrismDrawMode((e.target as HTMLInputElement).checked);
    });
    container.querySelector('#prism-projection-toggle')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) {
        const sel = store.getSelectedCurveId();
        if (sel) {
          store.setPrismProjectionSource(sel);
        } else {
          // No selection — refuse the toggle and revert UI state.
          (e.target as HTMLInputElement).checked = false;
        }
      } else {
        store.setPrismProjectionSource(null);
      }
    });
    container.querySelector('#prism-stacking')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as StackingStyle;
      const currentQuality = store.getState().harmonicPrism.chordSpec.quality;
      const validQualities = RELEVANT_QUALITIES[val] ?? ['major'];
      // If the current quality isn't valid for the new stacking, pick the first.
      const newQuality: ChordQuality = validQualities.includes(currentQuality)
        ? currentQuality
        : (validQualities[0] as ChordQuality);
      store.setPrismChordSpec({ stacking: val, quality: newQuality });
      render();
    });
    container.querySelector('#prism-quality')?.addEventListener('change', (e) => {
      store.setPrismChordSpec({ quality: (e.target as HTMLSelectElement).value as ChordQuality });
      render();
    });
    container.querySelector('#prism-num-voices')?.addEventListener('change', (e) => {
      const n = Number((e.target as HTMLSelectElement).value) as NumVoices;
      store.setPrismChordSpec({ numVoices: n });
      render();
    });
    container.querySelector('#prism-tuning')?.addEventListener('change', (e) => {
      store.setPrismChordSpec({ tuning: (e.target as HTMLSelectElement).value as TuningSystem });
      render();
    });
    container.querySelector('#prism-direction')?.addEventListener('change', (e) => {
      store.setPrismChordSpec({ direction: (e.target as HTMLSelectElement).value as Direction });
      render();
    });
    container.querySelector('#prism-octaves')?.addEventListener('input', (e) => {
      store.setPrismOctaveRange(Number((e.target as HTMLInputElement).value));
    });

    // 8.13: per-voice octave offsets. Each row reads the live spec, splices in
    // its own value at its voice index, and pushes the array back. Empty
    // trailing zeros are preserved so JSON round-trip stays deterministic.
    const voiceInputs = container.querySelectorAll<HTMLInputElement>('.prism-voice-oct');
    voiceInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.voiceIndex);
        const raw = Number(input.value);
        if (!Number.isFinite(raw)) return;
        const clamped = Math.max(-2, Math.min(2, Math.round(raw)));
        const current = store.getState().harmonicPrism.chordSpec.voiceOctaveOffsets;
        // Pad with zeros up to idx so splice lands at the right index.
        const next = current.slice();
        while (next.length <= idx) next.push(0);
        next[idx] = clamped;
        store.setPrismChordSpec({ voiceOctaveOffsets: next });
      });
    });
  }

  render();
  return { refresh: render };
}
