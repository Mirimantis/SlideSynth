/**
 * Magnetic Snap physics: spring-mass model where the planchette's pitch is
 *   - pulled toward the cursor by an elastic force (SPRING_K),
 *   - attracted to nearby snap lines with proximity-based strength,
 *   - damped so it settles instead of oscillating forever.
 *
 * At strength=0 the snap attractors are inert, leaving only the cursor spring
 * (smooth, snap-less follow). At strength=1 snap lines pull hard enough to
 * support tremolo around a pitch.
 *
 * Integrator: semi-implicit Euler with a capped dt so a frame drop can't blow
 * up the simulation.
 */

const SNAP_STRENGTH_MAX = 800;      // peak snap attractor stiffness at strength=1
const SNAP_RANGE_SEMITONES = 1;     // linear falloff half-width for each attractor well
const MAX_DT_BEATS = 0.1;           // cap dt to guard against frame drops / tab throttling
const MAX_VELOCITY = 200;           // semitones/beat — hard cap against numerical blowups

export interface MagneticState {
  pitch: number | null;           // current simulated pitch (semitones)
  velocity: number;               // semitones per beat
  lastUpdateBeats: number;
}

export function createMagneticState(): MagneticState {
  return { pitch: null, velocity: 0, lastUpdateBeats: 0 };
}

export function resetMagnetic(state: MagneticState, initialPitch?: number): void {
  state.pitch = initialPitch ?? null;
  state.velocity = 0;
  state.lastUpdateBeats = 0;
}

/** Linear falloff in [0, 1]: 1 at the snap line, 0 beyond SNAP_RANGE_SEMITONES. */
function snapFalloff(distance: number): number {
  const absD = Math.abs(distance);
  if (absD >= SNAP_RANGE_SEMITONES) return 0;
  return 1 - absD / SNAP_RANGE_SEMITONES;
}

/**
 * Advance physics one step. Returns the current pitch.
 *  - cursorPitch: raw target the spring pulls toward.
 *  - strength: 0..1 — user slider for snap attractor strength.
 *  - springK: cursor-to-pitch spring stiffness (user slider). At 0 the cursor
 *    doesn't pull the planchette at all — motion comes purely from snap
 *    attractors as the nearest-snap switches under the cursor.
 *  - damping: velocity damping coefficient (user slider). Low values let
 *    oscillations near snap lines sustain longer (tremolo-like); high values
 *    settle quickly.
 *  - snapNeighbors: snap line values acting as attractors. Typically just the
 *    nearest (single-element array) — two overlapping attractors with linear
 *    falloff cancel exactly in the inter-snap region.
 */
export function updateMagnetic(
  state: MagneticState,
  cursorPitch: number,
  nowBeats: number,
  strength: number,
  springK: number,
  damping: number,
  snapNeighbors: readonly number[],
): number {
  // First call or after reset — sit at the cursor with zero velocity.
  if (state.pitch === null) {
    state.pitch = cursorPitch;
    state.velocity = 0;
    state.lastUpdateBeats = nowBeats;
    return state.pitch;
  }

  const rawDt = nowBeats - state.lastUpdateBeats;
  state.lastUpdateBeats = nowBeats;
  // Clamp dt: negative means a reset/rewind (just settle here), too large
  // means a frame drop (integrate a capped window so velocity doesn't explode).
  const dt = rawDt <= 0 ? 0 : Math.min(MAX_DT_BEATS, rawDt);
  if (dt === 0) return state.pitch;

  const snapK = Math.max(0, Math.min(1, strength)) * SNAP_STRENGTH_MAX;

  // Force accumulator.
  let force = springK * (cursorPitch - state.pitch);
  for (const s of snapNeighbors) {
    const d = s - state.pitch;
    force += snapK * d * snapFalloff(d);
  }
  force -= damping * state.velocity;

  // Semi-implicit Euler: update velocity first, then position with the new velocity.
  state.velocity += force * dt;
  // Guard against runaway velocity from a pathological input.
  if (state.velocity > MAX_VELOCITY) state.velocity = MAX_VELOCITY;
  else if (state.velocity < -MAX_VELOCITY) state.velocity = -MAX_VELOCITY;
  state.pitch += state.velocity * dt;

  return state.pitch;
}
