import '@preact/signals'; // the panel re-renders when the store fields it reads change
import { useState } from 'preact/hooks';
import { store } from '../state/store';
import { MAGNETIC_SPEED_MAX, MAGNETIC_SPEED_MIN, stepMagneticSpeed } from '../utils/snap-magnetic';
import {
  BUILTIN_SNAP_PRESETS, loadUserSnapPresets, saveUserSnapPresets, presetMatches, snapshotPreset,
  type SnapFeel, type SnapPreset,
} from '../utils/snap-presets';

/**
 * The Gravity drawer (BACKLOG 16.4; was Snap until 16.8): feel presets, the
 * feel (Instant or Glissando) and Glissando's Force / Spring / Damping /
 * Speed, and the guides. Gravity on/off itself is the top-bar switch.
 *
 * In the store and the file, Gravity on/off is `snapEnabled`, Glissando is
 * `magneticEnabled` and Force is `magneticStrength` — persisted names, so the
 * renames (13.1, 16.4, 16.8) are display-only.
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

function formatSpeed(speed: number): string {
  return speed >= 10 ? speed.toFixed(0) : speed.toFixed(2).replace(/\.?0+$/, '');
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
    magneticSpeed: st.magneticSpeed,
  };
  const all = [...BUILTIN_SNAP_PRESETS, ...userPresets];
  const picked = all.find(p => p.id === pickedId);
  const match = (picked && presetMatches(picked, live) ? picked : null)
    ?? all.find(p => presetMatches(p, live)) ?? null;
  const userMatch = match && userPresets.some(u => u.id === match.id) ? match : null;

  function load(id: string) {
    const preset = all.find(p => p.id === id);
    if (!preset) return;
    // Presets hold Glissando's feel only (13.2), so a load with Gravity off or
    // on Instant would do nothing audible. Turn them on and say so.
    const turnedOn: string[] = [];
    if (!store.getState().snapEnabled) { store.setSnap(true); turnedOn.push('Gravity on'); }
    if (!store.getState().magneticEnabled) { store.setMagneticEnabled(true); turnedOn.push('Glissando'); }
    if (turnedOn.length > 0) actions.notify(`${preset.name}: ${turnedOn.join(', ')}`);
    // Not an undo step: a preset is a workflow setting, like the sliders.
    const s = preset.settings;
    if (s.magneticStrength !== undefined) store.setMagneticStrength(s.magneticStrength);
    if (s.magneticSpringK !== undefined) store.setMagneticSpringK(s.magneticSpringK);
    if (s.magneticDamping !== undefined) store.setMagneticDamping(s.magneticDamping);
    if (s.magneticSpeed !== undefined) store.setMagneticSpeed(s.magneticSpeed);
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
    actions.notify(`Saved Gravity preset "${name}".`);
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
        title="Gravity preset — load a saved Glissando feel (Force, Spring, Damping, Speed)"
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

/** Gravity's feel (16.8): Instant jumps to the nearest line; Glissando
 *  glides there under Force, Spring, Damping and Speed, which only it uses. */
function GravityControls() {
  const st = store.getState();
  const glissando = st.magneticEnabled;
  const feel = (value: boolean, label: string, title: string) => (
    <label class="prop-radio" title={title}>
      <input
        type="radio" name="gravity-feel" id={`gravity-feel-${value ? 'glissando' : 'instant'}`} checked={glissando === value}
        onChange={e => { store.setMagneticEnabled(value); blur(e); }}
      /> {label}
    </label>
  );
  const off = glissando ? undefined : 'Glissando’s setting: choose Glissando to use it';
  return (
    <>
      <div class="transport-row gravity-feel-row">
        <label>Feel</label>
        {feel(false, 'Instant', 'Pitch jumps straight to the nearest line. Drawing always works this way')}
        {feel(true, 'Glissando', 'Pitch glides to the lines like a weight on a spring, with the Force, Spring, Damping and Speed below')}
      </div>
      <Slider
        id="gravity-force" label="Force" min={0} max={1} step={0.05} disabledTitle={off}
        value={st.magneticStrength} shown={st.magneticStrength.toFixed(2)}
        title="Force: how hard the lines pull the pitch (0 = follows the cursor smoothly, 1 = a strong pull)"
        onInput={v => store.setMagneticStrength(v)}
      />
      <Slider
        id="gravity-spring" label="Spring" min={1} max={50} step={1} disabledTitle={off}
        value={st.magneticSpringK} shown={String(Math.round(st.magneticSpringK))}
        title="Cursor-to-pitch spring stiffness (1 = loose, 50 = tight tracking)"
        onInput={v => store.setMagneticSpringK(v)}
      />
      <Slider
        id="gravity-damping" label="Damping" min={0.25} max={15} step={0.25} disabledTitle={off}
        value={st.magneticDamping} shown={formatDamping(st.magneticDamping)}
        title="Velocity damping (low = long vibrato wobbles, high = quick settle)"
        onInput={v => store.setMagneticDamping(v)}
      />
      {/* 13.36. Logarithmic: 1× in the middle, as much travel slower as faster. */}
      <Slider
        id="gravity-speed" label="Speed" min={Math.log2(MAGNETIC_SPEED_MIN)} max={Math.log2(MAGNETIC_SPEED_MAX)} step={0.05} disabledTitle={off}
        value={Math.log2(st.magneticSpeed)} shown={`${formatSpeed(st.magneticSpeed)}×`}
        title="How fast the glide moves, without changing the tempo (1× follows the tempo as it is; 2× feels like double tempo). Fast with high Damping glides quickly and settles without vibrato"
        onInput={v => store.setMagneticSpeed(stepMagneticSpeed(2 ** v))}
      />
    </>
  );
}

function Slider({ id, label, min, max, step, value, shown, title, disabledTitle, onInput }: {
  id: string; label: string; min: number; max: number; step: number;
  value: number; shown: string; title: string;
  /** Set: the slider is greyed out, and this says why. */
  disabledTitle?: string;
  onInput(value: number): void;
}) {
  return (
    <div class="transport-row" title={disabledTitle}>
      <label for={id}>{label}</label>
      <input
        type="range" id={id} class="gravity-slider" min={min} max={max} step={step} value={value}
        title={disabledTitle ?? title} disabled={disabledTitle !== undefined}
        onInput={e => onInput(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="gravity-value">{shown}</span>
    </div>
  );
}

function GuidesRow({ actions }: { actions: SnapActions }) {
  const st = store.getState();
  // A new guide is selected at once; while locked it couldn't be deselected
  // on the canvas, so adding waits for unlock. Y guides are called frets
  // (13.16), X guides beat guides.
  const addTitle = (what: string) => (st.guidesLocked ? 'Unlock to add one' : `Add ${what} at the centre of the view`);
  return (
    <div class="transport-row guides-row">
      <label class="toggle-switch" title="Show frets and beat guides. Off: they're hidden and don't pull">
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
      <label class="toggle-switch" title="Lock frets and beat guides: they can't be selected, dragged or deleted on the canvas (they still pull)">
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
        id="add-guide-y-btn" class="snap-preset-btn" disabled={st.guidesLocked} title={addTitle('a fret (a pitch to land on)')}
        onClick={e => { blur(e); actions.addGuide('y'); }}
      >+ Fret</button>
      <button
        id="add-guide-x-btn" class="snap-preset-btn" disabled={st.guidesLocked} title={addTitle('a beat guide (a place in time)')}
        onClick={e => { blur(e); actions.addGuide('x'); }}
      >+ Beat</button>
    </div>
  );
}
