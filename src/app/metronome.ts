/**
 * The metronome (split out of main.ts in 15.3): it ticks with the playback
 * scheduler, follows the Tempo drawer's settings, and remembers its latest
 * tick so the canvas can flash with it.
 */

import { createMetronome } from '../audio/metronome';
import { getAudioContext, getMasterGain } from '../audio/engine';
import type { PlaybackEngine } from '../audio/playback';
import { store } from '../state/store';
import { watch } from '../state/reactive';

export type MetronomeTier = 'downbeat' | 'accent' | 'weak';

export interface MetronomeFlash {
  /** Wall-clock ms the latest tick sounded (0 before the first). */
  at: number;
  tier: MetronomeTier;
}

export function createMetronomeClock(playback: PlaybackEngine): { flash(): MetronomeFlash } {
  const metronome = createMetronome(getAudioContext, getMasterGain);
  /** Wall-clock ms at which the latest metronome tick is scheduled to fire, plus
   *  its tier — render loop reads these to flash the planchette/playhead. */
  let lastClickAt = 0;
  let lastClickTier: MetronomeTier = 'weak';
  metronome.onTick((audioTime, tier) => {
    const ctx = getAudioContext();
    const delayMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    setTimeout(() => {
      lastClickAt = performance.now();
      lastClickTier = tier;
    }, delayMs);
  });
  playback.setSchedulerHook((fromBeat, toBeat, comp, beatToAudioTime) => {
    metronome.scheduleInRange(fromBeat, toBeat, comp, beatToAudioTime);
  });
  // The Tempo drawer and the top bar change the store; the metronome follows it.
  watch(() => store.getState().metronomeEnabled, on => metronome.setEnabled(on));
  watch(() => store.getState().metronomeVolume, v => metronome.setVolume(v));

  return { flash: () => ({ at: lastClickAt, tier: lastClickTier }) };
}
