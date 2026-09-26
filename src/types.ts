import type { TuningRef } from './tuning/tuning';

import type { ChordSpec } from './utils/harmonics';
import type { PointSelection } from './model/point-selection';

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

// ── Bezier Curves — unified lane model ─────────────────────────
// Pitch and every parameter (volume, and future: pan, cutoff, vibrato, …)
// are the SAME primitive: a Bezier graph-editor curve whose X is a beat and
// whose Y lives in the lane's own value-domain. The main canvas is the
// specialized editor view of the pitch lane; the Parameters Graph is the
// generic view for the rest. Plain data only — history/clipboard deep-clone
// via JSON, and .gliss round-trip preservation relies on plain objects.

export interface LanePoint {
  position: Vec2;           // x = beats; y = lane value (cents for pitch, 0–1 for volume)
  handleIn: Vec2 | null;    // relative to position
  handleOut: Vec2 | null;   // relative to position
}

export type LaneType = 'pitch' | 'volume';   // widen later (pan, cutoff, …)

export interface Lane {
  type: LaneType;
  unit: 'cents' | 'normalized';
  range: [number, number];  // Y-domain clamp for anchors / sampled values
  points: LanePoint[];      // ordered by increasing position.x; pitch >= 2, others >= 1
  gravity?: unknown;        // reserved for per-lane gravity-well maps; must round-trip verbatim
}

export interface BezierCurve {
  id: string;
  /** lanes[0] is ALWAYS the pitch lane (constructor-enforced invariant). */
  lanes: Lane[];
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
  /** Which pitches exist (13.8): an equal division, or a table. */
  tuning: TuningRef;
  /** Which degree of the tuning is home: an index into its degrees. */
  root: number;
  /** Which degrees the piece uses: a scale id, or 'all'. */
  scaleId: string;
  /** Which of the 12 standard notes the tuning's degree 0 sits on (0 = C).
   *  Always 0 for 12-EDO, where it would only rotate the root. */
  tunedFrom: number;
  /** Pitch lines hidden (8.19's "None"): the staff draws no lines and Y has
   *  no grid to snap to. Frets and Prism echoes still pull. */
  hidePitchLines: boolean;
  /** The faint 12-EDO reference lines under a tuning other than 12-EDO
   *  (13.8 (b)). Display only. */
  referenceLines: boolean;
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
  position: number;             // beats for 'x', pitch cents for 'y'
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
  tuningOffsetCents: number;         // v2-additive: A4 reference offset in cents (0 = A=440); BACKLOG 8.27
}

// ── Viewport ────────────────────────────────────────────────────

export interface ViewportState {
  offsetX: number;          // world units (beats)
  offsetY: number;          // world units (pitch cents)
  zoomX: number;            // pixels per beat
  zoomY: number;            // pixels per cent
}

// ── Playback ────────────────────────────────────────────────────

export interface PlaybackInfo {
  /** Stored playhead: where Play starts in the classic (unlocked-rail) view,
   *  and what ruler scrubbing moves. Whether the transport is running lives in
   *  `AppState.transport`. */
  positionBeats: number;
}

// ── Transport (BACKLOG 15.2) ────────────────────────────────────

/** What the transport is doing. See src/state/transport.ts for the rules. */
export type TransportMode = 'stopped' | 'paused' | 'countdown' | 'playing';

/** Which clock a rolling transport runs: plain Play (ends with the content, or
 *  loops) or the open-ended clock that Play runs in Perform (BACKLOG 16.2; it
 *  was the jam clock, 10.1). */
export type TransportClock = 'play' | 'open';

/** What a rolling transport is recording: nothing (the rolling buffer still
 *  runs for Keep), an open-ended record, or one loop pass (BACKLOG 10.5) that
 *  is waiting for the loop point or in progress. */
export type CaptureMode = 'none' | 'armed' | 'pass-queued' | 'pass-recording';

export interface TransportState {
  mode: TransportMode;
  clock: TransportClock;
  capture: CaptureMode;
  /** AudioContext time the record count-in started (countdown only). */
  countdownStartedAt: number;
}

// ── Tool ────────────────────────────────────────────────────────

export type ToolMode = 'draw' | 'select' | 'delete' | 'scissors';

/** Tools that own cursor X motion in Idle (i.e. placing / picking / slicing curves). */
export const XY_TOOLS: readonly ToolMode[] = ['draw', 'select', 'delete', 'scissors'];

// ── Performance (Perform / Record state) ────────────────────────

// Voice identifier — MVP only uses 'primary'. Harmonic Prism adds 'harmony-0', 'harmony-1', etc.
export type VoiceId = string;

/** Derived from the transport for the performance engine's tick
 *  (see `performPhase` in src/state/transport.ts). */
export type PerformancePhase = 'idle' | 'countdown' | 'playing';

export interface PlanchetteState {
  voiceId: VoiceId;
  trackId: string | null;
  cursorWorldY: number | null;
  snappedWorldY: number | null;
  lastCrossedAt: number;
}

/** Deliberate "record next full pass" (BACKLOG 10.5), as the Record button
 *  shows it. Derived from `TransportState.capture`. */
export type PassRecordState = 'off' | 'queued' | 'recording';

/** Live-performance voices. The transport/capture mode lives in
 *  `AppState.transport` (BACKLOG 15.2). */
export interface PerformanceState {
  lmbSounding: boolean;
  planchettes: PlanchetteState[];
  currentRecordedCurveIds: Record<VoiceId, string | null>;
}

// ── Dynamics bus (BACKLOG Phase 11) ─────────────────────────────

/** What drives the dynamics bus — the shared 0–1 channel that sets live
 *  performed loudness and fills the recorded volume lane. `fixed` is the
 *  pre-bus behaviour (a constant); every other value is a live input adapter. */
export type DynamicsSource = 'fixed' | 'key-swell';

export const DYNAMICS_SOURCES: readonly DynamicsSource[] = ['fixed', 'key-swell'];

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
  /** Multi-point selection (BACKLOG 8.3): selected anchor indices per curve.
   *  - When exactly one point is selected and it's on the single selected
   *    curve, this is in sync with `selectedPointIndex` (the "primary" point
   *    that draws handles). With several points, none is primary.
   *  - Cleared when the composition is mutated in a way that could invalidate
   *    indices, by mutators that clear curve selection (track switch, curve
   *    selection replace), and on selection-cancel paths. */
  selectedPoints: PointSelection;
  activeTool: ToolMode;
  /** Transport + capture mode (BACKLOG 15.2) — the single source for "is it
   *  playing / counting in / recording". Runtime only. */
  transport: TransportState;
  /** Perform mode (BACKLOG 16.2): the left button plays the rail planchette
   *  instead of running the active tool, and the view is the rail view.
   *  Runtime only; `activeTool` is kept for when Perform is left. */
  performMode: boolean;
  performance: PerformanceState;
  viewport: ViewportState;
  playback: PlaybackInfo;
  /** Loop playback on/off. Runtime state (not persisted); the playback engine
   *  follows it (BACKLOG 15.1 — it used to own the flag itself). */
  loopEnabled: boolean;
  // Snap-section fields — read-only views of Composition.snap (BACKLOG 15.1:
  // derived, no longer mirrored copies). Change them through the store setters.
  snapEnabled: boolean;
  tuning: TuningRef;
  root: number;
  scaleId: string;
  tunedFrom: number;
  hidePitchLines: boolean;
  referenceLines: boolean;
  magneticEnabled: boolean;
  magneticStrength: number;
  magneticSpringK: number;
  magneticDamping: number;
  /** Track ID currently armed for MIDI input recording (Phase 8.11). Null = no
   *  track armed. Mutually exclusive — arming a different track replaces the
   *  value. Distinct from PerformanceState.recordArmed (LMB record-arm), which
   *  can be active in parallel. Workspace state (not persisted across reloads). */
  midiArmedTrackId: string | null;
  /** Snap guides (Phase 8.7) — workspace toggle for visibility (and snap participation).
   *  Persisted to localStorage; not in the composition file (it's a viewing pref). */
  guidesVisible: boolean;
  /** When true, existing guides can't be selected, dragged, or deleted via the
   *  canvas / Delete key. Buttons in the Snap section still work (so the user can
   *  unlock and add new guides). Persisted to localStorage. */
  guidesLocked: boolean;
  /** ID of the currently selected guide (for the Selection panel / Delete). Mutually
   *  exclusive with curve/point selection. */
  selectedGuideId: string | null;
  drawPreviewMode: 'tone' | 'composition';   // Draw-tool audition (hold A) scope
  bezierAutoSmooth: boolean;                  // Draw-tool: click-placed points get horizontal handles
  /** Compose mode: scroll the canvas past the rail during playback instead of
   *  moving the playhead (BACKLOG 16.2: the view half of the old Lock Rail).
   *  Perform always uses the rail view. localStorage-backed; off by default. */
  scrollCanvasEnabled: boolean;
  /** Layer-per-pass looping (BACKLOG 10.3): each performed pass commits onto a
   *  fresh track. localStorage-backed; off by default. */
  layerModeEnabled: boolean;
  pitchHudVisible: boolean;                   // Pitch HUD user preference (localStorage-backed)
  /** Record from a stop counts in first (BACKLOG 16.3). localStorage-backed; on by default. */
  countInEnabled: boolean;
  /** Dragging the ruler plays what's under the playhead (BACKLOG 16.3).
   *  localStorage-backed; on by default. */
  audibleScrub: boolean;
  perfHudVisible: boolean;                    // Perf HUD user preference (localStorage-backed)
  metronomeEnabled: boolean;                  // Metronome user preference (localStorage-backed)
  metronomeVolume: number;                    // 0..1 — metronome master gain (localStorage-backed)
  autoSmoothXRatio: number;                   // 0..1 — fraction of neighbor segment length used for Draw auto-smooth + Smooth Curve action (localStorage-backed)
  dynamicsSource: DynamicsSource;             // What drives performed volume (localStorage-backed)
  harmonicPrism: HarmonicPrismState;          // Harmonic Prism feature (chordSpec + octaveRange localStorage-backed)
}

// ── Transform Box ──────────────────────────────────────────────

export type TransformHandle =
  | 'translate'
  | 'left' | 'right' | 'top' | 'bottom'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  | 'octaveUp' | 'octaveDown'
  /** The Ungroup button, shown when the box holds a group (16.5). */
  | 'ungroup';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TransformBoxState {
  curveIds: string[];
  originalPointsMap: Map<string, LanePoint[]>;
  /** Snapshot of each curve's non-pitch lanes (e.g. volume) taken alongside
   *  originalPointsMap, so their X can be kept time-locked with the pitch
   *  lane through a move/scale. */
  originalNonPitchLanesMap: Map<string, Lane[]>;
  bbox: BoundingBox;
  activeHandle: TransformHandle | null;
  dragStart: Vec2 | null;
  /** When set, transforms only apply to these points (point-subset mode,
   *  BACKLOG 8.3). Null means whole-curve transforms. */
  pointIndicesPerCurve: PointSelection | null;
}

// ── Audio Samples ───────────────────────────────────────────────

export interface CurveSample {
  timeSeconds: number;
  frequency: number;
  volume: number;
}
