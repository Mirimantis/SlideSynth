import '@preact/signals'; // the panel re-renders when the store fields it reads change
import { useState } from 'preact/hooks';
import { store } from '../state/store';
import {
  BUILTIN_SNAP_PRESETS, loadUserSnapPresets, saveUserSnapPresets, presetMatches, snapshotPreset,
  type SnapFeel, type SnapPreset,
} from '../utils/snap-presets';

/**
 * The Snap drawer (BACKLOG 16.4): feel presets, Gravity and its Force /
 * Spring / Damping, and the guides. Snap on/off itself is the top-bar switch.
 *
 * Gravity is `magnetic*` in the store and the file, and Force is
 * `magneticStrength` — persisted names, so the renames (13.1, 16.4) are
 * display-only.
 */

export interface SnapActions {
  /** Ask for a new preset's name; null if cancelled. */
  askPresetName(existingNames: readonly string[]): Promise<string | null>;
  confirmDeletePreset(name: string): boolean;
  /** Add a guide at the centre of the view and select it (main.ts knows the view). */
  addGuide(orientation: 'x' | 'y'): void;
  /** Guides draw on the background layer, which only redraws when asked. */
  redrawGuides(): void;
  notify(message: string): void;
}

const CUSTOM = '__custom__';

function formatDamping(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

/** Blur after a click or change, so the next key reaches the keyboard map. */
const blur = (e: Event) => (e.currentTarget as HTMLElement).blur();

export function SnapPanel({ actions }: { actions: SnapActions }) {
  return (
    <div id="snap-section">
      <PresetRow actions={actions} />
      <GravityControls />
      <GuidesRow actions={actions} />
    </div>
  );
}

function PresetRow({ actions }: { actions: SnapActions }) {
  const st = store.getState();
  const [userPresets, setUserPresets] = useState<SnapPreset[]>(loadUserSnapPresets);
  // The preset last picked or saved. It stays selected while the feel still
  // matches it, even when a built-in matches too.
  const [pickedId, setPickedId] = useState<string | null>(null);

  const live: SnapFeel = {
    magneticStrength: st.magneticStrength,
    magneticSpringK: st.magneticSpringK,
    magneticDamping: st.magneticDamping,
  };
  const all = [...BUILTIN_SNAP_PRESETS, ...userPresets];
  const picked = all.find(p => p.id === pickedId);
  const match = (picked && presetMatches(picked, live) ? picked : null)
    ?? all.find(p => presetMatches(p, live)) ?? null;
  const userMatch = match && userPresets.some(u => u.id === match.id) ? match : null;

  function load(id: string) {
    const preset = all.find(p => p.id === id);
    if (!preset) return;
    // Presets hold feel only (13.2), but Gravity needs Snap and Gravity both on,
    // so a load with either off would do nothing audible. Turn them on and say so.
    const turnedOn: string[] = [];
    if (!store.getState().snapEnabled) { store.setSnap(true); turnedOn.push('Snap'); }
    if (!store.getState().magneticEnabled) { store.setMagneticEnabled(true); turnedOn.push('Gravity'); }
    if (turnedOn.length > 0) actions.notify(`${preset.name}: ${turnedOn.join(' + ')} On`);
    // Not an undo step: a preset is a workflow setting, like the sliders.
    const s = preset.settings;
    if (s.magneticStrength !== undefined) store.setMagneticStrength(s.magneticStrength);
    if (s.magneticSpringK !== undefined) store.setMagneticSpringK(s.magneticSpringK);
    if (s.magneticDamping !== undefined) store.setMagneticDamping(s.magneticDamping);
    setPickedId(preset.id);
  }

  async function save() {
    const name = await actions.askPresetName(all.map(p => p.name));
    if (!name) return;
    const preset = snapshotPreset(name, live);
    const next = [...userPresets, preset];
    saveUserSnapPresets(next);
    setUserPresets(next);
    setPickedId(preset.id);
    actions.notify(`Saved snap preset "${name}".`);
  }

  function remove() {
    if (!userMatch || !actions.confirmDeletePreset(userMatch.name)) return;
    const next = userPresets.filter(p => p.id !== userMatch.id);
    saveUserSnapPresets(next);
    setUserPresets(next);
    if (pickedId === userMatch.id) setPickedId(null);
  }

  return (
    <div class="transport-row snap-preset-row">
      <label for="snap-preset-select">Preset</label>
      <select
        id="snap-preset-select"
        title="Snap preset — load a saved Gravity feel (Force, Spring, Damping)"
        value={match?.id ?? CUSTOM}
        onChange={e => { load((e.currentTarget as HTMLSelectElement).value); blur(e); }}
      >
        {/* Shown only when no preset matches the feel. */}
        <option value={CUSTOM} disabled hidden={!!match}>Custom</option>
        <optgroup label="Built-in">
          {BUILTIN_SNAP_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
        {userPresets.length > 0 && (
          <optgroup label="User">
            {userPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
      <button
        id="snap-preset-save"
        class="snap-preset-btn"
        title="Save the current feel as a new preset"
        onClick={e => { blur(e); void save(); }}
      >Save</button>
      <button
        id="snap-preset-delete"
        class="snap-preset-btn"
        title="Delete the selected user preset"
        disabled={!userMatch}
        onClick={e => { blur(e); remove(); }}
      >Del</button>
    </div>
  );
}

function GravityControls() {
  const st = store.getState();
  return (
    <>
      <div class="transport-row">
        <label class="toggle-switch" title="Gravity: snap lines pull the pitch like a spring, instead of snapping to them instantly">
          <span class="toggle-switch-track">
            <input
              type="checkbox"
              id="gravity-toggle"
              checked={st.magneticEnabled}
              onChange={e => { store.setMagneticEnabled((e.currentTarget as HTMLInputElement).checked); blur(e); }}
            />
            <span class="toggle-switch-thumb" />
          </span>
          <span class="toggle-switch-label">Gravity</span>
        </label>
      </div>
      <Slider
        id="gravity-force" label="Force" min={0} max={1} step={0.05}
        value={st.magneticStrength} shown={st.magneticStrength.toFixed(2)}
        title="Force: how hard snap lines pull the pitch (0 = smooth cursor follow, 1 = strong snap pull)"
        onInput={v => store.setMagneticStrength(v)}
      />
      <Slider
        id="gravity-spring" label="Spring" min={1} max={50} step={1}
        value={st.magneticSpringK} shown={String(Math.round(st.magneticSpringK))}
        title="Cursor-to-pitch spring stiffness (1 = loose, 50 = tight tracking)"
        onInput={v => store.setMagneticSpringK(v)}
      />
      <Slider
        id="gravity-damping" label="Damping" min={0.25} max={15} step={0.25}
        value={st.magneticDamping} shown={formatDamping(st.magneticDamping)}
        title="Velocity damping (low = long vibrato wobbles, high = quick settle)"
        onInput={v => store.setMagneticDamping(v)}
      />
    </>
  );
}

function Slider({ id, label, min, max, step, value, shown, title, onInput }: {
  id: string; label: string; min: number; max: number; step: number;
  value: number; shown: string; title: string; onInput(value: number): void;
}) {
  return (
    <div class="transport-row">
      <label for={id}>{label}</label>
      <input
        type="range" id={id} class="gravity-slider" min={min} max={max} step={step} value={value} title={title}
        onInput={e => onInput(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="gravity-value">{shown}</span>
    </div>
  );
}

function GuidesRow({ actions }: { actions: SnapActions }) {
  const st = store.getState();
  // A new guide is selected at once; while locked it couldn't be deselected
  // on the canvas, so adding waits for unlock.
  const addTitle = (axis: string) => (st.guidesLocked ? 'Unlock guides to add a new one' : `Add a ${axis} guide at the centre of the viewport`);
  return (
    <div class="transport-row guides-row">
      <label class="toggle-switch" title="Show snap guides — when off, guides are hidden and don't snap">
        <span class="toggle-switch-track">
          <input
            type="checkbox"
            id="guides-visible-toggle"
            checked={st.guidesVisible}
            onChange={e => { store.setGuidesVisible((e.currentTarget as HTMLInputElement).checked); actions.redrawGuides(); blur(e); }}
          />
          <span class="toggle-switch-thumb" />
        </span>
        <span class="toggle-switch-label">Guides</span>
      </label>
      <label class="toggle-switch" title="Lock guides — when locked, guides can't be selected, dragged, or deleted from the canvas (snap pull still works)">
        <span class="toggle-switch-track">
          <input
            type="checkbox"
            id="guides-locked-toggle"
            checked={st.guidesLocked}
            onChange={e => { store.setGuidesLocked((e.currentTarget as HTMLInputElement).checked); actions.redrawGuides(); blur(e); }}
          />
          <span class="toggle-switch-thumb" />
        </span>
        <span class="toggle-switch-label">Lock</span>
      </label>
      <button
        id="add-guide-x-btn" class="snap-preset-btn" disabled={st.guidesLocked} title={addTitle('vertical (beat)')}
        onClick={e => { blur(e); actions.addGuide('x'); }}
      >+ X</button>
      <button
        id="add-guide-y-btn" class="snap-preset-btn" disabled={st.guidesLocked} title={addTitle('horizontal (pitch)')}
        onClick={e => { blur(e); actions.addGuide('y'); }}
      >+ Y</button>
    </div>
  );
}
