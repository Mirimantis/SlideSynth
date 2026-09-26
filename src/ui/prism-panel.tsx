import '@preact/signals'; // the panel re-renders when the store fields it reads change
import type { ComponentChildren } from 'preact';
import { store } from '../state/store';
import { commandTitle } from '../commands/catalog';
import {
  RELEVANT_QUALITIES,
  STACKING_LABELS,
  QUALITY_LABELS,
  INTONATION_LABELS,
  DIRECTION_LABELS,
  type StackingStyle,
  type ChordQuality,
  type TuningSystem,
  type Direction,
  type NumVoices,
} from '../utils/harmonics';
import { isTwelveEdo, resolveTuning } from '../tuning/tuning';

/**
 * The Harmonic Prism drawer: Draw and Projection switches, the chord spec and
 * per-voice octaves. 16.4 renamed the chord's "Tuning" to Intonation, so it
 * isn't confused with the Tuning drawer.
 */

const STACKINGS: StackingStyle[] = ['tertian', 'quartal', 'quintal', 'secondal'];
const INTONATIONS: TuningSystem[] = ['12-TET', 'just-intonation'];
const DIRECTIONS: Direction[] = ['up', 'down', 'symmetric'];
const VOICE_COUNTS: NumVoices[] = [2, 3, 4, 5];

/** Blur after a change, so the next key reaches the keyboard map. */
const blur = (e: Event) => (e.currentTarget as HTMLElement).blur();
const selectValue = (e: Event) => (e.currentTarget as HTMLSelectElement).value;

export function PrismPanel() {
  const prism = store.getState().harmonicPrism;
  const spec = prism.chordSpec;
  const qualities = (RELEVANT_QUALITIES[spec.stacking] ?? ['major']) as ChordQuality[];
  // "Equal" counts in the current tuning's steps (13.8 (b)).
  const tuningRef = store.getState().tuning;
  const intonationLabels = isTwelveEdo(tuningRef)
    ? INTONATION_LABELS
    : { ...INTONATION_LABELS, '12-TET': `Equal (${resolveTuning(tuningRef).name})` };
  return (
    <>
      <Switch
        id="prism-draw-toggle" label="Draw" title={commandTitle('prism.drawMode')} checked={prism.drawMode}
        onChange={on => { store.setPrismDrawMode(on); return true; }}
      />
      <Switch
        id="prism-projection-toggle" label="Projection" title={commandTitle('prism.projection')}
        checked={prism.projectionSourceId !== null}
        onChange={on => {
          if (!on) { store.setPrismProjectionSource(null); return true; }
          // Projection needs a selected curve to project from.
          const sel = store.getSelectedCurveId();
          if (!sel) return false;
          store.setPrismProjectionSource(sel);
          return true;
        }}
      />
      <Row id="prism-stacking" label="Stacking" title="Interval used to stack the chord voices">
        <select
          id="prism-stacking" value={spec.stacking}
          onChange={e => {
            const stacking = selectValue(e) as StackingStyle;
            // Keep the quality if the new stacking offers it, else take its first.
            const valid = RELEVANT_QUALITIES[stacking] ?? ['major'];
            const quality = valid.includes(spec.quality) ? spec.quality : valid[0] as ChordQuality;
            store.setPrismChordSpec({ stacking, quality });
            blur(e);
          }}
        >
          <Options values={STACKINGS} labels={STACKING_LABELS} />
        </select>
      </Row>
      <Row id="prism-quality" label="Quality" title="Chord quality (fully applies to tertian; limited options elsewhere)">
        <select
          id="prism-quality" value={spec.quality}
          onChange={e => { store.setPrismChordSpec({ quality: selectValue(e) as ChordQuality }); blur(e); }}
        >
          <Options values={qualities} labels={QUALITY_LABELS} />
        </select>
      </Row>
      <Row id="prism-num-voices" label="Voices" title="Number of simultaneous voices (2 = dyad, 3 = triad, 4 = tetrad, 5 = pentad)">
        <select
          id="prism-num-voices" value={String(spec.numVoices)}
          onChange={e => { store.setPrismChordSpec({ numVoices: Number(selectValue(e)) as NumVoices }); blur(e); }}
        >
          <Options values={VOICE_COUNTS} />
        </select>
      </Row>
      <Row id="prism-intonation" label="Intonation" title="Equal: the chord in the tuning's steps, counted from the root (12-TET semitones in 12-EDO). Just: pure acoustic ratios (e.g. 5/4 for M3, 7/4 for harmonic 7th)">
        <select
          id="prism-intonation" value={spec.tuning}
          onChange={e => { store.setPrismChordSpec({ tuning: selectValue(e) as TuningSystem }); blur(e); }}
        >
          <Options values={INTONATIONS} labels={intonationLabels} />
        </select>
      </Row>
      <Row id="prism-direction" label="Direction" title="Where harmony voices sit relative to the base pitch">
        <select
          id="prism-direction" value={spec.direction}
          onChange={e => { store.setPrismChordSpec({ direction: selectValue(e) as Direction }); blur(e); }}
        >
          <Options values={DIRECTIONS} labels={DIRECTION_LABELS} />
        </select>
      </Row>
      <Row id="prism-octaves" label="Octaves ±" title="How many octaves above and below the source to echo">
        <input
          type="number" id="prism-octaves" min={0} max={3} step={1} value={prism.projectionOctaveRange}
          onInput={e => {
            const n = Number((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(n)) store.setPrismOctaveRange(n);
          }}
        />
      </Row>
      <div class="panel-header" style="margin-top:8px">Voicing</div>
      {Array.from({ length: spec.numVoices }, (_, i) => (
        <VoiceOctave key={i} index={i} offsets={spec.voiceOctaveOffsets} />
      ))}
    </>
  );
}

function Switch({ id, label, title, checked, onChange }: {
  id: string; label: string; title: string; checked: boolean;
  /** False refuses the change, and the switch springs back. */
  onChange(on: boolean): boolean;
}) {
  return (
    <div class="prism-row prism-toggle-row">
      <label class="toggle-switch" title={title}>
        <span class="toggle-switch-track">
          <input
            type="checkbox" id={id} checked={checked}
            onChange={e => {
              const input = e.currentTarget as HTMLInputElement;
              if (!onChange(input.checked)) input.checked = !input.checked;
              input.blur();
            }}
          />
          <span class="toggle-switch-thumb" />
        </span>
        <span class="toggle-switch-label">{label}</span>
      </label>
    </div>
  );
}

function Row({ id, label, title, children }: { id: string; label: string; title: string; children: ComponentChildren }) {
  return (
    <div class="prism-row" title={title}>
      <label for={id}>{label}</label>
      {children}
    </div>
  );
}

function Options<T extends string | number>({ values, labels }: { values: readonly T[]; labels?: Record<string, string> }) {
  return (
    <>
      {values.map(v => <option key={v} value={String(v)}>{labels?.[String(v)] ?? String(v)}</option>)}
    </>
  );
}

/** One voice's octave offset (8.13), for spreading voicings and inversions. */
function VoiceOctave({ index, offsets }: { index: number; offsets: readonly number[] }) {
  const id = `prism-voice-oct-${index}`;
  return (
    <div class="prism-row">
      <label for={id}>{index === 0 ? 'Voice 1 (root)' : `Voice ${index + 1}`}</label>
      <input
        type="number" id={id} class="prism-voice-oct" min={-2} max={2} step={1} value={offsets[index] ?? 0}
        title="Octave offset for this voice (±2). Lets you spread voicings or build inversions — e.g. 1st inversion = +1 on voice 1."
        onInput={e => {
          const raw = Number((e.currentTarget as HTMLInputElement).value);
          if (!Number.isFinite(raw)) return;
          // Pad with zeros up to this voice, so the array stays dense and its
          // JSON round-trip deterministic.
          const next = offsets.slice();
          while (next.length <= index) next.push(0);
          next[index] = Math.max(-2, Math.min(2, Math.round(raw)));
          store.setPrismChordSpec({ voiceOctaveOffsets: next });
        }}
      />
    </div>
  );
}
