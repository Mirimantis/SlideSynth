/**
 * The count-in number and the idle warning over the canvas (split out of
 * main.ts in 15.3).
 */

import type { PerformanceEngine } from '../canvas/performance-engine';
import { getAudioContext } from '../audio/engine';
import { isOpenEnded, isRecordArmed, isRolling, performPhase } from '../state/transport';
import { JAM_IDLE_TIMEOUT_MS } from '../constants';
import type { AppState } from '../types';

/** Show the AFK warning popup once `afkTimeoutMs - 30s` of remaining time is left
 *  — i.e. after 30 seconds of inactivity. The popup races the engine's auto-stop
 *  using the same constant, so the countdown reaches 0 at the moment recording
 *  pauses. */
const AFK_WARNING_LEAD_MS = 30_000;

export interface SessionOverlays {
  update(state: AppState): void;
}

export function createSessionOverlays(
  els: { countdown: HTMLElement; afkWarning: HTMLElement; afkCountdown: HTMLElement },
  deps: { engine: PerformanceEngine; isPlaying(): boolean },
): SessionOverlays {
  const { countdown, afkWarning, afkCountdown } = els;

  function updateCountdown(state: AppState) {
    const t = state.transport;
    if (t.mode !== 'countdown') {
      if (!countdown.hasAttribute('hidden')) {
        countdown.setAttribute('hidden', '');
        countdown.textContent = '';
      }
      return;
    }
    const label = deps.engine.getCountdownLabel(getAudioContext().currentTime, performPhase(t), t.countdownStartedAt);
    if (countdown.textContent !== label) countdown.textContent = label;
    countdown.removeAttribute('hidden');
  }

  /** AFK warning popup: appears once the user has been idle past
   *  `afkTimeoutMs - AFK_WARNING_LEAD_MS`, counts down the seconds remaining,
   *  and disappears as soon as activity resumes (engine resets idle to 0) or
   *  recording stops. Suppression (loop on / playhead before rightmost) is
   *  inherited automatically — `tickComposePerform` calls `markActivity` every
   *  frame in those cases, so `getIdleMs` stays near zero. */
  function updateAfkWarning(state: AppState) {
    const t = state.transport;
    const armed = isRecordArmed(t) || state.midiArmedTrackId !== null;
    const shouldShow = (armed || isOpenEnded(t)) && isRolling(t) && deps.isPlaying();
    if (!shouldShow) {
      if (!afkWarning.hasAttribute('hidden')) afkWarning.setAttribute('hidden', '');
      return;
    }
    const idleMs = deps.engine.getIdleMs(performance.now());
    // Mirror the timeout selection in tickComposePerform so the popup countdown
    // races the same window the engine will actually fire on.
    const timeoutMs = armed ? deps.engine.getAfkTimeoutMs() : JAM_IDLE_TIMEOUT_MS;
    const remainingMs = timeoutMs - idleMs;
    if (remainingMs > AFK_WARNING_LEAD_MS) {
      if (!afkWarning.hasAttribute('hidden')) afkWarning.setAttribute('hidden', '');
      return;
    }
    // Round up so the user never sees "0" while the engine is still ticking down.
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const label = `${remainingSec}s`;
    if (afkCountdown.textContent !== label) afkCountdown.textContent = label;
    if (afkWarning.hasAttribute('hidden')) afkWarning.removeAttribute('hidden');
  }

  return {
    update(state) {
      updateCountdown(state);
      updateAfkWarning(state);
    },
  };
}
