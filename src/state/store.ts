import type { AppState, BezierCurve, Composition, GuideDefinition, PerformancePhase, PlanchetteState, ToolMode, PlaybackState, ViewportState, HarmonicPrismMode } from '../types';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { DEFAULT_ZOOM_X, DEFAULT_ZOOM_Y, MAX_NOTE, AUTO_SMOOTH_X_RATIO } from '../constants';
import { DEFAULT_CHORD_SPEC, type ChordSpec } from '../utils/harmonics';

// Snap-section AppState fields (snapEnabled / scaleRoot / scaleId / magnetic*) are
// now mirrors of `composition.snap` (Phase 8.5 — schema v2). Setters write through
// to both. No localStorage keys for those fields anymore — composition file owns them.

type Listener = () => void;

function createInitialPrimaryPlanchette(trackId: string | null): PlanchetteState {
  return {
    voiceId: 'primary',
    trackId,
    cursorWorldY: null,
    snappedWorldY: null,
    lastCrossedAt: 0,
  };
}

const SCROLL_CANVAS_STORAGE_KEY = 'slidesynth.scrollCanvas';
const PITCH_HUD_STORAGE_KEY = 'slidesynth.pitchHud';
const METRONOME_ENABLED_STORAGE_KEY = 'slidesynth.metronomeEnabled';
const METRONOME_VOLUME_STORAGE_KEY = 'slidesynth.metronomeVolume';
const AUTO_SMOOTH_X_RATIO_STORAGE_KEY = 'slidesynth.autoSmoothXRatio';
const PRISM_CHORD_SPEC_STORAGE_KEY = 'slidesynth.prismChordSpec';
const PRISM_OCTAVE_RANGE_STORAGE_KEY = 'slidesynth.prismOctaveRange';
const PRISM_DRAW_MODE_STORAGE_KEY = 'slidesynth.prismDrawMode';
const GUIDES_VISIBLE_STORAGE_KEY = 'slidesynth.guidesVisible';
const GUIDES_LOCKED_STORAGE_KEY = 'slidesynth.guidesLocked';

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

function createInitialState(): AppState {
  const composition = createComposition();
  migrateLegacyMagneticPrefs(composition);
  const snap = composition.snap;
  return {
    composition,
    selectedTrackId: null,
    selectedCurveIds: new Set(),
    selectedPointIndex: null,
    activeTool: 'draw',
    performance: {
      phase: 'idle',
      recordArmed: false,
      countdownStartedAt: 0,
      lmbSounding: false,
      planchettes: [createInitialPrimaryPlanchette(null)],
      currentRecordedCurveIds: { primary: null },
    },
    viewport: {
      offsetX: 0,
      offsetY: MAX_NOTE,
      zoomX: DEFAULT_ZOOM_X,
      zoomY: DEFAULT_ZOOM_Y,
    },
    playback: {
      state: 'stopped',
      positionBeats: 0,
    },
    // AppState mirrors of composition.snap — keep in sync via setters / loadComposition.
    snapEnabled: snap.enabled,
    scaleRoot: snap.scaleRoot,
    scaleId: snap.scaleId,
    hidePitchLines: snap.hidePitchLines,
    magneticEnabled: snap.magneticEnabled,
    magneticStrength: snap.magneticStrength,
    magneticSpringK: snap.magneticSpringK,
    magneticDamping: snap.magneticDamping,
    guidesVisible: loadBoolPref(GUIDES_VISIBLE_STORAGE_KEY, true),
    guidesLocked: loadBoolPref(GUIDES_LOCKED_STORAGE_KEY, false),
    selectedGuideId: null,
    // Phase 8.11 — MIDI input recording arm. Workspace-only; not persisted
    // (record-arm shouldn't silently re-engage on app reload).
    midiArmedTrackId: null,
    drawPreviewMode: 'tone',
    bezierAutoSmooth: false,
    scrollCanvasEnabled: loadBoolPref(SCROLL_CANVAS_STORAGE_KEY, true),
    pitchHudVisible: loadBoolPref(PITCH_HUD_STORAGE_KEY, true),
    metronomeEnabled: loadBoolPref(METRONOME_ENABLED_STORAGE_KEY, false),
    metronomeVolume: loadNumberPref(METRONOME_VOLUME_STORAGE_KEY, 0.6),
    autoSmoothXRatio: Math.max(0, Math.min(1, loadNumberPref(AUTO_SMOOTH_X_RATIO_STORAGE_KEY, AUTO_SMOOTH_X_RATIO))),
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
  private state: AppState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = createInitialState();
    // Auto-select first track
    const firstTrack = this.state.composition.tracks[0];
    if (firstTrack) {
      this.state.selectedTrackId = firstTrack.id;
      this.state.performance.planchettes[0]!.trackId = firstTrack.id;
    }
  }

  getState(): AppState {
    return this.state;
  }

  getComposition(): Composition {
    return this.state.composition;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  // ── Mutations ───────────────────────────────────────────────

  setSelectedTrack(trackId: string | null) {
    this.state.selectedTrackId = trackId;
    this.state.selectedCurveIds = new Set();
    this.state.selectedPointIndex = null;
    this.state.selectedGuideId = null;
    // Keep the primary planchette pointing at the selected track for recording/sounding.
    const primary = this.state.performance.planchettes.find(p => p.voiceId === 'primary');
    if (primary) primary.trackId = trackId;
    this.notify();
  }

  /** Replace selection with a single curve (or clear). */
  setSelectedCurve(curveId: string | null) {
    this.state.selectedCurveIds = curveId ? new Set([curveId]) : new Set();
    this.state.selectedPointIndex = null;
    if (curveId !== null) this.state.selectedGuideId = null;
    this.notify();
  }

  /** Replace selection with multiple curves. */
  setSelectedCurves(curveIds: string[]) {
    this.state.selectedCurveIds = new Set(curveIds);
    this.state.selectedPointIndex = null;
    if (curveIds.length > 0) this.state.selectedGuideId = null;
    this.notify();
  }

  /** Add a curve to the selection (Shift+click). */
  addSelectedCurve(curveId: string) {
    this.state.selectedCurveIds.add(curveId);
    this.state.selectedPointIndex = null;
    this.notify();
  }

  /** Toggle a curve in/out of the selection (Shift+click). */
  toggleSelectedCurve(curveId: string) {
    if (this.state.selectedCurveIds.has(curveId)) {
      this.state.selectedCurveIds.delete(curveId);
    } else {
      this.state.selectedCurveIds.add(curveId);
    }
    this.state.selectedPointIndex = null;
    this.notify();
  }

  /** Convenience: get the single selected curve ID, or null if 0 or 2+. */
  getSelectedCurveId(): string | null {
    if (this.state.selectedCurveIds.size === 1) {
      return [...this.state.selectedCurveIds][0]!;
    }
    return null;
  }

  setSelectedPoint(index: number | null) {
    this.state.selectedPointIndex = index;
    this.notify();
  }

  setTool(tool: ToolMode) {
    this.state.activeTool = tool;
    this.notify();
  }

  setPerformPhase(phase: PerformancePhase) {
    this.state.performance.phase = phase;
    this.notify();
  }

  setPerformArmed(on: boolean) {
    this.state.performance.recordArmed = on;
    this.notify();
  }

  /** Arm a track for MIDI input recording. Mutually exclusive — passing a
   *  trackId replaces any existing arm; passing null disarms. Distinct from
   *  setPerformArmed (LMB record-arm). */
  setMidiArmedTrackId(trackId: string | null) {
    if (this.state.midiArmedTrackId === trackId) return;
    this.state.midiArmedTrackId = trackId;
    this.notify();
  }

  setPerformLmbSounding(on: boolean) {
    this.state.performance.lmbSounding = on;
    this.notify();
  }

  setPerformCountdownStartedAt(t: number) {
    this.state.performance.countdownStartedAt = t;
    this.notify();
  }

  setPlanchetteY(voiceId: string, cursorWorldY: number | null, snappedWorldY: number | null) {
    const p = this.state.performance.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    p.cursorWorldY = cursorWorldY;
    p.snappedWorldY = snappedWorldY;
    // No notify — called every frame during mouse-move; render loop already ticks each frame.
  }

  markPlanchetteCrossed(voiceId: string, t: number) {
    const p = this.state.performance.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    p.lastCrossedAt = t;
  }

  setPerformCurrentCurve(voiceId: string, curveId: string | null) {
    this.state.performance.currentRecordedCurveIds[voiceId] = curveId;
  }

  /** Add a planchette to the perform array (e.g. harmony voice on LMB-down with Prism Draw). */
  addPerformPlanchette(planchette: PlanchetteState) {
    if (this.state.performance.planchettes.some(p => p.voiceId === planchette.voiceId)) return;
    this.state.performance.planchettes.push(planchette);
    this.notify();
  }

  /** Remove a planchette by voiceId. Primary is never removable here (use a fresh init). */
  removePerformPlanchette(voiceId: string) {
    if (voiceId === 'primary') return;
    const arr = this.state.performance.planchettes;
    const idx = arr.findIndex(p => p.voiceId === voiceId);
    if (idx >= 0) {
      arr.splice(idx, 1);
      this.notify();
    }
  }

  /** Strip every Harmonic-Prism harmony planchette (chord-cluster cleanup on
   *  LMB-up). Leaves the primary planchette and any MIDI input planchettes
   *  (voice id 'midi-*') alone — those have independent lifecycles. */
  removeHarmonyPlanchettes() {
    const before = this.state.performance.planchettes.length;
    this.state.performance.planchettes = this.state.performance.planchettes
      .filter(p => !p.voiceId.startsWith('harmony-'));
    if (this.state.performance.planchettes.length !== before) this.notify();
  }

  setDrawPreviewMode(mode: 'tone' | 'composition') {
    this.state.drawPreviewMode = mode;
    this.notify();
  }

  setBezierAutoSmooth(enabled: boolean) {
    this.state.bezierAutoSmooth = enabled;
    this.notify();
  }

  setScrollCanvas(enabled: boolean) {
    if (this.state.scrollCanvasEnabled === enabled) return;
    this.state.scrollCanvasEnabled = enabled;
    saveBoolPref(SCROLL_CANVAS_STORAGE_KEY, enabled);
    this.notify();
  }

  setPitchHudVisible(visible: boolean) {
    if (this.state.pitchHudVisible === visible) return;
    this.state.pitchHudVisible = visible;
    saveBoolPref(PITCH_HUD_STORAGE_KEY, visible);
    this.notify();
  }

  setMetronomeEnabled(enabled: boolean) {
    if (this.state.metronomeEnabled === enabled) return;
    this.state.metronomeEnabled = enabled;
    saveBoolPref(METRONOME_ENABLED_STORAGE_KEY, enabled);
    this.notify();
  }

  setMetronomeVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    if (this.state.metronomeVolume === clamped) return;
    this.state.metronomeVolume = clamped;
    saveNumberPref(METRONOME_VOLUME_STORAGE_KEY, clamped);
    this.notify();
  }

  setMagneticEnabled(on: boolean) {
    if (this.state.magneticEnabled === on) return;
    this.state.magneticEnabled = on;
    this.state.composition.snap.magneticEnabled = on;
    this.notify();
  }

  setMagneticStrength(strength: number) {
    const clamped = Math.max(0, Math.min(1, strength));
    if (this.state.magneticStrength === clamped) return;
    this.state.magneticStrength = clamped;
    this.state.composition.snap.magneticStrength = clamped;
    this.notify();
  }

  setMagneticSpringK(k: number) {
    const clamped = Math.max(1, Math.min(50, k));
    if (this.state.magneticSpringK === clamped) return;
    this.state.magneticSpringK = clamped;
    this.state.composition.snap.magneticSpringK = clamped;
    this.notify();
  }

  setMagneticDamping(d: number) {
    const clamped = Math.max(0.25, Math.min(15, d));
    if (this.state.magneticDamping === clamped) return;
    this.state.magneticDamping = clamped;
    this.state.composition.snap.magneticDamping = clamped;
    this.notify();
  }

  setAutoSmoothXRatio(r: number) {
    const clamped = Math.max(0, Math.min(1, r));
    if (this.state.autoSmoothXRatio === clamped) return;
    this.state.autoSmoothXRatio = clamped;
    saveNumberPref(AUTO_SMOOTH_X_RATIO_STORAGE_KEY, clamped);
    this.notify();
  }

  setTimeSignature(numerator: number, denominator: number) {
    if (this.state.composition.beatsPerMeasure === numerator
        && this.state.composition.timeSignatureDenominator === denominator) return;
    this.state.composition.beatsPerMeasure = numerator;
    this.state.composition.timeSignatureDenominator = denominator;
    this.notify();
  }

  setSnap(enabled: boolean) {
    this.state.snapEnabled = enabled;
    this.state.composition.snap.enabled = enabled;
    this.notify();
  }

  /** Sets the Key dropdown's three-mode state (8.19): a numeric root, Chromatic
   *  (root=null, hidePitchLines=false), or None (root=null, hidePitchLines=true).
   *  hidePitchLines is meaningful only when root is null; selecting a scale tone
   *  forces it to false so the staff lines come back. */
  setScaleRoot(root: number | null, hidePitchLines: boolean = false) {
    const effectiveHide = root === null ? hidePitchLines : false;
    this.state.scaleRoot = root;
    this.state.composition.snap.scaleRoot = root;
    this.state.hidePitchLines = effectiveHide;
    this.state.composition.snap.hidePitchLines = effectiveHide;
    if (root === null) {
      this.state.scaleId = null;
      this.state.composition.snap.scaleId = null;
    }
    this.notify();
  }

  setScaleId(scaleId: string | null) {
    this.state.scaleId = scaleId;
    this.state.composition.snap.scaleId = scaleId;
    this.notify();
  }

  setPlaybackState(ps: PlaybackState) {
    this.state.playback.state = ps;
    this.notify();
  }

  setPlaybackPosition(beats: number) {
    this.state.playback.positionBeats = beats;
    // Don't notify on every position update (called at 60fps) — use requestAnimationFrame
  }

  setViewport(vp: Partial<ViewportState>) {
    Object.assign(this.state.viewport, vp);
    this.notify();
  }

  setBpm(bpm: number) {
    this.state.composition.bpm = bpm;
    this.notify();
  }

  setLoopStart(beats: number) {
    const comp = this.state.composition;
    // Keep markers at least 0.5 beats apart and loopStart >= 0.
    const clamped = Math.max(0, Math.min(beats, comp.loopEndBeats - 0.5));
    comp.loopStartBeats = clamped;
    this.notify();
  }

  setLoopEnd(beats: number) {
    const comp = this.state.composition;
    const clamped = Math.max(comp.loopStartBeats + 0.5, beats);
    comp.loopEndBeats = clamped;
    this.notify();
  }

  // ── Snap guides (Phase 8.7) ─────────────────────────────────

  setGuidesVisible(visible: boolean): void {
    if (this.state.guidesVisible === visible) return;
    this.state.guidesVisible = visible;
    saveBoolPref(GUIDES_VISIBLE_STORAGE_KEY, visible);
    this.notify();
  }

  setGuidesLocked(locked: boolean): void {
    if (this.state.guidesLocked === locked) return;
    this.state.guidesLocked = locked;
    // Locking clears any active guide selection so the property panel doesn't
    // continue to advertise an editable label / Delete button on a locked guide.
    if (locked) this.state.selectedGuideId = null;
    saveBoolPref(GUIDES_LOCKED_STORAGE_KEY, locked);
    this.notify();
  }

  /** Select a guide (clears curve/point selection). Pass null to clear. */
  setSelectedGuide(id: string | null): void {
    if (this.state.selectedGuideId === id) return;
    this.state.selectedGuideId = id;
    if (id !== null) {
      this.state.selectedCurveIds = new Set();
      this.state.selectedPointIndex = null;
    }
    this.notify();
  }

  /** Append a guide to the composition. Caller is responsible for snapshotting history. */
  addGuide(guide: GuideDefinition): void {
    this.state.composition.guides.push(guide);
    this.notify();
  }

  /** Remove a guide. Clears guide selection if it was the selected one. */
  removeGuide(id: string): void {
    const arr = this.state.composition.guides;
    const idx = arr.findIndex(g => g.id === id);
    if (idx < 0) return;
    arr.splice(idx, 1);
    if (this.state.selectedGuideId === id) this.state.selectedGuideId = null;
    this.notify();
  }

  /** Patch a guide's mutable fields (label / position). */
  updateGuide(id: string, fields: Partial<Pick<GuideDefinition, 'label' | 'position'>>): void {
    const g = this.state.composition.guides.find(g => g.id === id);
    if (!g) return;
    if (fields.label !== undefined) g.label = fields.label;
    if (fields.position !== undefined) g.position = fields.position;
    this.notify();
  }

  /** Mutate composition directly and notify. Use for curve/track mutations. */
  mutate(fn: (comp: Composition) => void) {
    fn(this.state.composition);
    this.notify();
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
    this.setSelectedTrack(targetTrackId);
    this.setSelectedCurves(curveIds);
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

  /** Replace entire composition (for load). Hydrates AppState mirrors of `comp.snap`
   *  so the UI re-reads them without churn. */
  loadComposition(comp: Composition) {
    this.state.composition = comp;
    this.state.selectedTrackId = comp.tracks[0]?.id ?? null;
    this.state.selectedCurveIds = new Set();
    this.state.selectedPointIndex = null;
    this.state.selectedGuideId = null;
    // Hydrate snap-section mirrors from the loaded composition.
    const snap = comp.snap;
    this.state.snapEnabled = snap.enabled;
    this.state.scaleRoot = snap.scaleRoot;
    this.state.scaleId = snap.scaleId;
    this.state.hidePitchLines = snap.hidePitchLines;
    this.state.magneticEnabled = snap.magneticEnabled;
    this.state.magneticStrength = snap.magneticStrength;
    this.state.magneticSpringK = snap.magneticSpringK;
    this.state.magneticDamping = snap.magneticDamping;
    this.notify();
  }

  // ── Harmonic Prism ──────────────────────────────────────────────

  setPrismChordSpec(spec: Partial<ChordSpec>) {
    const current = this.state.harmonicPrism.chordSpec;
    const next: ChordSpec = { ...current, ...spec };
    this.state.harmonicPrism.chordSpec = next;
    saveChordSpecPref(next);
    this.notify();
  }

  setPrismOctaveRange(n: number) {
    const clamped = Math.max(0, Math.min(3, Math.round(n)));
    if (this.state.harmonicPrism.projectionOctaveRange === clamped) return;
    this.state.harmonicPrism.projectionOctaveRange = clamped;
    saveNumberPref(PRISM_OCTAVE_RANGE_STORAGE_KEY, clamped);
    this.notify();
  }

  setPrismActiveMode(mode: HarmonicPrismMode | null) {
    if (this.state.harmonicPrism.activeMode === mode) return;
    this.state.harmonicPrism.activeMode = mode;
    this.notify();
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
    this.notify();
  }

  setPrismDrawMode(enabled: boolean) {
    if (this.state.harmonicPrism.drawMode === enabled) return;
    this.state.harmonicPrism.drawMode = enabled;
    saveBoolPref(PRISM_DRAW_MODE_STORAGE_KEY, enabled);
    this.notify();
  }
}

export const store = new Store();
