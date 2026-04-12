import type { AppState, Composition, ToolMode, PlaybackState, ViewportState } from '../types';
import { createComposition } from '../model/composition';
import { DEFAULT_ZOOM_X, DEFAULT_ZOOM_Y, MAX_NOTE } from '../constants';

type Listener = () => void;

function createInitialState(): AppState {
  return {
    composition: createComposition(),
    selectedTrackId: null,
    selectedCurveIds: new Set(),
    selectedPointIndex: null,
    activeTool: 'draw',
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
