import '@preact/signals'; // the dialog re-renders when the settings it shows change
import type { ReadonlySignal, Signal } from '@preact/signals';
import { store } from '../state/store';
import { useEscapeToClose } from './menu';
import { hapticClick, HAPTIC_MS_MAX, HAPTIC_MS_MIN } from './haptics';

/**
 * Settings (BACKLOG 16.3): device and workspace preferences you set once and
 * then forget, kept out of the drawers and the top bar. Later: pen and gamepad
 * mapping (11.3 / 11.4).
 */

export interface MidiDeviceInfo {
  id: string;
  name: string;
}

export interface MidiSettings {
  supported: boolean;
  devices: ReadonlySignal<readonly MidiDeviceInfo[]>;
  activeId: ReadonlySignal<string | null>;
  /** Ask for MIDI access so the list can fill. Only on the user's first
   *  interaction with the list, so the permission prompt has a reason. */
  requestList(): void;
  select(id: string | null): void;
}

export function SettingsDialog({ open, midi }: { open: Signal<boolean>; midi: MidiSettings }) {
  if (!open.value) return null;
  return <SettingsBody close={() => { open.value = false; }} midi={midi} />;
}

function SettingsBody({ close, midi }: { close(): void; midi: MidiSettings }) {
  useEscapeToClose(true, close);
  const st = store.getState();
  return (
    <div class="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal settings-modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>

        <section class="settings-section">
          <h3>MIDI</h3>
          <div class="tb-row">
            <label for="settings-midi-device">Input device</label>
            <select
              id="settings-midi-device"
              disabled={!midi.supported}
              title={midi.supported ? 'Live MIDI input device' : 'MIDI input isn’t supported by this browser.'}
              value={midi.activeId.value ?? ''}
              onFocus={() => midi.requestList()}
              onChange={e => midi.select((e.currentTarget as HTMLSelectElement).value || null)}
            >
              <option value="">None</option>
              {midi.devices.value.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>Playback</h3>
          <label class="settings-check">
            <input
              type="checkbox"
              checked={st.audibleScrub}
              onChange={e => store.setAudibleScrub((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>
              Audible scrub
              <span class="settings-hint">Hear the composition under the playhead while you drag the ruler.</span>
            </span>
          </label>
        </section>

        <section class="settings-section">
          <h3>Touch</h3>
          <label class="settings-check">
            <input
              type="checkbox"
              checked={st.hapticClicks}
              onChange={e => store.setHapticClicks((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>
              Haptic clicks on snap lines
              <span class="settings-hint">
                A tiny click when your finger comes onto a note line, fret or pitch guide while
                performing, with Snap on or off. On Android phones and tablets; iPhones and
                computers can’t vibrate.
              </span>
            </span>
          </label>
          <div class="settings-slider" title="How long each click lasts. Some phones skip very short ones; raise it until you feel it">
            <label for="haptic-ms">Click length</label>
            <input
              type="range" id="haptic-ms" min={HAPTIC_MS_MIN} max={HAPTIC_MS_MAX} step="1" value={st.hapticMs}
              disabled={!st.hapticClicks}
              onInput={e => store.setHapticMs(Number((e.currentTarget as HTMLInputElement).value))}
              onChange={() => hapticClick(store.getState().hapticMs, performance.now())}
            />
            <span class="settings-slider-value">{st.hapticMs} ms</span>
          </div>
        </section>

        <div class="tb-actions settings-actions">
          <span class="settings-build" title="Which build this is: version, commit and date. Mention it when reporting a problem.">
            Build {__BUILD_INFO__}{import.meta.env.DEV ? ' (dev server)' : ''}
          </span>
          <button class="tb-btn primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
