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

// ── Composition ─────────────────────────────────────────────────

export interface Composition {
  version: number;
  name: string;
  bpm: number;
  beatsPerMeasure: number;
  totalBeats: number;
  tracks: Track[];
  toneLibrary: ToneDefinition[];
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

export type ToolMode = 'draw' | 'select' | 'delete';

// ── App State ───────────────────────────────────────────────────

export interface AppState {
  composition: Composition;
  selectedTrackId: string | null;
  selectedCurveIds: Set<string>;
  selectedPointIndex: number | null;
  activeTool: ToolMode;
  viewport: ViewportState;
  playback: PlaybackInfo;
  snapEnabled: boolean;
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
