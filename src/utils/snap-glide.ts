/**
 * Snap-glide (glissando-snap) pitch interpolation. Glide is *dwell-gated*:
 * slow deliberate motion between snap cells engages a smooth glissando over
 * `glideBeats`, while rapid passes through many cells track the cursor
 * instantly (no glide pile-up, no accumulating lag).
 *
 * Dwell gate: when a new snap target arrives within DWELL_MS of the previous
 * target change, we treat it as part of an ongoing rapid pass and teleport
 * the glided pitch to the new target. When the gap since the last change is
 * long enough that the user could have been "resting" in the previous cell,
 * we engage the normal glide from the last settled pitch toward the new
 * target over `glideBeats`.
 */

/** If a new target arrives within this window of the previous target change,
 *  we're mid-rapid-pass and skip glide entirely. */
const DWELL_MS = 120;

export interface SnapGlideState {
  fromPitch: number | null;
  toPitch: number | null;
  startBeat: number;
  /** Wall-clock time (performance.now) of the most recent target change. */
  lastTargetChangeMs: number;
}

export function createSnapGlideState(): SnapGlideState {
  return { fromPitch: null, toPitch: null, startBeat: 0, lastTargetChangeMs: 0 };
}

/** Reset the glide so the next update establishes a fresh anchor. */
export function resetSnapGlide(state: SnapGlideState): void {
  state.fromPitch = null;
  state.toPitch = null;
  state.startBeat = 0;
  state.lastTargetChangeMs = 0;
}

function interpolate(state: SnapGlideState, nowBeats: number, glideBeats: number): number {
  if (state.fromPitch === null || state.toPitch === null) return state.toPitch ?? 0;
  if (glideBeats <= 0) return state.toPitch;
  const elapsed = nowBeats - state.startBeat;
  const t = Math.min(1, Math.max(0, elapsed / glideBeats));
  return state.fromPitch + (state.toPitch - state.fromPitch) * t;
}

/**
 * Update the glide state for a new target and return the current glided pitch.
 *  - glideBeats <= 0: snaps instantly; state tracks the target but never interpolates.
 *  - target unchanged: continues the in-flight glide toward the same target.
 *  - target changed with long dwell since last change: glide from current pitch to new target.
 *  - target changed within DWELL_MS: rapid-pass — teleport to new target, no glide.
 */
export function updateGlide(
  state: SnapGlideState,
  targetPitch: number,
  nowBeats: number,
  glideBeats: number,
  nowMs: number,
): number {
  if (state.toPitch === null) {
    // First update — establish anchor.
    state.fromPitch = targetPitch;
    state.toPitch = targetPitch;
    state.startBeat = nowBeats;
    state.lastTargetChangeMs = nowMs;
    return targetPitch;
  }

  if (glideBeats <= 0) {
    state.fromPitch = targetPitch;
    state.toPitch = targetPitch;
    state.startBeat = nowBeats;
    state.lastTargetChangeMs = nowMs;
    return targetPitch;
  }

  if (targetPitch !== state.toPitch) {
    const timeSinceLastChange = nowMs - state.lastTargetChangeMs;
    state.lastTargetChangeMs = nowMs;
    if (timeSinceLastChange < DWELL_MS) {
      // Rapid-pass: target is still changing quickly, so don't glide — teleport
      // to the new target. This keeps fast sweeps clean (no plateaus in the
      // recorded curve) and avoids compounding lag.
      state.fromPitch = targetPitch;
      state.toPitch = targetPitch;
      state.startBeat = nowBeats;
      return targetPitch;
    }
    // Dwelled long enough to consider the previous cell "settled" — glide from
    // the last settled pitch (the previous target) to the new target.
    state.fromPitch = state.toPitch;
    state.toPitch = targetPitch;
    state.startBeat = nowBeats;
    return state.fromPitch;
  }

  return interpolate(state, nowBeats, glideBeats);
}
