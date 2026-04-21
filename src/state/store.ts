import type { AppState, Composition, PerformancePhase, PlanchetteState, ToolMode, PlaybackState, ViewportState } from '../types';
import { createComposition } from '../model/composition';
import { DEFAULT_ZOOM_X, DEFAULT_ZOOM_Y, MAX_NOTE } from '../constants';

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

function createInitialState(): AppState {
  return {
    composition: createComposition(),
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
    snapEnabled: true,
    scaleRoot: null,
    scaleId: null,
    drawPreviewMode: 'tone',
    bezierAutoSmooth: false,
    scrollCanvasEnabled: loadBoolPref(SCROLL_CANVAS_STORAGE_KEY, true),
    pitchHudVisible: loadBoolPref(PITCH_HUD_STORAGE_KEY, true),
    metronomeEnabled: loadBoolPref(METRONOME_ENABLED_STORAGE_KEY, false),
    metronomeVolume: loadNumberPref(METRONOME_VOLUME_STORAGE_KEY, 0.6),
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
    // Keep the primary planchette pointing at the selected track for recording/sounding.
    const primary = this.state.performance.planchettes.find(p => p.voiceId === 'primary');
    if (primary) primary.trackId = trackId;
    this.notify();
  }

  /** Replace selection with a single curve (or clear). */
  setSelectedCurve(curveId: string | null) {
    this.state.selectedCurveIds = curveId ? new Set([curveId]) : new Set();
    this.state.selectedPointIndex = null;
    this.notify();
  }

  /** Replace selection with multiple curves. */
  setSelectedCurves(curveIds: string[]) {
    this.state.selectedCurveIds = new Set(curveIds);
    this.state.selectedPointIndex = null;
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

  setTimeSignature(numerator: number, denominator: number) {
    if (this.state.composition.beatsPerMeasure === numerator
        && this.state.composition.timeSignatureDenominator === denominator) return;
    this.state.composition.beatsPerMeasure = numerator;
    this.state.composition.timeSignatureDenominator = denominator;
    this.notify();
  }

  setSnap(enabled: boolean) {
    this.state.snapEnabled = enabled;
    this.notify();
  }

  setScaleRoot(root: number | null) {
    this.state.scaleRoot = root;
    if (root === null) {
      this.state.scaleId = null;
    }
    this.notify();
  }

  setScaleId(scaleId: string | null) {
    this.state.scaleId = scaleId;
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

  /** Mutate composition directly and notify. Use for curve/track mutations. */
  mutate(fn: (comp: Composition) => void) {
    fn(this.state.composition);
    this.notify();
  }

  /** Replace entire composition (for load). */
  loadComposition(comp: Composition) {
    this.state.composition = comp;
    this.state.selectedTrackId = comp.tracks[0]?.id ?? null;
    this.state.selectedCurveIds = new Set();
    this.state.selectedPointIndex = null;
    this.notify();
  }
}

export const store = new Store();
