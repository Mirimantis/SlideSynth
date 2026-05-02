import type { SnapSettings } from '../types';

/**
 * Snap presets — named bundles of snap-section settings that the user can load
 * with one click. Presets carry a *partial* of SnapSettings: only the fields
 * they intend to override get applied. Notably, presets never touch
 * `scaleRoot` / `scaleId` — picking a scale is an orthogonal user choice that
 * a "snap feel" preset shouldn't clobber.
 */
export type SnapPresetSettings = Partial<Omit<SnapSettings, 'scaleRoot' | 'scaleId'>>;

export interface SnapPreset {
  id: string;            // stable id (built-ins use 'builtin-*'; user presets use 'user-*<timestamp>')
  name: string;
  settings: SnapPresetSettings;
}

/**
 * Built-in starter set. Frozen so accidental mutation doesn't bleed across loads.
 * Names map to a recognisable "feel" rather than a specific tuning combo.
 */
export const BUILTIN_SNAP_PRESETS: readonly SnapPreset[] = Object.freeze([
  {
    id: 'builtin-free-draw',
    name: 'Free Draw',
    settings: {
      enabled: false,
      magneticEnabled: false,
    },
  },
  {
    id: 'builtin-chromatic',
    name: 'Chromatic 1/16',
    settings: {
      enabled: true,
      magneticEnabled: false,
    },
  },
  {
    id: 'builtin-magnetic-tight',
    name: 'Magnetic On-Pitch',
    settings: {
      enabled: true,
      magneticEnabled: true,
      magneticStrength: 0.85,
      magneticSpringK: 35,
      magneticDamping: 4,
    },
  },
  {
    id: 'builtin-magnetic-loose',
    name: 'Magnetic + Diatonic',
    settings: {
      enabled: true,
      magneticEnabled: true,
      magneticStrength: 0.7,
      magneticSpringK: 22,
      magneticDamping: 2.5,
    },
  },
] as const);

/** localStorage key for user-saved presets. */
export const USER_SNAP_PRESETS_STORAGE_KEY = 'slidesynth.snapPresets';

/** Load user presets from localStorage. Per-field validation; bad entries are dropped. */
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
      if (typeof s.enabled === 'boolean') settings.enabled = s.enabled;
      if (typeof s.magneticEnabled === 'boolean') settings.magneticEnabled = s.magneticEnabled;
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
 *  `preset.settings` matches the live value. Used to detect "(modified)" state. */
export function presetMatches(preset: SnapPreset, live: SnapSettings): boolean {
  const s = preset.settings;
  if (s.enabled !== undefined && s.enabled !== live.enabled) return false;
  if (s.magneticEnabled !== undefined && s.magneticEnabled !== live.magneticEnabled) return false;
  if (s.magneticStrength !== undefined && Math.abs(s.magneticStrength - live.magneticStrength) > 1e-6) return false;
  if (s.magneticSpringK !== undefined && Math.abs(s.magneticSpringK - live.magneticSpringK) > 1e-6) return false;
  if (s.magneticDamping !== undefined && Math.abs(s.magneticDamping - live.magneticDamping) > 1e-6) return false;
  return true;
}

/** Snapshot the current live settings (excluding scale) into a new user preset. */
export function snapshotPreset(name: string, live: SnapSettings): SnapPreset {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    settings: {
      enabled: live.enabled,
      magneticEnabled: live.magneticEnabled,
      magneticStrength: live.magneticStrength,
      magneticSpringK: live.magneticSpringK,
      magneticDamping: live.magneticDamping,
    },
  };
}
