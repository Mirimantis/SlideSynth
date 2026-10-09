/**
 * The metronome (split out of main.ts in 15.3): it ticks with the playback
 * scheduler, follows the Tempo drawer's settings, and says when each tick
 * sounds, so the Tempo icon can flash with it (16.8).
 */

import { signal, type ReadonlySignal } from '@preact/signals-core';
import { createMetronome } from '../audio/metronome';
import { getAudioContext, getMasterGain } from '../audio/engine';
import type { PlaybackEngine } from '../audio/playback';
import { store } from '../state/store';
import { watch } from '../state/reactive';

export type MetronomeTier = 'downbeat' | 'accent' | 'weak';

/** A tick as it sounds. `n` counts the ticks, so each one is new. */
export interface MetronomeBeat {
  n: number;
  tier: MetronomeTier;
}

export function createMetronomeClock(playback: PlaybackEngine): { beat: ReadonlySignal<MetronomeBeat | null> } {
  const metronome = createMetronome(getAudioContext, getMasterGain);
  const beat = signal<MetronomeBeat | null>(null);
  let n = 0;
  // A tick is scheduled ahead on the audio clock; say so when it sounds.
  metronome.onTick((audioTime, tier) => {
    const delayMs = Math.max(0, (audioTime - getAudioContext().currentTime) * 1000);
    setTimeout(() => { beat.value = { n: ++n, tier }; }, delayMs);
  });
  playback.setSchedulerHook((fromBeat, toBeat, comp, beatToAudioTime) => {
    metronome.scheduleInRange(fromBeat, toBeat, comp, beatToAudioTime);
  });
  // The Tempo drawer and the top bar change the store; the metronome follows it.
  watch(() => store.getState().metronomeEnabled, on => metronome.setEnabled(on));
  watch(() => store.getState().metronomeVolume, v => metronome.setVolume(v));

  return { beat };
}
