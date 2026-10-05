/**
 * What the count-in number and the idle warning over the canvas show (split
 * out of main.ts in 15.3). The components are in canvas-huds.tsx.
 */

import type { PerformanceEngine } from '../canvas/performance-engine';
import { isOpenEnded, isRecordArmed, isRolling, performPhase } from '../state/transport';
import { JAM_IDLE_TIMEOUT_MS } from '../constants';
import type { AppState } from '../types';

/** Show the AFK warning popup once `afkTimeoutMs - 30s` of remaining time is left
 *  — i.e. after 30 seconds of inactivity. The popup races the engine's auto-stop
 *  using the same constant, so the countdown reaches 0 at the moment recording
 *  pauses. */
export const AFK_WARNING_LEAD_MS = 30_000;

type SessionEngine = Pick<PerformanceEngine, 'getCountdownLabel' | 'getIdleMs' | 'getAfkTimeoutMs'>;

/** The count-in's number, or null when there's no count-in. */
export function countdownLabel(state: AppState, engine: SessionEngine, audioNow: number): string | null {
  const t = state.transport;
  if (t.mode !== 'countdown') return null;
  return engine.getCountdownLabel(audioNow, performPhase(t), t.countdownStartedAt);
}

/** The idle warning's seconds left, or null when it's hidden. It appears once
 *  the user has been idle past `afkTimeoutMs - AFK_WARNING_LEAD_MS`, counts
 *  down the seconds remaining, and disappears as soon as activity resumes
 *  (engine resets idle to 0) or recording stops. Suppression (loop on /
 *  playhead before rightmost) is inherited automatically — `tickComposePerform`
 *  calls `markActivity` every frame in those cases, so `getIdleMs` stays near
 *  zero. */
export function afkLabel(state: AppState, engine: SessionEngine, isPlaying: boolean, now: number): string | null {
  const t = state.transport;
  const armed = isRecordArmed(t) || state.midiArmedTrackId !== null;
  if (!((armed || isOpenEnded(t)) && isRolling(t) && isPlaying)) return null;
  // Mirror the timeout selection in tickComposePerform so the popup countdown
  // races the same window the engine will actually fire on.
  const timeoutMs = armed ? engine.getAfkTimeoutMs() : JAM_IDLE_TIMEOUT_MS;
  const remainingMs = timeoutMs - engine.getIdleMs(now);
  if (remainingMs > AFK_WARNING_LEAD_MS) return null;
  // Round up so the user never sees "0" while the engine is still ticking down.
  return `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
}
