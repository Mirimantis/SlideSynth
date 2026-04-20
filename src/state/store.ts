import type { AppState, AppMode, Composition, GlissandographPhase, PlanchetteState, ToolMode, PlaybackState, ViewportState } from '../types';
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

function createInitialState(): AppState {
  return {
    composition: createComposition(),
    selectedTrackId: null,
    selectedCurveIds: new Set(),
    selectedPointIndex: null,
    activeTool: 'draw',
    activeMode: 'composition',
    glissandograph: {
      phase: 'idle',
      recordArmed: false,
      countdownStartedAt: 0,
      lmbSounding: false,
      lastActivityAt: 0,
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
      this.state.glissandograph.planchettes[0]!.trackId = firstTrack.id;
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
    const primary = this.state.glissandograph.planchettes.find(p => p.voiceId === 'primary');
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

  setActiveMode(mode: AppMode) {
    if (this.state.activeMode === mode) return;
    this.state.activeMode = mode;
    this.notify();
  }

  setGlissPhase(phase: GlissandographPhase) {
    this.state.glissandograph.phase = phase;
    this.notify();
  }

  setGlissArmed(on: boolean) {
    this.state.glissandograph.recordArmed = on;
    this.notify();
  }

  setGlissLmbSounding(on: boolean) {
    this.state.glissandograph.lmbSounding = on;
    this.notify();
  }

  setGlissCountdownStartedAt(t: number) {
    this.state.glissandograph.countdownStartedAt = t;
    this.notify();
  }

  setGlissLastActivityAt(t: number) {
    this.state.glissandograph.lastActivityAt = t;
  }

  setPlanchetteY(voiceId: string, cursorWorldY: number | null, snappedWorldY: number | null) {
    const p = this.state.glissandograph.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    p.cursorWorldY = cursorWorldY;
    p.snappedWorldY = snappedWorldY;
    // No notify — called every frame during mouse-move; render loop already ticks each frame.
  }

  markPlanchetteCrossed(voiceId: string, t: number) {
    const p = this.state.glissandograph.planchettes.find(pl => pl.voiceId === voiceId);
    if (!p) return;
    p.lastCrossedAt = t;
  }

  setGlissCurrentCurve(voiceId: string, curveId: string | null) {
    this.state.glissandograph.currentRecordedCurveIds[voiceId] = curveId;
  }

  setDrawPreviewMode(mode: 'tone' | 'composition') {
    this.state.drawPreviewMode = mode;
    this.notify();
  }

  setBezierAutoSmooth(enabled: boolean) {
    this.state.bezierAutoSmooth = enabled;
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
