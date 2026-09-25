import type { AppState, BezierCurve, Composition, GuideDefinition, PlanchetteState, SnapSettings, ToolMode, TransportState, ViewportState, HarmonicPrismMode, DynamicsSource } from '../types';
import { DYNAMICS_SOURCES } from '../types';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { DEFAULT_ZOOM_X, DEFAULT_ZOOM_Y, MAX_PITCH_CENTS, AUTO_SMOOTH_X_RATIO } from '../constants';
import { DEFAULT_CHORD_SPEC, type ChordSpec } from '../utils/harmonics';
import { batch, signal, type Signal } from './reactive';
import { TRANSPORT_STOPPED } from './transport';
import { NO_POINTS, addPoints, onlyPoint, togglePoint, withoutCurves, type PointRef, type PointSelection } from '../model/point-selection';

// ── How the store works (BACKLOG 15.1) ─────────────────────────────
// Reads are unchanged: `store.getState().x`. Underneath, every top-level field
// has a *version signal*, and getState() returns a view whose properties are
// accessors that read that version before returning the value. So a read inside
// an `effect` / `watch` / `computed` (from ./reactive) subscribes to exactly the
// fields it touches, and a setter bumps only the fields it changed. There is
// deliberately no catch-all subscribe.
//
// Nested objects (composition, performance, harmonicPrism, …) keep stable
// references and are mutated in place — many call sites cache e.g.
// `const g = st.performance` across setter calls — so a setter bumps the
// field's version rather than replacing the object.
//
// State comes in three kinds:
//   document   — `composition` (undoable, saved to .gliss). The snap fields are
//                read-only views of `composition.snap` with their own channel.
//   workspace  — preferences persisted to localStorage (HUDs, metronome, …).
//   runtime    — selection, tool, transport, performance, planchettes.
//
// A few runtime values change at frame or mouse rate and are drawn only on the
// canvas: planchette pitch, the snap-crossing pulse, the stored playhead. They
// skip their fields' channels, so panels don't re-render at 60 Hz, and notify
// the `canvas` channel instead, which only the render loop's dirty flag reads
// (15.5).

/** AppState fields that are views of `composition.snap`, not stored copies. */
const SNAP_VIEW_FIELDS = {
  snapEnabled: 'enabled',
  scaleRoot: 'scaleRoot',
  scaleId: 'scaleId',
  hidePitchLines: 'hidePitchLines',
  magneticEnabled: 'magneticEnabled',
  magneticStrength: 'magneticStrength',
  magneticSpringK: 'magneticSpringK',
  magneticDamping: 'magneticDamping',
} as const satisfies Record<string, keyof SnapSettings>;

type SnapViewKey = keyof typeof SNAP_VIEW_FIELDS;
type RawState = Omit<AppState, SnapViewKey>;
/** A notification channel: one per stored field, `snap` for composition.snap,
 *  and `canvas` for the canvas-only runtime values. */
type Channel = keyof RawState | 'snap' | 'canvas';

/** Planchette pitch changes smaller than this (cents) don't ask for a redraw —
 *  magnetic physics settles asymptotically and would otherwise keep the canvas
 *  redrawing a still planchette. */
const PLANCHETTE_REDRAW_EPSILON = 0.01;

function planchetteMoved(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > PLANCHETTE_REDRAW_EPSILON;
}

/** Every selection field. Selection setters bump them together — over-bumping
 *  is harmless because watchers compare values before doing any work. */
const SELECTION: readonly Channel[] = [
  'selectedTrackId', 'selectedCurveIds', 'selectedPointIndex', 'selectedPoints', 'selectedGuideId',
];

function createInitialPrimaryPlanchette(trackId: string | null): PlanchetteState {
  return {
    voiceId: 'primary',
    trackId,
    cursorWorldY: null,
    snappedWorldY: null,
    lastCrossedAt: 0,
  };
}

// A new key, not a migration: the old `slidesynth.scrollCanvas` (Lock Rail)
// also meant "the left button performs while playing", which Perform mode now
// owns (BACKLOG 16.2). Carrying it over would leave most users editing on a
// scrolling canvas they never asked for, so the view option starts off.
const SCROLL_CANVAS_STORAGE_KEY = 'slidesynth.scrollDuringPlayback';
try { localStorage.removeItem('slidesynth.scrollCanvas'); } catch { /* ignore */ }
const LAYER_MODE_STORAGE_KEY = 'slidesynth.layerMode';
const PITCH_HUD_STORAGE_KEY = 'slidesynth.pitchHud';
const PERF_HUD_STORAGE_KEY = 'slidesynth.perfHud';
const METRONOME_ENABLED_STORAGE_KEY = 'slidesynth.metronomeEnabled';
const METRONOME_VOLUME_STORAGE_KEY = 'slidesynth.metronomeVolume';
const AUTO_SMOOTH_X_RATIO_STORAGE_KEY = 'slidesynth.autoSmoothXRatio';
const PRISM_CHORD_SPEC_STORAGE_KEY = 'slidesynth.prismChordSpec';
const PRISM_OCTAVE_RANGE_STORAGE_KEY = 'slidesynth.prismOctaveRange';
const PRISM_DRAW_MODE_STORAGE_KEY = 'slidesynth.prismDrawMode';
const GUIDES_VISIBLE_STORAGE_KEY = 'slidesynth.guidesVisible';
const GUIDES_LOCKED_STORAGE_KEY = 'slidesynth.guidesLocked';
const DYNAMICS_SOURCE_STORAGE_KEY = 'slidesynth.dynamicsSource';

function loadBoolPref(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === 'true';
  } catch {
    return defaultValue;
  }
}

function saveBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Silently ignore — preference just won't persist.
  }
}

function loadNumberPref(key: string, defaultValue: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveNumberPref(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Silently ignore — preference just won't persist.
  }
}

/** Load a string preference, falling back to the default unless the stored
 *  value is still one this build recognises. */
function loadStringPref<T extends string>(key: string, allowed: readonly T[], defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return (allowed as readonly string[]).includes(raw) ? raw as T : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveStringPref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently ignore — preference just won't persist.
  }
}

function loadChordSpecPref(defaultSpec: ChordSpec): ChordSpec {
  try {
    const raw = localStorage.getItem(PRISM_CHORD_SPEC_STORAGE_KEY);
    if (raw === null) return { ...defaultSpec };
    const parsed = JSON.parse(raw);
    // Shallow validation: only accept fields we recognize; fall back per-field.
    return {
      stacking: parsed.stacking ?? defaultSpec.stacking,
      quality: parsed.quality ?? defaultSpec.quality,
      numVoices: parsed.numVoices ?? defaultSpec.numVoices,
      tuning: parsed.tuning ?? defaultSpec.tuning,
      direction: parsed.direction ?? defaultSpec.direction,
      // 8.13: pre-8.13 entries lack this field — fall back to the default ([]).
      voiceOctaveOffsets: Array.isArray(parsed.voiceOctaveOffsets)
        ? parsed.voiceOctaveOffsets.filter((n: unknown): n is number => typeof n === 'number' && Number.isFinite(n))
        : defaultSpec.voiceOctaveOffsets,
    };
  } catch {
    return { ...defaultSpec };
  }
}

function saveChordSpecPref(spec: ChordSpec): void {
  try {
    localStorage.setItem(PRISM_CHORD_SPEC_STORAGE_KEY, JSON.stringify(spec));
  } catch {
    // Silently ignore.
  }
}

/** One-time migration (Phase 8.5): if the user had legacy localStorage values for the
 *  four magnetic params, seed the initial composition's snap block with them so their
 *  tuning isn't reset on first load with the v2 code. Cleans the keys after reading
 *  so this only runs once. Returns nothing — mutates the composition in place. */
function migrateLegacyMagneticPrefs(comp: Composition): void {
  const legacyKeys = [
    ['slidesynth.magneticEnabled',  'magneticEnabled',  (raw: string) => raw === 'true'] as const,
    ['slidesynth.magneticStrength', 'magneticStrength', (raw: string) => Math.max(0, Math.min(1, Number(raw)))] as const,
    ['slidesynth.magneticSpringK',  'magneticSpringK',  (raw: string) => Math.max(1, Math.min(50, Number(raw)))] as const,
    ['slidesynth.magneticDamping',  'magneticDamping',  (raw: string) => Math.max(0.25, Math.min(15, Number(raw)))] as const,
  ];
  let migrated = false;
  for (const [key, field, parse] of legacyKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const v = parse(raw);
      if (typeof v === 'boolean' || Number.isFinite(v)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (comp.snap as any)[field] = v;
        migrated = true;
      }
      localStorage.removeItem(key);
    } catch {
      // Silently ignore — user just gets the defaults.
    }
  }
  if (migrated) {
    // Log once so it's discoverable when a user reports "my settings changed".
    console.info('[snap migration] Seeded composition.snap from legacy magnetic localStorage keys.');
  }
}

function createInitialState(): RawState {
  const composition = createComposition();
  migrateLegacyMagneticPrefs(composition);
  return {
    // ── document ──
    composition,
    // ── runtime ──
    selectedTrackId: null,
    selectedCurveIds: new Set(),
    selectedPointIndex: null,
    selectedPoints: NO_POINTS,
    selectedGuideId: null,
    activeTool: 'draw',
    transport: { ...TRANSPORT_STOPPED },
    performance: {
      lmbSounding: false,
      planchettes: [createInitialPrimaryPlanchette(null)],
      currentRecordedCurveIds: { primary: null },
    },
    viewport: {
      offsetX: 0,
      offsetY: MAX_PITCH_CENTS,
      zoomX: DEFAULT_ZOOM_X,
      zoomY: DEFAULT_ZOOM_Y,
    },
    playback: {
      positionBeats: 0,
    },
    loopEnabled: false,
    // Phase 8.11 — MIDI input recording arm. Not persisted (record-arm
    // shouldn't silently re-engage on app reload).
    midiArmedTrackId: null,
    performMode: false,
    drawPreviewMode: 'tone',
    bezierAutoSmooth: false,
    // ── workspace (localStorage) ──
    guidesVisible: loadBoolPref(GUIDES_VISIBLE_STORAGE_KEY, true),
    guidesLocked: loadBoolPref(GUIDES_LOCKED_STORAGE_KEY, false),
    scrollCanvasEnabled: loadBoolPref(SCROLL_CANVAS_STORAGE_KEY, false),
    layerModeEnabled: loadBoolPref(LAYER_MODE_STORAGE_KEY, false),
    pitchHudVisible: loadBoolPref(PITCH_HUD_STORAGE_KEY, true),
    perfHudVisible: loadBoolPref(PERF_HUD_STORAGE_KEY, false),
    metronomeEnabled: loadBoolPref(METRONOME_ENABLED_STORAGE_KEY, false),
    metronomeVolume: loadNumberPref(METRONOME_VOLUME_STORAGE_KEY, 0.6),
    autoSmoothXRatio: Math.max(0, Math.min(1, loadNumberPref(AUTO_SMOOTH_X_RATIO_STORAGE_KEY, AUTO_SMOOTH_X_RATIO))),
    dynamicsSource: loadStringPref(DYNAMICS_SOURCE_STORAGE_KEY, DYNAMICS_SOURCES, 'fixed'),
    harmonicPrism: {
      chordSpec: loadChordSpecPref(DEFAULT_CHORD_SPEC),
      projectionOctaveRange: Math.max(0, Math.min(3, Math.round(loadNumberPref(PRISM_OCTAVE_RANGE_STORAGE_KEY, 2)))),
      activeMode: null,
      projectionSourceId: null,
      drawMode: loadBoolPref(PRISM_DRAW_MODE_STORAGE_KEY, false),
    },
  };
}

class Store {
  /** The stored state. Mutate only inside setters, then `touch` its channels. */
  private state: RawState;
  private readonly versions = new Map<Channel, Signal<number>>();
  /** What getState() hands out: tracked accessors over `state`. */
  private readonly view: AppState;

  constructor() {
    this.state = createInitialState();
    for (const key of Object.keys(this.state) as (keyof RawState)[]) this.versions.set(key, signal(0));
    this.versions.set('snap', signal(0));
    this.versions.set('canvas', signal(0));

    const view = {} as AppState;
    for (const key of Object.keys(this.state) as (keyof RawState)[]) {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => {
          void this.version(key).value;
          return this.state[key];
        },
      });
    }
    for (const [key, field] of Object.entries(SNAP_VIEW_FIELDS) as [SnapViewKey, keyof SnapSettings][]) {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: () => {
          void this.version('snap').value;
          return this.state.composition.snap[field];
        },
      });
    }
    this.view = view;

    // Auto-select first track
    const firstTrack = this.state.composition.tracks[0];
    if (firstTrack) {
      this.state.selectedTrackId = firstTrack.id;
      this.state.performance.planchettes[0]!.trackId = firstTrack.id;
    }
  }

  private version(channel: Channel): Signal<number> {
    return this.versions.get(channel)!;
  }

  /** Notify everything that read these channels. Batched, so watchers that read
   *  several of them run once. */
  private touch(...channels: readonly Channel[]): void {
    if (channels.includes('composition') && this.dropMissingProjectionSource()) {
      channels = [...channels, 'harmonicPrism'];
    }
    batch(() => {
      for (const c of channels) this.version(c).value++;
    });
  }

  /** Invariant: the Prism projection source is a curve that exists. Checked on
   *  every composition change (delete, cut, join, undo, load, …) instead of by
   *  the render loop (15.5). Returns true if it cleared the source. */
  private dropMissingProjectionSource(): boolean {
    const prism = this.state.harmonicPrism;
    const id = prism.projectionSourceId;
    if (!id || this.state.composition.tracks.some(t => t.curves.some(c => c.id === id))) return false;
    prism.projectionSourceId = null;
    if (prism.activeMode === 'projection') prism.activeMode = null;
    return true;
  }

  /** Subscribe to every channel. Only for the canvas renderer's dirty flag,
   *  since the canvas draws nearly all state (15.5); UI code reads just the
   *  fields it shows. */
  trackAllChannels(): void {
    for (const v of this.versions.values()) void v.value;
  }

  /** Current composition version, untracked. Bumps on every composition change,
   *  so it keys caches of derived geometry (the renderer's curve paths). */
  compositionVersion(): number {
    return this.version('composition').peek();
  }

  getState(): AppState {
    return this.view;
  }

  getComposition(): Composition {
    return this.view.composition;
  }

  // ── Mutations ───────────────────────────────────────────────

  setSelectedTrack(trackId: string | null) {
    this.state.selectedTrackId = trackId;
    this.state.selectedCurveIds = new Set();
    this.state.selectedPointIndex = null;
    this.state.selectedPoints = NO_POINTS;
    this.state.selectedGuideId = null;
    // Keep the primary planchette pointing at the selected track for recording/sounding.
    const primary = this.state.performance.planchettes.find(p => p.voiceId === 'primary');
    if (primary) primary.trackId = trackId;
    this.touch(...SELECTION, 'performance');
  }

  /** Replace selection with a single curve (or clear). */
  setSelectedCurve(curveId: string | null) {
    this.state.selectedCurveIds = curveId ? new Set([curveId]) : new Set();
    this.state.selectedPointIndex = null;
    this.state.selectedPoints = NO_POINTS;
    if (curveId !== null) this.state.selectedGuideId = null;
    this.touch(...SELECTION);
  }

  /** Replace selection with multiple curves. */
  setSelectedCurves(curveIds: string[]) {
    this.state.selectedCurveIds = new Set(curveIds);
    this.state.selectedPointIndex = null;
    this.state.selectedPoints = NO_POINTS;
    if (curveIds.length > 0) this.state.selectedGuideId = null;
    this.touch(...SELECTION);
  }

  /** Add a curve to the selection (Shift+click). */
  addSelectedCurve(curveId: string) {
    this.state.selectedCurveIds.add(curveId);
    this.state.selectedPointIndex = null;
    this.touch(...SELECTION);
  }

  /** Toggle a curve in/out of the selection (Shift+click). */
  toggleSelectedCurve(curveId: string) {
    if (this.state.selectedCurveIds.has(curveId)) {
      this.state.selectedCurveIds.delete(curveId);
    } else {
      this.state.selectedCurveIds.add(curveId);
    }
    this.state.selectedPointIndex = null;
    // Curve-level toggle clears point selection: the multi-point set is a
    // separate selection mode and shouldn't survive a curve-toggle keystroke.
    this.state.selectedPoints = NO_POINTS;
    this.touch(...SELECTION);
  }

  /** Convenience: get the single selected curve ID, or null if 0 or 2+. */
  getSelectedCurveId(): string | null {
    const ids = this.view.selectedCurveIds;
    if (ids.size === 1) {
      return [...ids][0]!;
    }
    return null;
  }

  setSelectedPoint(index: number | null) {
    this.state.selectedPointIndex = index;
    this.touch(...SELECTION);
  }

  // ── Multi-point selection (BACKLOG 8.3) ────────────────────────

  /** Derive the "primary" point index from the multi-point selection: set iff
   *  exactly one point is selected and it's on the single selected curve (so
   *  handles render); multi-point mode doesn't draw handles. */
  private syncPrimaryPointIndex(): void {
    const only = onlyPoint(this.state.selectedPoints);
    const ids = this.state.selectedCurveIds;
    const single = ids.size === 1 ? [...ids][0]! : null;
    this.state.selectedPointIndex = only && only.curveId === single ? only.index : null;
  }

  /** Replace the multi-point selection. Caller is responsible for keeping
   *  `selectedCurveIds` in sync (see syncSelectedCurvesFromPoints). */
  setSelectedPoints(sel: PointSelection) {
    this.state.selectedPoints = sel;
    this.syncPrimaryPointIndex();
    this.touch(...SELECTION);
  }

  /** Toggle a single point in/out of the multi-selection. */
  togglePoint(ref: PointRef) {
    this.setSelectedPoints(togglePoint(this.state.selectedPoints, ref));
  }

  /** Add points to the selection (used by additive marquee drag). */
  addPoints(refs: Iterable<PointRef>) {
    this.setSelectedPoints(addPoints(this.state.selectedPoints, refs));
  }

  /** Drop every selected point. Doesn't touch curve selection. */
  clearPointSelection() {
    if (this.state.selectedPoints.size === 0) return;
    this.state.selectedPoints = NO_POINTS;
    this.touch(...SELECTION);
  }

  /** Sync `selectedCurveIds` to the curves that have selected points, and
   *  re-derive `selectedPointIndex` (the primary index iff exactly one point is
   *  selected on the resulting single selected curve). Used after every
   *  point-selection change so the curve-level selection (which drives curve
   *  highlight + transform-box membership) stays consistent. Does NOT clear
   *  the point selection. */
  syncSelectedCurvesFromPoints() {
    const parents = new Set(this.state.selectedPoints.keys());
    this.state.selectedCurveIds = parents;
    if (parents.size > 0) this.state.selectedGuideId = null;
    this.state.selectedPointIndex = onlyPoint(this.state.selectedPoints)?.index ?? null;
    this.touch(...SELECTION);
  }

  setTool(tool: ToolMode) {
    this.state.activeTool = tool;
    this.touch('activeTool');
  }

  /** Replace the transport state (BACKLOG 15.2). Only the transport
   *  controller in main.ts calls this, with a state produced by
   *  `transition()` in ./transport. */
  setTransport(next: TransportState) {
    const t = this.state.transport;
    if (t.mode === next.mode && t.clock === next.clock && t.capture === next.capture
        && t.countdownStartedAt === next.countdownStartedAt) return;
    this.state.transport = { ...next };
    this.touch('transport');
  }

  /** Arm a track for MIDI input recording. Mutually exclusive — passing a
   *  trackId replaces any existing arm; passing null disarms. Distinct from
   *  setPerformArmed (LMB record-arm). */
  setMidiArmedTrackId(trackId: string | null) {
    if (this.state.midiArmedTrackId === trackId) return;
    this.state.midiArmedTrackId = trackId;
    this.touch('midiArmedTrackId');
  }

  setPerformLmbSounding(on: boolean) {
    this.state.performance.lmbSounding = on;
    this.touch('performance');
  }

  setPlanchetteY(voiceId: string, cursorWorldY: number | null, snappedWorldY: number | null) {
    const p = this.state.performance.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    const moved = planchetteMoved(p.cursorWorldY, cursorWorldY) || planchetteMoved(p.snappedWorldY, snappedWorldY);
    p.cursorWorldY = cursorWorldY;
    p.snappedWorldY = snappedWorldY;
    // Canvas-only: called every frame during mouse-move and magnetic settling.
    if (moved) this.touch('canvas');
  }

  markPlanchetteCrossed(voiceId: string, t: number) {
    const p = this.state.performance.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    p.lastCrossedAt = t;
    this.touch('canvas');
  }

  setPerformCurrentCurve(voiceId: string, curveId: string | null) {
    this.state.performance.currentRecordedCurveIds[voiceId] = curveId;
  }

  /** Add a planchette to the perform array (e.g. harmony voice on LMB-down with Prism Draw). */
  addPerformPlanchette(planchette: PlanchetteState) {
    if (this.state.performance.planchettes.some(p => p.voiceId === planchette.voiceId)) return;
    this.state.performance.planchettes.push(planchette);
    this.touch('performance');
  }

  /** Remove a planchette by voiceId. Primary is never removable here (use a fresh init). */
  removePerformPlanchette(voiceId: string) {
    if (voiceId === 'primary') return;
    const arr = this.state.performance.planchettes;
    const idx = arr.findIndex(p => p.voiceId === voiceId);
    if (idx >= 0) {
      arr.splice(idx, 1);
      this.touch('performance');
    }
  }

  /** Apply a pitch-bend offset (in CENTS) to every MIDI-input planchette's
   *  cursor + snapped Y. Called when the live MIDI pitch-bend wheel moves so
   *  both the visual planchette and the recording sample track the bent pitch
   *  (BACKLOG 8.25). MIDI ingress isn't snap-affected — discrete pitch comes
   *  from the controller, bend is just a continuous offset on top. The voice
   *  id embeds the MIDI note number; planchette Y is cents. */
  setMidiPitchBendOffset(offsetCents: number) {
    let dirty = false;
    for (const p of this.state.performance.planchettes) {
      if (!p.voiceId.startsWith('midi-')) continue;
      const baseNote = Number(p.voiceId.slice('midi-'.length));
      if (!Number.isFinite(baseNote)) continue;
      const bent = baseNote * 100 + offsetCents;
      if (p.cursorWorldY !== bent || p.snappedWorldY !== bent) {
        p.cursorWorldY = bent;
        p.snappedWorldY = bent;
        dirty = true;
      }
    }
    if (dirty) this.touch('performance');
  }

  /** Strip every Harmonic-Prism harmony planchette (chord-cluster cleanup on
   *  LMB-up). Leaves the primary planchette and any MIDI input planchettes
   *  (voice id 'midi-*') alone — those have independent lifecycles. */
  removeHarmonyPlanchettes() {
    const before = this.state.performance.planchettes.length;
    this.state.performance.planchettes = this.state.performance.planchettes
      .filter(p => !p.voiceId.startsWith('harmony-'));
    if (this.state.performance.planchettes.length !== before) this.touch('performance');
  }

  setDrawPreviewMode(mode: 'tone' | 'composition') {
    this.state.drawPreviewMode = mode;
    this.touch('drawPreviewMode');
  }

  setBezierAutoSmooth(enabled: boolean) {
    this.state.bezierAutoSmooth = enabled;
    this.touch('bezierAutoSmooth');
  }

  /** Perform mode (BACKLOG 16.2). What entering and leaving it does to the
   *  transport and the view lives in main.ts's `setPerformMode`. */
  setPerformMode(on: boolean) {
    if (this.state.performMode === on) return;
    this.state.performMode = on;
    this.touch('performMode');
  }

  setScrollCanvas(enabled: boolean) {
    if (this.state.scrollCanvasEnabled === enabled) return;
    this.state.scrollCanvasEnabled = enabled;
    saveBoolPref(SCROLL_CANVAS_STORAGE_KEY, enabled);
    this.touch('scrollCanvasEnabled');
  }

  /** Loop playback on/off (BACKLOG 15.1: state owns this; the playback engine
   *  follows it). Runtime-only — not persisted, matching the old engine flag. */
  setLoopEnabled(enabled: boolean) {
    if (this.state.loopEnabled === enabled) return;
    this.state.loopEnabled = enabled;
    this.touch('loopEnabled');
  }

  /** Layer mode (BACKLOG 10.3): each performed pass commits onto its own track
   *  instead of the selected one. Off by default so ordinary editing and armed
   *  recording onto a chosen track behave as they always have. */
  setLayerMode(enabled: boolean) {
    if (this.state.layerModeEnabled === enabled) return;
    this.state.layerModeEnabled = enabled;
    saveBoolPref(LAYER_MODE_STORAGE_KEY, enabled);
    this.touch('layerModeEnabled');
  }

  setPitchHudVisible(visible: boolean) {
    if (this.state.pitchHudVisible === visible) return;
    this.state.pitchHudVisible = visible;
    saveBoolPref(PITCH_HUD_STORAGE_KEY, visible);
    this.touch('pitchHudVisible');
  }

  setPerfHudVisible(visible: boolean) {
    if (this.state.perfHudVisible === visible) return;
    this.state.perfHudVisible = visible;
    saveBoolPref(PERF_HUD_STORAGE_KEY, visible);
    this.touch('perfHudVisible');
  }

  /** What drives performed volume (BACKLOG 11.1). Workspace preference — the
   *  dynamics bus is a live-input concern, so it never enters the composition. */
  setDynamicsSource(source: DynamicsSource) {
    if (this.state.dynamicsSource === source) return;
    this.state.dynamicsSource = source;
    saveStringPref(DYNAMICS_SOURCE_STORAGE_KEY, source);
    this.touch('dynamicsSource');
  }

  setMetronomeEnabled(enabled: boolean) {
    if (this.state.metronomeEnabled === enabled) return;
    this.state.metronomeEnabled = enabled;
    saveBoolPref(METRONOME_ENABLED_STORAGE_KEY, enabled);
    this.touch('metronomeEnabled');
  }

  setMetronomeVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    if (this.state.metronomeVolume === clamped) return;
    this.state.metronomeVolume = clamped;
    saveNumberPref(METRONOME_VOLUME_STORAGE_KEY, clamped);
    this.touch('metronomeVolume');
  }

  // ── Snap (document state: composition.snap) ────────────────────

  setMagneticEnabled(on: boolean) {
    const snap = this.state.composition.snap;
    if (snap.magneticEnabled === on) return;
    snap.magneticEnabled = on;
    this.touch('snap');
  }

  setMagneticStrength(strength: number) {
    const clamped = Math.max(0, Math.min(1, strength));
    const snap = this.state.composition.snap;
    if (snap.magneticStrength === clamped) return;
    snap.magneticStrength = clamped;
    this.touch('snap');
  }

  setMagneticSpringK(k: number) {
    const clamped = Math.max(1, Math.min(50, k));
    const snap = this.state.composition.snap;
    if (snap.magneticSpringK === clamped) return;
    snap.magneticSpringK = clamped;
    this.touch('snap');
  }

  setMagneticDamping(d: number) {
    const clamped = Math.max(0.25, Math.min(15, d));
    const snap = this.state.composition.snap;
    if (snap.magneticDamping === clamped) return;
    snap.magneticDamping = clamped;
    this.touch('snap');
  }

  setSnap(enabled: boolean) {
    this.state.composition.snap.enabled = enabled;
    this.touch('snap');
  }

  /** Sets the Key dropdown's three-mode state (8.19): a numeric root, Chromatic
   *  (root=null, hidePitchLines=false), or None (root=null, hidePitchLines=true).
   *  hidePitchLines is meaningful only when root is null; selecting a scale tone
   *  forces it to false so the staff lines come back. */
  setScaleRoot(root: number | null, hidePitchLines: boolean = false) {
    const snap = this.state.composition.snap;
    snap.scaleRoot = root;
    snap.hidePitchLines = root === null ? hidePitchLines : false;
    if (root === null) snap.scaleId = null;
    this.touch('snap');
  }

  setScaleId(scaleId: string | null) {
    this.state.composition.snap.scaleId = scaleId;
    this.touch('snap');
  }

  setAutoSmoothXRatio(r: number) {
    const clamped = Math.max(0, Math.min(1, r));
    if (this.state.autoSmoothXRatio === clamped) return;
    this.state.autoSmoothXRatio = clamped;
    saveNumberPref(AUTO_SMOOTH_X_RATIO_STORAGE_KEY, clamped);
    this.touch('autoSmoothXRatio');
  }

  setTimeSignature(numerator: number, denominator: number) {
    if (this.state.composition.beatsPerMeasure === numerator
        && this.state.composition.timeSignatureDenominator === denominator) return;
    this.state.composition.beatsPerMeasure = numerator;
    this.state.composition.timeSignatureDenominator = denominator;
    this.touch('composition');
  }

  setPlaybackPosition(beats: number) {
    if (this.state.playback.positionBeats === beats) return;
    this.state.playback.positionBeats = beats;
    // Canvas-only: called at frame rate during playback and scrubbing.
    this.touch('canvas');
  }

  setViewport(vp: Partial<ViewportState>) {
    Object.assign(this.state.viewport, vp);
    this.touch('viewport');
  }

  setBpm(bpm: number) {
    this.state.composition.bpm = bpm;
    this.touch('composition');
  }

  /** Set the composition's A4 reference offset in cents (0 = A=440). The audio
   *  module's reference frequency is updated separately via setReferenceAHz()
   *  in main.ts so the runtime synth/curve sampler retunes immediately. */
  setTuningOffsetCents(cents: number) {
    this.state.composition.tuningOffsetCents = cents;
    this.touch('composition');
  }

  setLoopStart(beats: number) {
    const comp = this.state.composition;
    // Keep markers at least 0.5 beats apart and loopStart >= 0.
    const clamped = Math.max(0, Math.min(beats, comp.loopEndBeats - 0.5));
    comp.loopStartBeats = clamped;
    this.touch('composition');
  }

  setLoopEnd(beats: number) {
    const comp = this.state.composition;
    const clamped = Math.max(comp.loopStartBeats + 0.5, beats);
    comp.loopEndBeats = clamped;
    this.touch('composition');
  }

  // ── Snap guides (Phase 8.7) ─────────────────────────────────

  setGuidesVisible(visible: boolean): void {
    if (this.state.guidesVisible === visible) return;
    this.state.guidesVisible = visible;
    saveBoolPref(GUIDES_VISIBLE_STORAGE_KEY, visible);
    this.touch('guidesVisible');
  }

  setGuidesLocked(locked: boolean): void {
    if (this.state.guidesLocked === locked) return;
    this.state.guidesLocked = locked;
    // Locking clears any active guide selection so the property panel doesn't
    // continue to advertise an editable label / Delete button on a locked guide.
    if (locked) this.state.selectedGuideId = null;
    saveBoolPref(GUIDES_LOCKED_STORAGE_KEY, locked);
    this.touch('guidesLocked', ...SELECTION);
  }

  /** Select a guide (clears curve/point selection). Pass null to clear. */
  setSelectedGuide(id: string | null): void {
    if (this.state.selectedGuideId === id) return;
    this.state.selectedGuideId = id;
    if (id !== null) {
      this.state.selectedCurveIds = new Set();
      this.state.selectedPointIndex = null;
    }
    this.touch(...SELECTION);
  }

  /** Append a guide to the composition. Caller is responsible for snapshotting history. */
  addGuide(guide: GuideDefinition): void {
    this.state.composition.guides.push(guide);
    this.touch('composition');
  }

  /** Remove a guide. Clears guide selection if it was the selected one. */
  removeGuide(id: string): void {
    const arr = this.state.composition.guides;
    const idx = arr.findIndex(g => g.id === id);
    if (idx < 0) return;
    arr.splice(idx, 1);
    if (this.state.selectedGuideId === id) this.state.selectedGuideId = null;
    this.touch('composition', ...SELECTION);
  }

  /** Patch a guide's mutable fields (label / position). */
  updateGuide(id: string, fields: Partial<Pick<GuideDefinition, 'label' | 'position'>>): void {
    const g = this.state.composition.guides.find(g => g.id === id);
    if (!g) return;
    if (fields.label !== undefined) g.label = fields.label;
    if (fields.position !== undefined) g.position = fields.position;
    this.touch('composition');
  }

  /** Mutate composition directly and notify. Use for curve/track mutations. */
  mutate(fn: (comp: Composition) => void) {
    fn(this.state.composition);
    this.touch('composition');
  }

  /**
   * Move a set of curves from their current track to an existing target track
   * (BACKLOG 8.2). Preserves curve `id` and `groupId` — this is a relocation,
   * not a copy. Caller is responsible for ensuring the curveIds form a single
   * movable unit (see `getMovableSelection`); this method enforces nothing.
   * Re-applies the curve selection on the target track so the user can keep
   * editing. Caller takes the `history.snapshot()`.
   */
  moveCurvesToTrack(curveIds: string[], targetTrackId: string): void {
    if (curveIds.length === 0) return;
    const comp = this.state.composition;
    const target = comp.tracks.find(t => t.id === targetTrackId);
    const source = comp.tracks.find(t => t.curves.some(c => c.id === curveIds[0]));
    if (!source || !target || source === target) return;
    const moved: BezierCurve[] = [];
    for (const id of curveIds) {
      const idx = source.curves.findIndex(c => c.id === id);
      if (idx >= 0) moved.push(source.curves.splice(idx, 1)[0]!);
    }
    target.curves.push(...moved);
    // Follow the moved curves to the target track so the planchette + property
    // panel re-bind there. setSelectedTrack clears curve selection, so re-apply.
    batch(() => {
      this.touch('composition');
      this.setSelectedTrack(targetTrackId);
      this.setSelectedCurves(curveIds);
    });
  }

  /**
   * Create a new track inheriting the tone of the source track (the one that
   * currently contains the first curve), then move the curves into it (8.2).
   * Returns the new track id, or null if the source can't be located.
   * Caller takes the `history.snapshot()`.
   */
  moveCurvesToNewTrack(curveIds: string[], nameOverride?: string): string | null {
    if (curveIds.length === 0) return null;
    const comp = this.state.composition;
    const source = comp.tracks.find(t => t.curves.some(c => c.id === curveIds[0]));
    if (!source) return null;
    const newTrack = createTrack(nameOverride ?? `Track ${comp.tracks.length + 1}`, source.toneId);
    comp.tracks.push(newTrack);
    this.moveCurvesToTrack(curveIds, newTrack.id);
    return newTrack.id;
  }

  /**
   * Remove a track and everything on it (BACKLOG 10.4 — the first code path in
   * the app that deletes a track). Every piece of state that can hold a track
   * id or a curve id from this track has to be swept, or it dangles:
   * selection, MIDI arm, the Prism projection source, and perform planchettes.
   * Caller takes the `history.snapshot()`.
   */
  removeTrack(trackId: string): void {
    const comp = this.state.composition;
    const idx = comp.tracks.findIndex(t => t.id === trackId);
    if (idx < 0) return;
    const [removed] = comp.tracks.splice(idx, 1);
    const removedCurveIds = new Set((removed?.curves ?? []).map(c => c.id));

    if (this.state.selectedTrackId === trackId) {
      this.state.selectedTrackId = comp.tracks[0]?.id ?? null;
      this.state.selectedCurveIds = new Set();
      this.state.selectedPointIndex = null;
      this.state.selectedPoints = NO_POINTS;
      const primary = this.state.performance.planchettes.find(p => p.voiceId === 'primary');
      if (primary) primary.trackId = this.state.selectedTrackId;
    } else {
      // Selection lives elsewhere, but individual curves from this track may
      // still be selected (cross-track selection, 8.23).
      for (const id of removedCurveIds) this.state.selectedCurveIds.delete(id);
      this.state.selectedPoints = withoutCurves(this.state.selectedPoints, removedCurveIds);
    }

    if (this.state.midiArmedTrackId === trackId) this.state.midiArmedTrackId = null;

    // A projection source on the removed track is dropped by touch().

    // Non-primary planchettes bound to this track (MIDI voices on an armed
    // track) would otherwise keep rendering and capturing against it.
    this.state.performance.planchettes = this.state.performance.planchettes.filter(
      p => p.voiceId === 'primary' || p.trackId !== trackId,
    );

    this.touch('composition', ...SELECTION, 'midiArmedTrackId', 'harmonicPrism', 'performance');
  }

  /** Replace entire composition (for load, undo, redo). The snap fields are
   *  views of composition.snap, so they follow automatically. */
  loadComposition(comp: Composition) {
    this.state.composition = comp;
    this.state.selectedTrackId = comp.tracks[0]?.id ?? null;
    this.state.selectedCurveIds = new Set();
    this.state.selectedPointIndex = null;
    this.state.selectedGuideId = null;
    this.touch('composition', 'snap', ...SELECTION);
  }

  // ── Harmonic Prism ──────────────────────────────────────────────

  setPrismChordSpec(spec: Partial<ChordSpec>) {
    const current = this.state.harmonicPrism.chordSpec;
    const next: ChordSpec = { ...current, ...spec };
    this.state.harmonicPrism.chordSpec = next;
    saveChordSpecPref(next);
    this.touch('harmonicPrism');
  }

  setPrismOctaveRange(n: number) {
    const clamped = Math.max(0, Math.min(3, Math.round(n)));
    if (this.state.harmonicPrism.projectionOctaveRange === clamped) return;
    this.state.harmonicPrism.projectionOctaveRange = clamped;
    saveNumberPref(PRISM_OCTAVE_RANGE_STORAGE_KEY, clamped);
    this.touch('harmonicPrism');
  }

  setPrismActiveMode(mode: HarmonicPrismMode | null) {
    if (this.state.harmonicPrism.activeMode === mode) return;
    this.state.harmonicPrism.activeMode = mode;
    this.touch('harmonicPrism');
  }

  setPrismProjectionSource(curveId: string | null) {
    if (this.state.harmonicPrism.projectionSourceId === curveId) return;
    this.state.harmonicPrism.projectionSourceId = curveId;
    // When clearing, also clear the active-mode flag if it was projection.
    if (curveId === null && this.state.harmonicPrism.activeMode === 'projection') {
      this.state.harmonicPrism.activeMode = null;
    } else if (curveId !== null) {
      this.state.harmonicPrism.activeMode = 'projection';
    }
    this.touch('harmonicPrism');
  }

  setPrismDrawMode(enabled: boolean) {
    if (this.state.harmonicPrism.drawMode === enabled) return;
    this.state.harmonicPrism.drawMode = enabled;
    saveBoolPref(PRISM_DRAW_MODE_STORAGE_KEY, enabled);
    this.touch('harmonicPrism');
  }
}

export const store = new Store();
