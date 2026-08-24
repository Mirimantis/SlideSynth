/**
 * Magnetic Snap physics: spring-mass model where the planchette's pitch is
 *   - pulled toward the cursor by an elastic force (SPRING_K),
 *   - attracted to nearby snap lines with proximity-based strength,
 *   - damped so it settles instead of oscillating forever.
 *
 * At strength=0 the snap attractors are inert, leaving only the cursor spring
 * (smooth, snap-less follow). At strength=1 snap lines pull hard enough to
 * support vibrato (pitch undulation) around a snap target.
 *
 * Integrator: semi-implicit Euler with a fixed STABLE_SUBSTEP_DT. Each call
 * sub-steps the elapsed time into fixed slices so behavior is identical at
 * any frame rate (60 FPS Chrome, throttled preview iframe, background tab).
 */

const SNAP_STRENGTH_MAX = 800;      // peak snap attractor stiffness at strength=1
const MAX_DT_BEATS = 0.1;           // cap total elapsed dt — avoids huge catch-up after a long pause
const MAX_VELOCITY = 20000;         // cents/beat (200 ST/beat) — hard cap against numerical blowups
/** Fixed sub-step size for the integrator. Semi-implicit Euler is stable when
 *  dt*ω < 2; with ω up to ~30 (snapK + springK at default settings) we need
 *  dt below ~0.067 beats. 0.02 stays well inside that bound for all sensible
 *  parameter values, making the physics frame-rate-independent: a slow tab,
 *  preview iframe, or background throttle still gets identical settling
 *  behavior to a 60 FPS foreground Chrome tab. */
const STABLE_SUBSTEP_DT = 0.02;
/** Reference radius above which snapK is scaled down. At radius=100 ¢ / 1 ST
 *  (the old fixed-falloff baseline) snapK is unchanged; wider wells get
 *  proportionally weaker peak forces so a sparse guide doesn't yank the
 *  particle. The spring system is linear in distance, so rescaling this
 *  constant (with MAX_VELOCITY) preserves the exact pre-cents feel for any
 *  persisted springK/damping values. */
const SNAPK_REFERENCE_RADIUS = 100;

export interface MagneticState {
  pitch: number | null;           // current simulated pitch (cents)
  velocity: number;               // cents per beat
  lastUpdateBeats: number;
}

/** Snap attractor with an adaptive well radius. The radius scales with neighbor
 *  spacing (chromatic ~0.5 ST, pentatonic ~1.5 ST, sparse guides up to 6 ST),
 *  so wider gaps in the snap grid still reach the cursor. */
export interface MagneticAttractor {
  target: number;
  radius: number;
}

export function createMagneticState(): MagneticState {
  return { pitch: null, velocity: 0, lastUpdateBeats: 0 };
}

export function resetMagnetic(state: MagneticState, initialPitch?: number): void {
  state.pitch = initialPitch ?? null;
  state.velocity = 0;
  state.lastUpdateBeats = 0;
}

/** Linear falloff in [0, 1]: 1 at the snap line, 0 beyond `radius`. */
function snapFalloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const absD = Math.abs(distance);
  if (absD >= radius) return 0;
  return 1 - absD / radius;
}

/**
 * Advance physics one step. Returns the current pitch.
 *  - cursorPitch: raw target the spring pulls toward.
 *  - strength: 0..1 — snap attractor strength (the "Force" slider in the UI).
 *  - springK: cursor-to-pitch spring stiffness (user slider). At 0 the cursor
 *    doesn't pull the planchette at all — motion comes purely from snap
 *    attractors as the nearest-snap switches under the cursor.
 *  - damping: velocity damping coefficient (user slider). Low values let
 *    oscillations near snap lines sustain longer (vibrato-like pitch
 *    undulation); high values settle quickly.
 *  - attractor: the nearest snap line and its adaptive well radius. Null when
 *    the cursor floats outside any well (None Key mode between guides) —
 *    physics falls back to cursor-spring only, so the particle smoothly
 *    tracks the cursor with no snap kick.
 */
export function updateMagnetic(
  state: MagneticState,
  cursorPitch: number,
  nowBeats: number,
  strength: number,
  springK: number,
  damping: number,
  attractor: MagneticAttractor | null,
): number {
  // First call or after reset — start at the cursor with zero velocity. The
  // cursor-spring then carries the particle into the attractor's well, where
  // auto-damping (below) keeps it from oscillating.
  if (state.pitch === null) {
    state.pitch = cursorPitch;
    state.velocity = 0;
    state.lastUpdateBeats = nowBeats;
    return state.pitch;
  }

  const rawDt = nowBeats - state.lastUpdateBeats;
  state.lastUpdateBeats = nowBeats;
  // Negative means a reset/rewind (just settle here). Cap the total elapsed
  // window so a long pause doesn't replay minutes of physics on resume.
  if (rawDt <= 0) return state.pitch;
  const totalDt = Math.min(MAX_DT_BEATS, rawDt);

  // Scale snap stiffness inversely with well radius so the peak attractor
  // force (snapK * R / 4 for linear falloff) stays bounded regardless of how
  // wide the adaptive well grew. Without this, a wide well with snapK=600
  // can fling the particle with ~900 units of force on entry. Computed once
  // since neither strength nor radius depends on the integration sub-step.
  const baseSnapK = Math.max(0, Math.min(1, strength)) * SNAP_STRENGTH_MAX;
  const radius = attractor?.radius ?? SNAPK_REFERENCE_RADIUS;
  const snapK = baseSnapK * (SNAPK_REFERENCE_RADIUS / Math.max(SNAPK_REFERENCE_RADIUS, radius));

  // Sub-step at a fixed dt for frame-rate-independent physics. The integrator
  // re-evaluates forces each sub-step since position and velocity change.
  const numSteps = Math.max(1, Math.ceil(totalDt / STABLE_SUBSTEP_DT));
  const stepDt = totalDt / numSteps;
  for (let i = 0; i < numSteps; i++) {
    // Force accumulator.
    let force = springK * (cursorPitch - state.pitch);
    if (attractor !== null) {
      const d = attractor.target - state.pitch;
      force += snapK * d * snapFalloff(d, attractor.radius);
    }
    force -= damping * state.velocity;

    // Semi-implicit Euler: update velocity first, then position with the new velocity.
    state.velocity += force * stepDt;
    // Guard against runaway velocity from a pathological input.
    if (state.velocity > MAX_VELOCITY) state.velocity = MAX_VELOCITY;
    else if (state.velocity < -MAX_VELOCITY) state.velocity = -MAX_VELOCITY;
    state.pitch += state.velocity * stepDt;
  }

  return state.pitch;
}
