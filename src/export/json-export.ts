import type { Composition, Lane, LanePoint, SnapSettings, ToneDefinition } from '../types';
import { createDefaultSnapSettings } from '../model/composition';
import { LANE_SPECS } from '../model/lane';
import { ALL_NOTES, TWELVE_EDO, getScale, type TuningRef } from '../tuning/tuning';

export const COMPOSITION_VERSION = 5;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── .gliss envelope ─────────────────────────────────────────────
// On-disk shape (formatVersion 2 ⇔ internal composition v5; formatVersion 1
// files carry v4, whose Key + Scale settings migrate on load — see
// migrateSnapSettings):
//   { app, formatVersion, kind, meta?, tuning?, snap?, composition }
// `tuning` and `snap` are lifted out of the flat Composition so preset packs
// (.glisskit, future) can carry them without a composition, and so a gallery
// can read `meta` cheaply. The internal Composition type keeps its flat shape
// — the envelope is purely a serialization concern.

export const GLISS_APP_ID = 'glissandograph';
export const GLISS_FORMAT_VERSION = 2;

interface GlissEnvelope {
  app: typeof GLISS_APP_ID;
  formatVersion: number;
  kind: 'composition';
  meta?: { name?: string; savedAt?: string };
  tuning?: { referenceOffsetCents?: number };
  snap?: { settings?: Composition['snap']; guides?: Composition['guides'] };
  composition: Omit<Composition, 'name' | 'snap' | 'guides' | 'tuningOffsetCents'>;
}

/**
 * Serialize a composition to a .gliss envelope JSON string.
 */
export function serializeComposition(comp: Composition): string {
  const { name, snap, guides, tuningOffsetCents, ...core } = comp;
  const envelope: GlissEnvelope = {
    app: GLISS_APP_ID,
    formatVersion: GLISS_FORMAT_VERSION,
    kind: 'composition',
    meta: { name, savedAt: new Date().toISOString() },
    tuning: { referenceOffsetCents: tuningOffsetCents },
    snap: { settings: snap, guides },
    composition: { ...core, version: COMPOSITION_VERSION },
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a composition from JSON string. Accepts both the .gliss
 * envelope (formatVersion 1) and legacy flat v1–v3 JSON saves.
 */
export function deserializeComposition(json: string): Composition {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (parsed && parsed.app === GLISS_APP_ID) {
    return compositionFromEnvelope(parsed as unknown as GlissEnvelope);
  }
  return migrateLegacyComposition(parsed as unknown as Composition);
}

/** Fold a .gliss envelope back onto the flat internal Composition shape. */
function compositionFromEnvelope(env: GlissEnvelope): Composition {
  if (typeof env.formatVersion !== 'number' || env.formatVersion > GLISS_FORMAT_VERSION) {
    throw new Error(
      `This .gliss file uses format version ${env.formatVersion}, which is newer than ` +
      `this app understands (${GLISS_FORMAT_VERSION}). Update the app to open it.`,
    );
  }
  if (!env.composition || !Array.isArray((env.composition as Composition).tracks)) {
    throw new Error('Invalid .gliss file: missing composition section');
  }
  const comp: Composition = {
    ...(env.composition as Composition),
    name: env.meta?.name ?? 'Untitled',
    snap: migrateSnapSettings(env.snap?.settings),
    guides: env.snap?.guides ?? [],
    tuningOffsetCents: env.tuning?.referenceOffsetCents ?? 0,
  };
  comp.version = COMPOSITION_VERSION;
  return comp;
}

/**
 * Migrate a legacy flat v1–v3 composition JSON to the current in-memory shape.
 */
function migrateLegacyComposition(data: Composition): Composition {
  if (!data.version || !data.tracks || !data.toneLibrary) {
    throw new Error('Invalid composition file');
  }

  // Backfill additive fields on older saves
  if (typeof data.loopStartBeats !== 'number') data.loopStartBeats = 0;
  if (typeof data.loopEndBeats !== 'number') data.loopEndBeats = 2 * data.beatsPerMeasure;
  if (typeof data.timeSignatureDenominator !== 'number') data.timeSignatureDenominator = 4;

  // Migrate Phase-1 chord groupings: chordGroupId → groupId.
  for (const track of data.tracks) {
    for (const curve of track.curves as Array<{ chordGroupId?: string | null; groupId?: string | null }>) {
      if (curve.chordGroupId !== undefined && curve.groupId === undefined) {
        curve.groupId = curve.chordGroupId;
      }
      delete curve.chordGroupId;
    }
  }

  // v2 → v3: per-point `volume` migrates to an independent `parameters.volume`
  // envelope. The lane mirrors each pitch point's beat with that point's old
  // volume, using straight segments (null handles) so the piecewise-linear
  // sampling is byte-identical to the old per-point interpolation. v3 curves
  // (already carrying a volume envelope) pass through untouched. v4+ curves
  // (lanes model, no `points` array) skip this step entirely.
  for (const track of data.tracks) {
    for (const curve of track.curves as unknown as Array<{
      points?: Array<{ position: { x: number; y: number }; volume?: number }>;
      parameters?: { volume?: { points: LanePoint[] } };
    }>) {
      if (!curve.points) continue;
      const needsMigration = !curve.parameters?.volume &&
        curve.points.some(p => typeof p.volume === 'number');
      if (needsMigration) {
        curve.parameters = {
          ...curve.parameters,
          volume: {
            points: curve.points.map(p => ({
              position: { x: p.position.x, y: clamp01(p.volume ?? 0.8) },
              handleIn: null,
              handleOut: null,
            })),
          },
        };
      }
      // Drop the obsolete per-point field regardless (keeps re-saved files clean).
      for (const p of curve.points) delete p.volume;
    }
  }

  // v1 → v2: per-composition snap settings + guides. v1 files had no `snap` block;
  // seed from the documented defaults so legacy saves open with the historical
  // global defaults rather than whatever the user had set in their session.
  data.snap = migrateSnapSettings(data.snap);
  if (!Array.isArray(data.guides)) {
    data.guides = [];
  }
  // 8.27: tuningOffsetCents added as a v2-additive field. Older saves default
  // to 0 (A=440), preserving existing pitch behaviour on load.
  if (typeof data.tuningOffsetCents !== 'number') {
    data.tuningOffsetCents = 0;
  }

  // v3 → v4: unified lanes model + cents pitch canon. `points` (Y = MIDI note)
  // becomes the mandatory pitch lane (lanes[0]) with Y scaled ×100 into cents;
  // `parameters.volume` becomes the volume lane (values unchanged). Y-oriented
  // guides scale the same way. Curves already carrying `lanes` pass through
  // untouched, and the guide scaling is gated on the pre-migration version so
  // re-deserializing a v4 file never double-scales.
  const preMigrationVersion = data.version;
  migrateV3ToV4(data);
  if (preMigrationVersion < 4) {
    for (const g of data.guides) {
      if (g.orientation === 'y') g.position *= 100;
    }
  }

  // All migrations applied — the in-memory composition is now current-version.
  data.version = COMPOSITION_VERSION;

  return data;
}

/** The Key + Scale settings files saved before 13.8 (composition v4 and
 *  older): a 12-EDO root 0–11 (null for Chromatic / None) and a scale id that
 *  could also name a tuning. */
interface LegacyKeySettings {
  scaleRoot?: number | null;
  scaleId?: string | null;
  hidePitchLines?: boolean;
}

/** Old scale ids that were really tunings (13.8), and the tuning each became.
 *  Where the tuning's degrees include every 12-EDO note (24-EDO), the old root
 *  stays a root; otherwise the tuning is tuned from the old root. */
const LEGACY_TUNINGS: Record<string, { tuning: TuningRef; scaleId: string; rootInDegrees: number | null }> = {
  '24tet': { tuning: { kind: 'edo', divisions: 24, equave: 'octave' }, scaleId: ALL_NOTES, rootInDegrees: 2 },
  'maqam-rast': { tuning: { kind: 'edo', divisions: 24, equave: 'octave' }, scaleId: 'maqam-rast', rootInDegrees: 2 },
  'maqam-bayati': { tuning: { kind: 'edo', divisions: 24, equave: 'octave' }, scaleId: 'maqam-bayati', rootInDegrees: 2 },
  'thai-7tet': { tuning: { kind: 'edo', divisions: 7, equave: 'octave' }, scaleId: ALL_NOTES, rootInDegrees: null },
  'slendro': { tuning: { kind: 'table', id: 'slendro' }, scaleId: ALL_NOTES, rootInDegrees: null },
  'pelog': { tuning: { kind: 'table', id: 'pelog' }, scaleId: ALL_NOTES, rootInDegrees: null },
};

/**
 * Snap settings from any file version, in the current shape. Pre-13.8 Key +
 * Scale settings map to the tuning / root / scale that plays the same notes:
 * - Key None → 12-EDO, pitch lines hidden; Key Chromatic → 12-EDO, All notes;
 * - Key 0–11 + a 12-note scale → 12-EDO, that root, that scale (the old
 *   "Chromatic" scale is All notes);
 * - the old microtonal "scales" become their tunings (LEGACY_TUNINGS).
 * Missing settings (v1 files) take the defaults.
 */
export function migrateSnapSettings(raw: unknown): SnapSettings {
  const defaults = createDefaultSnapSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const snap = { ...defaults, ...(raw as Partial<SnapSettings>) };
  if ((raw as Partial<SnapSettings>).tuning) return snap;

  const legacy = raw as LegacyKeySettings;
  delete (snap as LegacyKeySettings).scaleRoot;
  snap.tuning = { ...TWELVE_EDO };
  snap.root = 0;
  snap.scaleId = ALL_NOTES;
  snap.tunedFrom = 0;
  snap.hidePitchLines = false;
  const oldRoot = typeof legacy.scaleRoot === 'number' ? ((legacy.scaleRoot % 12) + 12) % 12 : null;
  if (oldRoot === null) {
    snap.hidePitchLines = legacy.hidePitchLines === true;
    return snap;
  }
  const asTuning = legacy.scaleId ? LEGACY_TUNINGS[legacy.scaleId] : undefined;
  if (asTuning) {
    snap.tuning = { ...asTuning.tuning };
    snap.scaleId = asTuning.scaleId;
    if (asTuning.rootInDegrees === null) snap.tunedFrom = oldRoot;
    else snap.root = oldRoot * asTuning.rootInDegrees;
    return snap;
  }
  snap.root = oldRoot;
  const scale = legacy.scaleId ? getScale(legacy.scaleId) : undefined;
  snap.scaleId = scale && scale.size === 12 ? scale.id : ALL_NOTES;
  return snap;
}

/** Convert v3 curves (points + parameters, MIDI-note Y) to the v4 lanes model
 *  (cents Y), in place. Bezier handles are RELATIVE offsets in the same Y unit
 *  as the anchors, so their Y components scale ×100 too — miss that and every
 *  migrated curve's shape distorts. */
function migrateV3ToV4(data: Composition): void {
  const pitchSpec = LANE_SPECS.pitch;
  const volumeSpec = LANE_SPECS.volume;
  const scalePoint = (p: LanePoint): LanePoint => ({
    position: { x: p.position.x, y: p.position.y * 100 },
    handleIn: p.handleIn ? { x: p.handleIn.x, y: p.handleIn.y * 100 } : null,
    handleOut: p.handleOut ? { x: p.handleOut.x, y: p.handleOut.y * 100 } : null,
  });
  for (const track of data.tracks) {
    for (const curve of track.curves as unknown as Array<{
      lanes?: Lane[];
      points?: LanePoint[];
      parameters?: { volume?: { points: LanePoint[] } };
    }>) {
      if (Array.isArray(curve.lanes)) continue; // already v4
      const lanes: Lane[] = [{
        type: 'pitch',
        unit: pitchSpec.unit,
        range: [pitchSpec.range[0], pitchSpec.range[1]],
        points: (curve.points ?? []).map(scalePoint),
      }];
      if (curve.parameters?.volume) {
        lanes.push({
          type: 'volume',
          unit: volumeSpec.unit,
          range: [volumeSpec.range[0], volumeSpec.range[1]],
          points: curve.parameters.volume.points,
        });
      }
      curve.lanes = lanes;
      delete curve.points;
      delete curve.parameters;
    }
  }
}

/**
 * Serialize tone library to JSON string.
 */
export function serializeToneLibrary(tones: ToneDefinition[]): string {
  return JSON.stringify(tones, null, 2);
}

/**
 * Deserialize tone library from JSON string.
 */
export function deserializeToneLibrary(json: string): ToneDefinition[] {
  const data = JSON.parse(json) as ToneDefinition[];
  if (!Array.isArray(data) || data.length === 0 || !data[0]?.id) {
    throw new Error('Invalid tone library file');
  }
  return data;
}

/**
 * Trigger a browser download of a string as a file.
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker and read the selected file as text.
 */
export function openFile(accept: string = '.json'): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    input.click();
  });
}

/**
 * Open a file picker and read the selected file as an ArrayBuffer.
 * Used for binary formats like MIDI.
 */
export function openBinaryFile(accept: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    input.click();
  });
}
