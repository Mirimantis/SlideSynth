import type { Composition } from '../types';
import { measureLengthInBeats, metronomeTickIntervalInBeats } from '../model/composition';

export type TickTier = 'downbeat' | 'accent' | 'weak';

export interface Metronome {
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  onTick(cb: (audioTime: number, tier: TickTier) => void): void;
  scheduleInRange(
    fromBeat: number,
    toBeat: number,
    composition: Composition,
    beatToAudioTime: (beat: number) => number,
  ): void;
  reset(): void;
}

const TIER_FREQ: Record<TickTier, number> = {
  downbeat: 1500,
  accent: 1100,
  weak: 800,
};

const TIER_GAIN: Record<TickTier, number> = {
  downbeat: 1.0,
  accent: 0.7,
  weak: 0.45,
};

const CLICK_ATTACK_S = 0.002;
const CLICK_DECAY_S = 0.045;

/**
 * Decide the tier for a given tick within a measure. For /4 meters only
 * index 0 is a downbeat and everything else is weak. For /8 meters (compound),
 * tick indices that are multiples of 3 above 0 are secondary accents (beat 4
 * of 6/8, beats 4 and 7 of 9/8, etc.).
 */
function tierForTick(tickIndexInMeasure: number, denominator: number): TickTier {
  if (tickIndexInMeasure === 0) return 'downbeat';
  if (denominator === 8 && tickIndexInMeasure % 3 === 0) return 'accent';
  return 'weak';
}

export function createMetronome(
  getAudioContext: () => AudioContext,
  getMasterGain: () => GainNode,
): Metronome {
  let enabled = false;
  let volume = 0.6;
  let masterNode: GainNode | null = null;
  let tickCallback: ((audioTime: number, tier: TickTier) => void) | null = null;
  /** Next beat we'll consider scheduling. Advanced across scheduler ticks so we
   *  never double-schedule or skip. */
  let nextTickBeat = 0;
  /** True once scheduleInRange has run at least once without a reset/discontinuity. */
  let primed = false;
  /** The last `toBeat` we saw — used to detect a discontinuity from the caller
   *  (e.g. play() restarted, or loop wrapped) so we can re-align the cursor. */
  let lastSeenToBeat = 0;

  function ensureMasterNode(): GainNode {
    if (!masterNode) {
      const ctx = getAudioContext();
      masterNode = ctx.createGain();
      masterNode.gain.value = volume;
      masterNode.connect(getMasterGain());
    }
    return masterNode;
  }

  function scheduleClick(audioTime: number, tier: TickTier) {
    if (!enabled) return;
    const ctx = getAudioContext();
    const master = ensureMasterNode();

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = TIER_FREQ[tier];

    const env = ctx.createGain();
    const peak = TIER_GAIN[tier];
    env.gain.setValueAtTime(0, audioTime);
    env.gain.linearRampToValueAtTime(peak, audioTime + CLICK_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(0.0001, audioTime + CLICK_ATTACK_S + CLICK_DECAY_S);

    osc.connect(env);
    env.connect(master);

    osc.start(audioTime);
    osc.stop(audioTime + CLICK_ATTACK_S + CLICK_DECAY_S + 0.01);
    osc.addEventListener('ended', () => {
      try { osc.disconnect(); env.disconnect(); } catch { /* already gone */ }
    });

    if (tickCallback) tickCallback(audioTime, tier);
  }

  return {
    setEnabled(on: boolean) {
      enabled = on;
      if (!on && masterNode) {
        // Snap to silence — any tail end envelopes will still run, but no new clicks.
        masterNode.gain.setValueAtTime(0, getAudioContext().currentTime);
      } else if (on && masterNode) {
        masterNode.gain.setValueAtTime(volume, getAudioContext().currentTime);
      }
    },
    setVolume(v: number) {
      volume = Math.max(0, Math.min(1, v));
      if (masterNode) {
        masterNode.gain.setValueAtTime(enabled ? volume : 0, getAudioContext().currentTime);
      }
    },
    onTick(cb) {
      tickCallback = cb;
    },
    scheduleInRange(fromBeat, toBeat, composition, beatToAudioTime) {
      // Detect a discontinuity (play/stop/loop-wrap) — the caller's fromBeat
      // should match our last-seen toBeat when scheduling continues smoothly.
      const continuous = primed && Math.abs(fromBeat - lastSeenToBeat) < 1e-6;
      if (!continuous) {
        primed = false;
      }
      lastSeenToBeat = toBeat;

      if (!enabled) {
        // Keep the cursor advancing even when disabled, so enabling mid-play
        // doesn't replay a backlog of missed ticks.
        nextTickBeat = toBeat;
        primed = true;
        return;
      }
      const tickInterval = metronomeTickIntervalInBeats(composition);
      const measureLen = measureLengthInBeats(composition);
      if (tickInterval <= 0 || measureLen <= 0) return;

      if (!primed) {
        // Align to the first tick at or after fromBeat.
        const k = Math.ceil(fromBeat / tickInterval - 1e-9);
        nextTickBeat = k * tickInterval;
        primed = true;
      }

      while (nextTickBeat < toBeat - 1e-9) {
        const beat = nextTickBeat;
        // Tick index within the current measure. Use rounding to absorb float drift
        // when /8 subdivisions produce e.g. 1.4999999 instead of 1.5.
        const raw = (beat % measureLen) / tickInterval;
        const idx = Math.round(raw);
        const tier = tierForTick(idx, composition.timeSignatureDenominator);
        const audioTime = beatToAudioTime(beat);
        scheduleClick(audioTime, tier);
        nextTickBeat = beat + tickInterval;
      }
    },
    reset() {
      nextTickBeat = 0;
      primed = false;
      lastSeenToBeat = 0;
    },
  };
}
