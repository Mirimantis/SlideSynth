import { useEffect, useRef, useState } from 'preact/hooks';
import type { Track, ToneDefinition } from '../types';
import { showDialog } from './dialog-host';

/**
 * Asks the user which track to MIDI-arm. Shown when a MIDI device is selected
 * with no track currently armed, so the user can't miss the arming step (the
 * symptom otherwise is "I hear notes but no curves appear"). A Preact
 * component since BACKLOG 15.4.
 *
 * Resolves to:
 *  - { kind: 'arm-existing', trackId } — caller should arm that track.
 *  - { kind: 'arm-new' } — caller should run the add-track flow then arm.
 *  - null — Cancel / Escape; nothing armed.
 */
export type MidiArmDialogResult =
  | { kind: 'arm-existing'; trackId: string }
  | { kind: 'arm-new' }
  | null;

export function openMidiArmDialog(opts: {
  tracks: readonly Track[];
  toneLibrary: readonly ToneDefinition[];
}): Promise<MidiArmDialogResult> {
  return showDialog<MidiArmDialogResult>(done => <MidiArmDialog {...opts} onDone={done} />);
}

export function MidiArmDialog({ tracks, toneLibrary, onDone }: {
  tracks: readonly Track[];
  toneLibrary: readonly ToneDefinition[];
  onDone(result: MidiArmDialogResult): void;
}) {
  const [chosen, setChosen] = useState(tracks[0]?.id ?? null);
  const hasTracks = tracks.length > 0;
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);

  const pickExisting = () => { if (chosen !== null) onDone({ kind: 'arm-existing', trackId: chosen }); };

  useEffect(() => { (confirmBtn.current ?? newBtn.current)?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone(null);
      } else if (e.key === 'Enter' && hasTracks) {
        e.preventDefault();
        pickExisting();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chosen]);

  return (
    <div class="modal-overlay">
      <div class="modal midi-arm-modal" style={{ maxWidth: '380px' }}>
        <h2>Record MIDI into which track?</h2>
        {hasTracks ? (
          <div class="midi-arm-list">
            {tracks.map(t => {
              const tone = toneLibrary.find(x => x.id === t.toneId);
              const color = tone?.color ?? 'var(--tone-fallback)';
              return (
                <label class="midi-arm-row" key={t.id}>
                  <input type="radio" name="midi-arm-track" value={t.id} checked={chosen === t.id} onChange={() => setChosen(t.id)} />
                  <span class="midi-arm-swatch" style={{ background: color }}></span>
                  <span class="midi-arm-name">{t.name}</span>
                  <span class="midi-arm-tone" style={{ color }}>{tone?.name ?? '?'}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <p class="midi-arm-empty">No tracks yet. Create one to record into:</p>
        )}
        <div class="midi-arm-newrow">
          <button id="midi-arm-new" class="tb-btn" ref={newBtn} onClick={() => onDone({ kind: 'arm-new' })}>+ New track</button>
        </div>
        <div class="tb-actions" style={{ justifyContent: 'flex-end' }}>
          <button id="midi-arm-cancel" class="tb-btn" onClick={() => onDone(null)}>Cancel</button>
          {hasTracks && <button id="midi-arm-confirm" class="tb-btn primary" ref={confirmBtn} onClick={pickExisting}>Arm</button>}
        </div>
      </div>
    </div>
  );
}
