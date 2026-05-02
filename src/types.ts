import type { ChordSpec } from './utils/harmonics';

// ── Vector ──────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

// ── Tone Definition ─────────────────────────────────────────────

export type OscillatorShape = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface WaveformLayer {
  type: OscillatorShape;
  gain: number;    // 0–1
  detune: number;  // cents, -1200 to +1200
}

export type OversampleAmount = '2x' | '4x' | 'none';

export interface DistortionConfig {
  amount: number;  // 0–1
  oversample: OversampleAmount;
}

export interface ToneDefinition {
  id: string;
  name: string;
  color: string;            // CSS color
  dashPattern: number[];    // [] = solid, [10,5] = dashed
  layers: WaveformLayer[];
  distortion: DistortionConfig | null;
}

// ── Bezier Curves ───────────────────────────────────────────────

export interface ControlPoint {
  position: Vec2;           // x = beats, y = MIDI note number (continuous float)
  handleIn: Vec2 | null;    // relative to position
  handleOut: Vec2 | null;   // relative to position
  volume: number;           // 0–1
}

export interface BezierCurve {
  id: string;
  points: ControlPoint[];   // ordered by increasing position.x
  groupId?: string | null;  // grouped curves move/delete/transform together (chord clusters and freehand groups)
  voiceIndex?: number;      // Harmonic Prism: 0 = primary, 1..N-1 = harmonies (chord-cluster siblings only)
}

// ── Track ───────────────────────────────────────────────────────

export interface Track {
  id: string;
  name: string;
  toneId: string;           // references ToneDefinition.id
  curves: BezierCurve[];
  muted: boolean;
  solo: boolean;
  volume: number;           // 0–1
}

// ── Snap settings ──────────────────────────────────────────────

/**
 * Per-composition snap configuration. Persisted in the composition file so a
 * project's bespoke snap setup round-trips cleanly. AppState mirrors these
 * fields for fast UI reads; the composition owns the canonical values.
 */
export interface SnapSettings {
  enabled: boolean;
  scaleRoot: number | null;     // 0..11, or null = no scale
  scaleId: string | null;       // ScaleDefinition.id, or null
  magneticEnabled: boolean;
  magneticStrength: number;     // 0..1
  magneticSpringK: number;      // 1..50
  magneticDamping: number;      // 0.25..15
}

// ── Snap guides (Phase 8.7) ────────────────────────────────────

/**
 * User-placed snap guide. X-oriented guides snap the cursor X to a beat;
 * Y-oriented guides snap the cursor Y to a pitch. Additive to other snap
 * targets — they don't replace subdivisions/scale/echoes.
 */
export interface GuideDefinition {
  id: string;
  orientation: 'x' | 'y';
  position: number;             // beats for 'x', float MIDI note for 'y'
  label: string;                // user-editable, may be empty
}

// ── Composition ─────────────────────────────────────────────────

export interface Composition {
  version: number;
  name: string;
  bpm: number;
  beatsPerMeasure: number;           // time-signature numerator
  timeSignatureDenominator: number;  // 4 or 8 — defaults to 4
  tracks: Track[];
  toneLibrary: ToneDefinition[];
  loopStartBeats: number;
  loopEndBeats: number;
  snap: SnapSettings;                // v2: per-composition snap config (was global)
  guides: GuideDefinition[];         // v2: user-placed snap guides (Phase 8.7)
}

// ── Viewport ────────────────────────────────────────────────────

export interface ViewportState {
  offsetX: number;          // world units (beats)
  offsetY: number;          // world units (MIDI note number)
  zoomX: number;            // pixels per beat
  zoomY: number;            // pixels per semitone
}

// ── Playback ────────────────────────────────────────────────────

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface PlaybackInfo {
  state: PlaybackState;
  positionBeats: number;
}

// ── Tool ────────────────────────────────────────────────────────

export type ToolMode = 'draw' | 'select' | 'delete' | 'scissors';

/** Tools that own cursor X motion in Idle (i.e. placing / picking / slicing curves). */
export const XY_TOOLS: readonly ToolMode[] = ['draw', 'select', 'delete', 'scissors'];

// ── Performance (Perform / Record state) ────────────────────────

// Voice identifier — MVP only uses 'primary'. Harmonic Prism adds 'harmony-0', 'harmony-1', etc.
export type VoiceId = string;

export type PerformancePhase = 'idle' | 'countdown' | 'playing';

export interface PlanchetteState {
  voiceId: VoiceId;
  trackId: string | null;
  cursorWorldY: number | null;
  snappedWorldY: number | null;
  lastCrossedAt: number;
}

export interface PerformanceState {
  phase: PerformancePhase;
  recordArmed: boolean;
  countdownStartedAt: number;
  lmbSounding: boolean;
  planchettes: PlanchetteState[];
  currentRecordedCurveIds: Record<VoiceId, string | null>;
}

// ── Harmonic Prism ──────────────────────────────────────────────

export type HarmonicPrismMode = 'draw' | 'perform' | 'projection';

export interface HarmonicPrismState {
  chordSpec: ChordSpec;                    // persisted
  projectionOctaveRange: number;           // ±octaves to echo; persisted; 0..3
  activeMode: HarmonicPrismMode | null;    // runtime only (which mode is engaged)
  projectionSourceId: string | null;       // curve id driving projection, or null
  drawMode: boolean;                       // Draw-tool chord placement on/off; persisted
}

// ── App State ───────────────────────────────────────────────────

export interface AppState {
  composition: Composition;
  selectedTrackId: string | null;
  selectedCurveIds: Set<string>;
  selectedPointIndex: number | null;
  activeTool: ToolMode;
  performance: PerformanceState;
  viewport: ViewportState;
  playback: PlaybackInfo;
  // Snap-section UI mirrors — canonical values live on Composition.snap (v2+).
  // Setters write through to both the AppState mirror and the composition.
  snapEnabled: boolean;
  scaleRoot: number | null;    // 0-11, or null = no scale
  scaleId: string | null;      // ScaleDefinition.id, or null
  magneticEnabled: boolean;
  magneticStrength: number;
  magneticSpringK: number;
  magneticDamping: number;
  /** Snap guides (Phase 8.7) — workspace toggle for visibility (and snap participation).
   *  Persisted to localStorage; not in the composition file (it's a viewing pref). */
  guidesVisible: boolean;
  /** When true, existing guides can't be selected, dragged, or deleted via the
   *  canvas / Delete key. Buttons in the Snap section still work (so the user can
   *  unlock and add new guides). Persisted to localStorage. */
  guidesLocked: boolean;
  /** ID of the currently selected guide (for Object Properties / Delete). Mutually
   *  exclusive with curve/point selection. */
  selectedGuideId: string | null;
  drawPreviewMode: 'tone' | 'composition';   // Draw-tool spacebar preview scope
  bezierAutoSmooth: boolean;                  // Draw-tool: click-placed points get horizontal handles
  scrollCanvasEnabled: boolean;               // Compose Playback view preference (localStorage-backed)
  pitchHudVisible: boolean;                   // Pitch HUD user preference (localStorage-backed)
  metronomeEnabled: boolean;                  // Metronome user preference (localStorage-backed)
  metronomeVolume: number;                    // 0..1 — metronome master gain (localStorage-backed)
  autoSmoothXRatio: number;                   // 0..1 — fraction of neighbor segment length used for Draw auto-smooth + Smooth Curve action (localStorage-backed)
  harmonicPrism: HarmonicPrismState;          // Harmonic Prism feature (chordSpec + octaveRange localStorage-backed)
}

// ── Transform Box ──────────────────────────────────────────────

export type TransformHandle =
  | 'translate'
  | 'left' | 'right' | 'top' | 'bottom'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  | 'octaveUp' | 'octaveDown';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TransformBoxState {
  curveIds: string[];
  originalPointsMap: Map<string, ControlPoint[]>;
  bbox: BoundingBox;
  activeHandle: TransformHandle | null;
  dragStart: Vec2 | null;
}

// ── Audio Samples ───────────────────────────────────────────────

export interface CurveSample {
  timeSeconds: number;
  frequency: number;
  volume: number;
}
