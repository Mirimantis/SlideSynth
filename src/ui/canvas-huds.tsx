import '@preact/signals'; // components re-render when the signals and store fields they read change
import { signal, type Signal } from '@preact/signals';
import { store } from '../state/store';
import type { PitchReadout } from './pitch-hud';
import type { PerfReadout } from './perf-hud';

/**
 * What sits over the canvas (BACKLOG 15.4): the Pitch HUD, the Perf HUD, the
 * count-in number and the idle warning. The frame loop works out what each
 * shows and sets these signals; a component re-renders only when its text
 * changes.
 */
export interface CanvasHuds {
  /** Null: hidden. */
  pitch: Signal<PitchReadout | null>;
  /** Null until the first frame with the Perf HUD on. */
  perf: Signal<PerfReadout | null>;
  countdown: Signal<string | null>;
  /** The idle warning's seconds left; null: hidden. */
  afk: Signal<string | null>;
}

export function createCanvasHuds(): CanvasHuds {
  return { pitch: signal(null), perf: signal(null), countdown: signal(null), afk: signal(null) };
}

/** Set a readout, keeping the old object when every field reads the same, so
 *  the HUD doesn't re-render each frame for nothing. */
export function setReadout<T extends object>(sig: Signal<T | null>, next: T | null): void {
  const prev = sig.peek();
  if (prev !== null && next !== null && JSON.stringify(prev) === JSON.stringify(next)) return;
  sig.value = next;
}

export function CanvasHudLayer({ huds }: { huds: CanvasHuds }) {
  return (
    <>
      <PitchHud readout={huds.pitch} />
      <PerfHud readout={huds.perf} />
      <Countdown label={huds.countdown} />
      <AfkWarning seconds={huds.afk} />
    </>
  );
}

/** Fixed-width slots, one per field, so the numbers don't shift
 *  horizontally as cents flip between e.g. "+3¢" and "-12¢". */
export function PitchHud({ readout }: { readout: Signal<PitchReadout | null> }) {
  const r = readout.value;
  return (
    <div id="pitch-hud" hidden={r === null}>
      <span class="hud-slot hud-note">{r?.name}</span>
      <span class="hud-slot hud-cents">{r?.cents}</span>
      <span class="hud-slot hud-hz">{r?.hz}</span>
      <span class="hud-slot hud-sep">{r?.raw && '·'}</span>
      <span class="hud-slot hud-note">{r?.raw?.name}</span>
      <span class="hud-slot hud-cents">{r?.raw?.cents}</span>
      <span class="hud-slot hud-dyn">{r?.dynamics}</span>
    </div>
  );
}

export function PerfHud({ readout }: { readout: Signal<PerfReadout | null> }) {
  const r = readout.value;
  const dash = '—';
  return (
    <div id="perf-hud" hidden={!store.getState().perfHudVisible}>
      <div class="perf-hud-row">
        <span class="perf-hud-label">Frame</span>
        <span class="perf-hud-val">{r?.frame ?? dash}</span>
      </div>
      <div class="perf-hud-row">
        <span class="perf-hud-label">Synths</span>
        <span class="perf-hud-val">{r?.synths ?? dash}</span>
        <span class="perf-hud-label">Oscs</span>
        <span class="perf-hud-val">{r?.oscs ?? dash}</span>
        <span class="perf-hud-label">Voices</span>
        <span class="perf-hud-val">{r?.voices ?? dash}</span>
      </div>
      <div class="perf-hud-row">
        <span class="perf-hud-label">Audio</span>
        <span class="perf-hud-val">{r?.audio ?? dash}</span>
      </div>
    </div>
  );
}

function Countdown({ label }: { label: Signal<string | null> }) {
  return <div id="countdown-overlay" hidden={label.value === null}>{label.value}</div>;
}

function AfkWarning({ seconds }: { seconds: Signal<string | null> }) {
  return (
    <div id="afk-warning" hidden={seconds.value === null}>
      <div class="afk-warning-title">Idle. Recording will pause in</div>
      <div class="afk-warning-countdown" id="afk-warning-countdown">{seconds.value ?? '0'}</div>
      <div class="afk-warning-hints">
        play something to continue recording.<br />
        Space or Esc to stop recording.<br />
        PgUp / PgDown to first / last curve.<br />
        Home to recenter on playhead.
      </div>
    </div>
  );
}
