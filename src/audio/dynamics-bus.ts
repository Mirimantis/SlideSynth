/**
 * The dynamics bus (BACKLOG Phase 11): one shared normalized 0–1 channel that
 * (a) drives live synth amplitude while performing and (b) is recorded into the
 * currently-recording voice's volume lane. Every input device is a thin adapter
 * feeding this one value, so each later item (MIDI CC / pen pressure / gamepad
 * trigger) is a new `DynamicsSource`, not a new path through the app.
 *
 * 11.1 ships two sources: `fixed` (a constant, byte-identical to the hardcoded
 * volume that preceded the bus) and `key-swell` (hold a key, the value swells;
 * release, it decays). `fixed` stays the default so a player who never touches
 * the swell key records exactly what they always did.
 */

import { DYNAMICS_SOURCES, type DynamicsSource, type VoiceId } from '../types';
import { DEFAULT_VOLUME } from '../model/lane';

export function isDynamicsSource(value: string): value is DynamicsSource {
  return (DYNAMICS_SOURCES as readonly string[]).includes(value);
}

/** Resting value of the key-swell envelope — audible but clearly held back, so
 *  the swell has somewhere to travel from without recording near-silence. */
export const SWELL_REST = 0.15;
/** Value approached while the swell key is held. */
export const SWELL_PEAK = 1.0;
/** Time constants of the exponential approach, in ms. Attack is quicker than
 *  release: a swell should answer the key promptly but fall away like a breath. */
const ATTACK_TAU_MS = 120;
const RELEASE_TAU_MS = 200;

/** Guard against a stalled tab handing us a multi-second dt on the frame after
 *  it wakes, which would snap the envelope instead of ramping it. */
const MAX_TICK_DT_MS = 100;

export interface DynamicsBus {
  setSource(src: DynamicsSource): void;
  getSource(): DynamicsSource;
  /** Held-swell gate. Ignored while the source is `fixed`. */
  setSwellHeld(held: boolean): void;
  isSwellHeld(): boolean;
  /**
   * Advance the envelope. Called once per render frame with `performance.now()`.
   * Frame-rate independent: the value depends on elapsed time, not tick count.
   */
  tick(nowMs: number): void;
  /**
   * Current value, 0–1. `voiceId` is accepted from day one — 11.2's per-note
   * MIDI pressure needs a per-voice channel — but every 11.1 source is global,
   * so today every voice reads the same value.
   */
  getValue(voiceId?: VoiceId): number;
  /** True when a live source is driving the value (i.e. anything but `fixed`).
   *  Renderers use this to fall back to their pre-bus appearance. */
  isDriven(): boolean;
  /** Back to rest with the gate released — session stop, composition load,
   *  window blur (where a keyup can go missing). */
  reset(): void;
}

export function createDynamicsBus(initialSource: DynamicsSource = 'fixed'): DynamicsBus {
  let source: DynamicsSource = initialSource;
  let swellHeld = false;
  let value = SWELL_REST;
  let lastTickMs: number | null = null;

  return {
    setSource(src) {
      if (src === source) return;
      source = src;
      // Entering (or leaving) a live source starts from rest rather than
      // inheriting whatever the previous source left behind.
      swellHeld = false;
      value = SWELL_REST;
      lastTickMs = null;
    },

    getSource() {
      return source;
    },

    setSwellHeld(held) {
      if (source !== 'key-swell') return;
      swellHeld = held;
    },

    isSwellHeld() {
      return swellHeld;
    },

    tick(nowMs) {
      if (lastTickMs === null) {
        lastTickMs = nowMs;
        return;
      }
      const dt = Math.min(MAX_TICK_DT_MS, Math.max(0, nowMs - lastTickMs));
      lastTickMs = nowMs;
      if (source !== 'key-swell') return;
      const target = swellHeld ? SWELL_PEAK : SWELL_REST;
      const tau = swellHeld ? ATTACK_TAU_MS : RELEASE_TAU_MS;
      value += (target - value) * (1 - Math.exp(-dt / tau));
    },

    getValue() {
      if (source === 'fixed') return DEFAULT_VOLUME;
      return value;
    },

    isDriven() {
      return source !== 'fixed';
    },

    reset() {
      swellHeld = false;
      value = SWELL_REST;
      lastTickMs = null;
    },
  };
}
