import type { Viewport } from '../canvas/viewport';
import { findAdaptiveSnap, nearestSnapLine, type SnapConfig } from '../utils/snap';
import { hapticClick, hapticStep, HAPTIC_RANGE_PX } from '../ui/haptics';
import { currentSnapConfig } from '../state/snap-config';
import { createMagneticState, updateMagnetic, resetMagnetic, type MagneticState } from '../utils/snap-magnetic';
import { store } from '../state/store';
import { isRecordArmed } from '../state/transport';

/**
 * Where the cursor's pitch goes under Snap and Gravity (BACKLOG 10.1, 13.36;
 * split out of main.ts in 15.3), and which line a finger is on for haptic
 * clicks (13.35). The magnetic state is per finger: the primary's is
 * `magneticState`; extra fingers (13.33) pass their own.
 */
export function createGravity(deps: {
  viewport: Viewport;
  /** The beat under the rail. */
  railBeat(): number;
  isComposePerformActive(): boolean;
}) {
  const { viewport, railBeat, isComposePerformActive } = deps;

  const magneticState = createMagneticState();

  // ── Magnetic perform-clock (BACKLOG 10.1) ──────────────────────
  // Monotonic beat-time for the magnetic integrator, derived from the wall clock
  // rather than the playback position. Physics only needs dt, and wall-clock dt
  // equals playback dt (both real time), so one clock covers every case — including
  // transport-stopped hover (record-armed idle, countdown), where the playback
  // position is frozen and the old time base starved the physics of dt.
  // MAX_DT_BEATS inside updateMagnetic absorbs long gaps (tab throttling, pauses).
  let magneticClockLastMs = 0;
  let magneticClockBeats = 0;
  function magneticNowBeats(): number {
    const now = performance.now();
    if (magneticClockLastMs !== 0) {
      magneticClockBeats += ((now - magneticClockLastMs) / 1000) * (store.getComposition().bpm / 60);
    }
    magneticClockLastMs = now;
    return magneticClockBeats;
  }

  /** `mag` is the Gravity state of the finger this is for: the primary's, or an
   *  extra finger's (13.33). */
  function computeComposeCursorPitch(sy: number, mag: MagneticState = magneticState): { cursorWorldY: number; snappedWorldY: number; snapTarget: number | null; snapConfig: SnapConfig } {
    const { wy } = viewport.screenToWorld(0, sy);
    const st = store.getState();
    // The same targets drawing uses (15.6): scale or chromatic lines, pitch
    // guides, and Prism projection echoes at the rail's beat. Only Y is snapped
    // here — time advances with the transport.
    const snapConfig = currentSnapConfig({ zoomX: viewport.state.zoomX, atBeat: railBeat() });

    // Adaptive snap: nearest target plus a well radius scaled to neighbor
    // spacing. Pentatonic scales and sparse guides get wider wells than
    // chromatic — magnetic pull reaches the cursor wherever the grid is sparse.
    const adaptive = st.snapEnabled
      ? findAdaptiveSnap(wy, snapConfig)
      : { target: null, radius: 0, captured: false };

    // None Key mode is the only mode where snap can fail to engage (cursor
    // outside the captured well between sparse guides). In scale or chromatic
    // mode there's always a nearest target, so the cursor always snaps.
    const inNoneMode = st.hidePitchLines;
    const snapEngaged = adaptive.target !== null && (!inNoneMode || adaptive.captured);
    const snappedWy = snapEngaged ? adaptive.target! : wy;
    const snapTarget = snapEngaged ? adaptive.target : null;

    // Perform context = the rail planchette is (or is about to be) the sounding
    // instrument: Perform mode (rolling or auditioning) or an armed
    // session hovering before playback starts (idle-armed, countdown). Edit
    // tools and the free-planchette draw preview keep instant snap.
    const performContext = isComposePerformActive() || isRecordArmed(st.transport);

    // Magnetic mode: spring-mass physics. The attractor only acts when the
    // cursor is inside its well; outside, the particle falls back to
    // spring-tracks-cursor (smooth, no snap force). State stays continuous
    // across well boundaries, so wells hand off without a kick. Runs on the
    // wall-clock perform-clock, so gravity settles even at rest (transport
    // stopped) — LMB is not required; hover feels the pull too.
    if (st.snapEnabled && performContext && st.magneticEnabled) {
      const attractor = adaptive.target !== null && adaptive.captured
        ? { target: adaptive.target, radius: adaptive.radius }
        : null;
      const magneticPitch = updateMagnetic(mag, wy, magneticNowBeats(), st.magneticStrength, st.magneticSpringK, st.magneticDamping, attractor, st.magneticSpeed);
      return { cursorWorldY: wy, snappedWorldY: magneticPitch, snapTarget, snapConfig };
    }

    // Non-magnetic path: instant snap (or raw cursor Y when snap is off, or no
    // attractor in None mode between guides).
    resetMagnetic(mag);
    return { cursorWorldY: wy, snappedWorldY: snappedWy, snapTarget, snapConfig };
  }

  /** One finger's haptic step: the line it's on after moving to `wy` (from
   *  `held`, the line it was on), with a click if it just came onto one. */
  function hapticFollow(wy: number, config: SnapConfig, held: number | null): number | null {
    const pxPerCent = viewport.state.zoomY;
    const step = hapticStep(wy, held, nearestSnapLine(wy, config, HAPTIC_RANGE_PX / pxPerCent), pxPerCent);
    if (step.click) hapticClick(store.getState().hapticMs, performance.now());
    return step.line;
  }

  return { magneticState, computeComposeCursorPitch, hapticFollow };
}

export type Gravity = ReturnType<typeof createGravity>;
