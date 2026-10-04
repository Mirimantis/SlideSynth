/**
 * The Pitch HUD (split out of main.ts in 15.3): the pitch the planchette
 * sounds, in the tuning's note names, cents and Hz, the raw cursor pitch when
 * it differs, and the dynamics bus's value when a live source drives it.
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

export interface PitchHud {
  /** Show a pitch (`snappedY`), the raw cursor pitch beside it when it differs
   *  (`rawY`), and the dynamics value (null: the bus isn't driven, so the
   *  slot stays blank, as before the bus). */
  show(state: AppState, snappedY: number, rawY: number | null, dynamics: number | null): void;
  hide(): void;
}

export function createPitchHud(el: HTMLElement): PitchHud {
  // Fixed-width HUD slots — one <span> per field so the numbers don't shift
  // horizontally as cents flip between e.g. "+3¢" and "-12¢". Slots are created
  // once and their textContent is updated in place.
  el.innerHTML = `
    <span class="hud-slot hud-note" data-slot="snap-name"></span>
    <span class="hud-slot hud-cents" data-slot="snap-cents"></span>
    <span class="hud-slot hud-hz" data-slot="snap-hz"></span>
    <span class="hud-slot hud-sep" data-slot="sep"></span>
    <span class="hud-slot hud-note" data-slot="raw-name"></span>
    <span class="hud-slot hud-cents" data-slot="raw-cents"></span>
    <span class="hud-slot hud-dyn" data-slot="dyn"></span>
  `;
  const slot = (name: string) => el.querySelector(`[data-slot="${name}"]`) as HTMLSpanElement;
  const snapNameEl = slot('snap-name');
  const snapCentsEl = slot('snap-cents');
  const snapHzEl = slot('snap-hz');
  const sepEl = slot('sep');
  const rawNameEl = slot('raw-name');
  const rawCentsEl = slot('raw-cents');
  const dynEl = slot('dyn');

  function clearRaw() {
    sepEl.textContent = '';
    rawNameEl.textContent = '';
    rawCentsEl.textContent = '';
  }

  return {
    show(state, snappedY, rawY, dynamics) {
      dynEl.textContent = dynamics == null ? '' : formatDynamics(dynamics);
      // Y is cents; the HUD names the tuning's nearest note (13.8 (b)) and the
      // signed ¢ remainder.
      const snapName = pitchName(state, snappedY);
      snapNameEl.textContent = snapName.name;
      snapCentsEl.textContent = formatCents(Math.round(snapName.offset));
      // Hz reflects the current global tuning offset since centsToFrequency reads
      // the module-level reference A4. A=432 etc. shifts every readout in lockstep.
      snapHzEl.textContent = formatHz(centsToFrequency(snappedY));

      const hasRaw = rawY != null
        && Math.abs(rawY - snappedY) >= 2
        && rawY >= MIN_PITCH_CENTS - CENTS_PER_SEMITONE / 2
        && rawY <= MAX_PITCH_CENTS + CENTS_PER_SEMITONE / 2;
      if (hasRaw) {
        const rawName = pitchName(state, rawY);
        sepEl.textContent = '·';
        rawNameEl.textContent = rawName.name;
        rawCentsEl.textContent = formatCents(Math.round(rawName.offset));
      } else {
        clearRaw();
      }
      el.removeAttribute('hidden');
    },
    hide() {
      if (el.hasAttribute('hidden')) return;
      el.setAttribute('hidden', '');
      for (const s of [snapNameEl, snapCentsEl, snapHzEl, dynEl]) s.textContent = '';
      clearRaw();
    },
  };
}
