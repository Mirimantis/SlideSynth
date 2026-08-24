import type { SnapSettings } from '../types';

/**
 * Snap presets — named bundles of *magnet feel* that the user can load with one
 * click. A preset carries only the three physics fields (force / spring /
 * damping); it never stores whether Snap or Magnetic is on, and never touches
 * `scaleRoot` / `scaleId` / `hidePitchLines` — the Key dropdown is an orthogonal
 * user choice that a "snap feel" preset shouldn't clobber. (BACKLOG 13.2)
 *
 * Note `magneticStrength` is the "Force" slider in the UI (BACKLOG 13.1); the
 * field name stays because it's persisted in the composition file.
 *
 * Loading a preset force-enables Snap + Magnetic at the call site — magnetic
 * physics is gated on both, so a feel-only preset would otherwise be inaudible.
 * That's an apply-time side effect, deliberately not a stored field.
 */
export type SnapPresetSettings = Partial<
  Pick<SnapSettings, 'magneticStrength' | 'magneticSpringK' | 'magneticDamping'>
>;

export interface SnapPreset {
  id: string;            // stable id (built-ins use 'builtin-*'; user presets use 'user-*<timestamp>')
  name: string;
  settings: SnapPresetSettings;
}

/**
 * Built-in starter set. Frozen so accidental mutation doesn't bleed across loads.
 * Names describe how the magnet behaves — settle time, grip, wobble — and never
 * reference a key or scale.
 */
export const BUILTIN_SNAP_PRESETS: readonly SnapPreset[] = Object.freeze([
  {
    // Matches the app's boot defaults, so the default feel is nameable.
    id: 'builtin-standard',
    name: 'Standard',
    settings: {
      magneticStrength: 0.85,
      magneticSpringK: 50,
      magneticDamping: 6,
    },
  },
  {
    // Attractors inert: smooth cursor-follow with no detents. Distinct from
    // Magnetic off, which is an instant hard jump to the snap line.
    id: 'builtin-free-glide',
    name: 'Free Glide',
    settings: {
      magneticStrength: 0,
      magneticSpringK: 50,
      magneticDamping: 8,
    },
  },
  {
    // Gentle pull that lets the pitch sit between targets.
    id: 'builtin-loose-detents',
    name: 'Loose Detents',
    settings: {
      magneticStrength: 0.45,
      magneticSpringK: 30,
      magneticDamping: 5,
    },
  },
  {
    // Hard grab, quick settle, minimal overshoot.
    id: 'builtin-pitch-lock',
    name: 'Pitch Lock',
    settings: {
      magneticStrength: 1,
      magneticSpringK: 50,
      magneticDamping: 10,
    },
  },
  {
    // Strong attractor + loose spring + low damping = sustained pitch
    // undulation around a held target.
    id: 'builtin-vibrato',
    name: 'Vibrato',
    settings: {
      magneticStrength: 0.9,
      magneticSpringK: 18,
      magneticDamping: 1.5,
    },
  },
] as const);

/** localStorage key for user-saved presets. */
export const USER_SNAP_PRESETS_STORAGE_KEY = 'slidesynth.snapPresets';

/** Load user presets from localStorage. Per-field validation; bad entries are
 *  dropped. Presets saved before 13.2 also carry `enabled` / `magneticEnabled`;
 *  those keys are simply not read, so old entries load as feel-only. */
export function loadUserSnapPresets(): SnapPreset[] {
  try {
    const raw = localStorage.getItem(USER_SNAP_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((p: unknown): SnapPreset[] => {
      if (!p || typeof p !== 'object') return [];
      const obj = p as Record<string, unknown>;
      if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || !obj.settings) return [];
      const s = obj.settings as Record<string, unknown>;
      const settings: SnapPresetSettings = {};
      if (typeof s.magneticStrength === 'number' && Number.isFinite(s.magneticStrength)) {
        settings.magneticStrength = Math.max(0, Math.min(1, s.magneticStrength));
      }
      if (typeof s.magneticSpringK === 'number' && Number.isFinite(s.magneticSpringK)) {
        settings.magneticSpringK = Math.max(1, Math.min(50, s.magneticSpringK));
      }
      if (typeof s.magneticDamping === 'number' && Number.isFinite(s.magneticDamping)) {
        settings.magneticDamping = Math.max(0.25, Math.min(15, s.magneticDamping));
      }
      return [{ id: obj.id, name: obj.name, settings }];
    });
  } catch {
    return [];
  }
}

export function saveUserSnapPresets(presets: SnapPreset[]): void {
  try {
    localStorage.setItem(USER_SNAP_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Silently ignore — preset just won't persist.
  }
}

/** Given the current snap settings, return true iff every overridden field in
 *  `preset.settings` matches the live value. Used to detect "(modified)" state.
 *  Only the feel fields participate, so a preset can read as selected while
 *  Magnetic is off — the name describes the stored feel, not the toggle state. */
export function presetMatches(preset: SnapPreset, live: SnapSettings): boolean {
  const s = preset.settings;
  if (s.magneticStrength !== undefined && Math.abs(s.magneticStrength - live.magneticStrength) > 1e-6) return false;
  if (s.magneticSpringK !== undefined && Math.abs(s.magneticSpringK - live.magneticSpringK) > 1e-6) return false;
  if (s.magneticDamping !== undefined && Math.abs(s.magneticDamping - live.magneticDamping) > 1e-6) return false;
  return true;
}

/** Snapshot the current live feel into a new user preset. */
export function snapshotPreset(name: string, live: SnapSettings): SnapPreset {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    settings: {
      magneticStrength: live.magneticStrength,
      magneticSpringK: live.magneticSpringK,
      magneticDamping: live.magneticDamping,
    },
  };
}
