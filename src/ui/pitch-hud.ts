/**
 * The Pitch HUD's readout (split out of main.ts in 15.3): the pitch the
 * planchette sounds, in the tuning's note names, cents and Hz, the raw cursor
 * pitch when it differs, and the dynamics bus's value when a live source
 * drives it. The component is in canvas-huds.tsx.
 */

import { centsToFrequency, CENTS_PER_SEMITONE, MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';
import { pitchName } from '../tuning/tuning';
import type { AppState } from '../types';

export function formatCents(cents: number): string {
  if (cents === 0) return '';
  return `${cents > 0 ? '+' : ''}${cents}¢`;
}

/** Format Hz for the Pitch HUD: 2 decimals below 100Hz (more precision where
 *  semitones span only a couple Hz), 1 decimal otherwise. */
export function formatHz(hz: number): string {
  if (hz < 100) return `${hz.toFixed(2)} Hz`;
  return `${hz.toFixed(1)} Hz`;
}

/** Four-step bar for the dynamics readout, quietest to loudest. */
const DYNAMICS_BAR_GLYPHS = ['▁', '▃', '▅', '▇'];

export function formatDynamics(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.max(1, Math.ceil(clamped * DYNAMICS_BAR_GLYPHS.length));
  return `${DYNAMICS_BAR_GLYPHS.slice(0, filled).join('')} ${clamped.toFixed(2)}`;
}

/** What the Pitch HUD shows, as text. */
export interface PitchReadout {
  name: string;
  cents: string;
  hz: string;
  /** The raw cursor pitch, when it's off the sounding one. */
  raw: { name: string; cents: string } | null;
  /** Blank when the dynamics bus isn't driven. */
  dynamics: string;
}

/** The pitch the planchette sounds (`snappedY`), the raw cursor pitch beside
 *  it when it differs (`rawY`), and the dynamics value (null: the bus isn't
 *  driven, so the slot stays blank, as before the bus). */
export function pitchReadout(state: AppState, snappedY: number, rawY: number | null, dynamics: number | null): PitchReadout {
  // Y is cents; the HUD names the tuning's nearest note (13.8 (b)) and the
  // signed ¢ remainder.
  const snap = pitchName(state, snappedY);
  const hasRaw = rawY != null
    && Math.abs(rawY - snappedY) >= 2
    && rawY >= MIN_PITCH_CENTS - CENTS_PER_SEMITONE / 2
    && rawY <= MAX_PITCH_CENTS + CENTS_PER_SEMITONE / 2;
  const raw = hasRaw ? pitchName(state, rawY) : null;
  return {
    name: snap.name,
    cents: formatCents(Math.round(snap.offset)),
    // Hz reflects the current global tuning offset since centsToFrequency reads
    // the module-level reference A4. A=432 etc. shifts every readout in lockstep.
    hz: formatHz(centsToFrequency(snappedY)),
    raw: raw && { name: raw.name, cents: formatCents(Math.round(raw.offset)) },
    dynamics: dynamics == null ? '' : formatDynamics(dynamics),
  };
}
