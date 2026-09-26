import '@preact/signals'; // the panel re-renders when the store fields it reads change
import { useState } from 'preact/hooks';
import { store } from '../state/store';
import { centsToReferenceAHz } from '../constants';
import {
  ALL_NOTES, MAX_EDO, MIN_EDO, TUNING_TABLES, TWELVE_EDO,
  clampDivisions, degreeName, isTwelveEdo, resolveTuning, scalesFor,
  type Equave, type TuningGroup, type TuningRef,
} from '../tuning/tuning';

/**
 * The Tuning drawer's controls (BACKLOG 13.8 (a); spec in DESIGN.md › Tuning
 * spec): Tuning, Root, Scale, Tuned from (for tunings other than 12-EDO),
 * Tune A4 and the Pitch lines switch. 13.8 (c) puts the pitch circle above
 * them.
 */

export interface TuningActions {
  /** Each is one undo step; main.ts takes the snapshot and redraws. */
  setTuning(ref: TuningRef): void;
  setRoot(degree: number): void;
  setScale(scaleId: string): void;
  setTunedFrom(pitchClass: number): void;
  setPitchLinesVisible(visible: boolean): void;
  setReferenceHz(hz: number): void;
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TABLE_GROUPS: readonly TuningGroup[] = ['Just intonation', 'Historical', 'Traditional'];
/** The Tuning select's value for "Equal divisions (type N)". */
const EQUAL_DIVISIONS = 'edo';
const TWELVE = 'edo-12';

const blur = (e: Event) => (e.currentTarget as HTMLElement).blur();
const value = (e: Event) => (e.currentTarget as HTMLSelectElement | HTMLInputElement).value;

export function TuningPanel({ actions }: { actions: TuningActions }) {
  const st = store.getState();
  const ref = st.tuning;
  const tuning = resolveTuning(ref);
  const selected = isTwelveEdo(ref) ? TWELVE : ref.kind === 'edo' ? EQUAL_DIVISIONS : ref.id;
  const scales = scalesFor(tuning);
  const scaleGroups = [...new Set(scales.map(s => s.group))];
  return (
    <div class="drawer-section tuning-panel">
      <div class="transport-row">
        <label for="tuning-select">Tuning</label>
        <select
          id="tuning-select"
          title="Which pitches exist"
          value={selected}
          onChange={e => {
            const v = value(e);
            if (v === TWELVE) actions.setTuning({ ...TWELVE_EDO });
            else if (v === EQUAL_DIVISIONS) actions.setTuning({ kind: 'edo', divisions: 19, equave: 'octave' });
            else actions.setTuning({ kind: 'table', id: v });
            blur(e);
          }}
        >
          <option value={TWELVE}>12-EDO (standard)</option>
          <option value={EQUAL_DIVISIONS}>Equal divisions…</option>
          {TABLE_GROUPS.map(group => (
            <optgroup key={group} label={group}>
              {TUNING_TABLES.filter(t => t.group === group).map(t => (
                <option key={t.id} value={t.id}>{t.approximate ? `${t.name} (approx.)` : t.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {ref.kind === 'edo' && !isTwelveEdo(ref) && (
        <EqualDivisions divisions={ref.divisions} equave={ref.equave} onChange={actions.setTuning} />
      )}
      <div class="transport-row">
        <label for="tuning-root">Root</label>
        <select
          id="tuning-root"
          title="Which note is home"
          value={String(st.root)}
          onChange={e => { actions.setRoot(Number(value(e))); blur(e); }}
        >
          {tuning.degrees.map((_, d) => (
            <option key={d} value={String(d)}>{degreeName(tuning, st.tunedFrom, d)}</option>
          ))}
        </select>
      </div>
      <div class="transport-row">
        <label for="tuning-scale">Scale</label>
        <select
          id="tuning-scale"
          title="Which notes the piece uses"
          value={scales.some(s => s.id === st.scaleId) ? st.scaleId : ALL_NOTES}
          onChange={e => { actions.setScale(value(e)); blur(e); }}
        >
          <option value={ALL_NOTES}>All notes</option>
          {scaleGroups.map(group => (
            <optgroup key={group} label={group}>
              {scales.filter(s => s.group === group).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {!isTwelveEdo(ref) && (
        <div class="transport-row">
          <label for="tuning-from">Tuned from</label>
          <select
            id="tuning-from"
            title="Which standard note the tuning's first degree sits on"
            value={String(st.tunedFrom)}
            onChange={e => { actions.setTunedFrom(Number(value(e))); blur(e); }}
          >
            {PITCH_CLASSES.map((name, pc) => <option key={name} value={String(pc)}>{name}</option>)}
          </select>
        </div>
      )}
      <ReferencePitch cents={st.composition.tuningOffsetCents} onCommit={actions.setReferenceHz} />
      <div class="transport-row">
        <label class="toggle-switch" title="Show the pitch lines, and snap to them. Off: no lines, and pitch floats free (frets and Prism echoes still pull)">
          <span class="toggle-switch-track">
            <input
              type="checkbox"
              id="pitch-lines-toggle"
              checked={!st.hidePitchLines}
              onChange={e => { actions.setPitchLinesVisible((e.currentTarget as HTMLInputElement).checked); blur(e); }}
            />
            <span class="toggle-switch-thumb" />
          </span>
          <span class="toggle-switch-label">Pitch lines</span>
        </label>
      </div>
    </div>
  );
}

/** N, and what's divided: the octave, or the 3:1 twelfth (Bohlen–Pierce). */
function EqualDivisions({ divisions, equave, onChange }: {
  divisions: number; equave: Equave; onChange(ref: TuningRef): void;
}) {
  // What's typed, until Enter or leaving the field commits it.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = clampDivisions(Number(raw));
    if (n !== divisions) onChange({ kind: 'edo', divisions: n, equave });
  };
  return (
    <div class="transport-row">
      <label for="tuning-divisions">Divisions</label>
      <input
        type="number"
        id="tuning-divisions"
        min={MIN_EDO}
        max={MAX_EDO}
        step={1}
        title={`Equal steps per period (${MIN_EDO}–${MAX_EDO})`}
        value={draft ?? String(divisions)}
        onInput={e => setDraft(value(e))}
        onChange={e => commit(value(e))}
        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
      />
      <select
        id="tuning-equave"
        title="What's divided: the octave, or the 3:1 twelfth (Bohlen–Pierce)"
        value={equave}
        onChange={e => { onChange({ kind: 'edo', divisions, equave: value(e) as Equave }); blur(e); }}
      >
        <option value="octave">of the octave</option>
        <option value="tritave">of 3:1</option>
      </select>
    </div>
  );
}

const MIN_A4_HZ = 380;
const MAX_A4_HZ = 500;

function formatCents(cents: number): string {
  if (Math.abs(cents) < 0.05) return '0¢';
  return `${cents > 0 ? '+' : ''}${cents.toFixed(1)}¢`;
}

/** Tune A4: the reference frequency. It moves Hz, never the grid. */
function ReferencePitch({ cents, onCommit }: { cents: number; onCommit(hz: number): void }) {
  const hz = Number(centsToReferenceAHz(cents).toFixed(2));
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div class="transport-row">
      <label for="input-tuning" title="Reference frequency for A4. 440 = standard, 432 = 'Verdi tuning', 415 = Baroque pitch, etc.">Tune A4</label>
      <input
        type="number"
        id="input-tuning"
        min={MIN_A4_HZ}
        max={MAX_A4_HZ}
        step={0.1}
        title="Reference frequency for A4 in Hz (default 440)"
        value={draft ?? String(hz)}
        onInput={e => setDraft(value(e))}
        onChange={e => {
          setDraft(null);
          const typed = Number(value(e));
          onCommit(Math.max(MIN_A4_HZ, Math.min(MAX_A4_HZ, Number.isFinite(typed) && typed > 0 ? typed : 440)));
          (e.currentTarget as HTMLInputElement).blur();
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
      />
      <span class="transport-hint" id="tuning-cents-display" title="Cents offset from A=440">{formatCents(cents)}</span>
    </div>
  );
}
