import '@preact/signals'; // the panel re-renders when the store fields it reads change
import { useState } from 'preact/hooks';
import { store } from '../state/store';

/**
 * The Tempo drawer (BACKLOG 16.3): BPM, time signature and the metronome.
 * They're set once per project, if at all, so they sit in a drawer rather
 * than taking room in the top bar.
 */

export interface TempoActions {
  /** Both are undoable composition edits; main.ts takes the snapshot. */
  setBpm(bpm: number): void;
  setTimeSignature(beats: number, denominator: number): void;
}

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '7/4', '6/8', '9/8', '12/8'];
const MIN_BPM = 20;
const MAX_BPM = 300;

export function TempoPanel({ actions }: { actions: TempoActions }) {
  const st = store.getState();
  const comp = st.composition;
  const timeSig = `${comp.beatsPerMeasure}/${comp.timeSignatureDenominator}`;
  // A file can carry a meter the list doesn't offer; show it rather than lie.
  const meters = TIME_SIGNATURES.includes(timeSig) ? TIME_SIGNATURES : [timeSig, ...TIME_SIGNATURES];
  return (
    <div class="drawer-section">
      <div class="transport-row">
        <label for="tempo-bpm">BPM</label>
        <BpmInput bpm={comp.bpm} onCommit={actions.setBpm} />
      </div>
      <div class="transport-row">
        <label for="tempo-time-sig">Time</label>
        <select
          id="tempo-time-sig"
          title="Time signature"
          value={timeSig}
          onChange={e => {
            const [beats, den] = (e.currentTarget as HTMLSelectElement).value.split('/').map(Number);
            if (Number.isFinite(beats) && Number.isFinite(den)) actions.setTimeSignature(beats!, den!);
          }}
        >
          {meters.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div class="transport-row">
        <label class="toggle-switch" title="Metronome clicks during playback">
          <span class="toggle-switch-track">
            <input
              type="checkbox"
              id="metronome-toggle"
              checked={st.metronomeEnabled}
              onChange={e => store.setMetronomeEnabled((e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="toggle-switch-thumb" />
          </span>
          <span class="toggle-switch-label">Metronome</span>
        </label>
        <input
          type="range"
          class="metronome-volume"
          min="0"
          max="100"
          value={Math.round(st.metronomeVolume * 100)}
          title="Metronome volume"
          onInput={e => store.setMetronomeVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        />
      </div>
    </div>
  );
}

/** BPM field: what's typed stays as typed until Enter or leaving the field,
 *  then it's clamped to 20–300 and committed as one undo step. */
function BpmInput({ bpm, onCommit }: { bpm: number; onCommit(bpm: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      id="tempo-bpm"
      min={MIN_BPM}
      max={MAX_BPM}
      step="1"
      value={draft ?? String(bpm)}
      onInput={e => setDraft((e.currentTarget as HTMLInputElement).value)}
      onChange={e => {
        const typed = Number((e.currentTarget as HTMLInputElement).value);
        setDraft(null);
        if (!Number.isFinite(typed)) return;
        const next = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(typed)));
        if (next !== bpm) onCommit(next);
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}
