import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { TRANSPORT_STOPPED } from '../state/transport';
import { JAM_IDLE_TIMEOUT_MS } from '../constants';
import type { AppState, ToneDefinition, TransportState } from '../types';
import { ToneBuilder } from './tone-builder';
import { TonePicker } from './tone-picker';
import { ContextMenu } from './context-menu';
import { MidiArmDialog } from './midi-arm-dialog';
import { PresetSaveDialog } from './preset-save-dialog';
import { PitchHud, PerfHud } from './canvas-huds';
import { pitchReadout, type PitchReadout } from './pitch-hud';
import { perfReadout, type PerfReadout } from './perf-hud';
import { afkLabel, countdownLabel, AFK_WARNING_LEAD_MS } from './session-overlays';

// BACKLOG 15.4: the last dialogs, menus and HUDs that built their DOM by hand.

const noop = () => {};

function tone(over: Partial<ToneDefinition> = {}): ToneDefinition {
  return {
    id: 'tone-x', name: 'Reed', color: '#123456', dashPattern: [12, 4],
    layers: [{ type: 'sawtooth', gain: 0.5, detune: 0 }, { type: 'sine', gain: 0.25, detune: 7 }],
    distortion: null,
    ...over,
  };
}

beforeEach(() => {
  store.loadComposition(createComposition());
  store.setTransport(TRANSPORT_STOPPED);
});

describe('tone builder', () => {
  it('a new tone: one sine layer, no Remove, no distortion controls', () => {
    const html = renderToString(<ToneBuilder onDone={noop} />);
    expect(html).toContain('<h2>New Tone</h2>');
    expect(html).toMatch(/id="tb-name"[^>]*value="New Tone"/);
    expect(html.match(/class="tb-layer"/g)).toHaveLength(1);
    expect(html).not.toContain('tb-remove-layer');
    expect(html).not.toContain('tb-dist-controls');
  });

  it('editing: the tone’s values, its line style, and Remove on each layer', () => {
    const html = renderToString(<ToneBuilder existing={tone({ distortion: { amount: 0.42, oversample: '2x' } })} onDone={noop} />);
    expect(html).toContain('<h2>Edit Tone</h2>');
    expect(html).toMatch(/<option[^>]*selected[^>]*>Dashed</);
    expect(html.match(/tb-remove-layer/g)).toHaveLength(2);
    expect(html).toMatch(/<option[^>]*selected[^>]*>sawtooth</);
    expect(html).toContain('<span class="tb-layer-gain-val">0.25</span>');
    expect(html).toContain('<span id="tb-dist-amount-val">0.42</span>');
    expect(html).toMatch(/<option[^>]*selected[^>]*>2x</);
    // Nothing plays until Preview.
    expect(html).toMatch(/id="tb-stop-preview"[^>]*disabled/);
  });

  it('a name with quotes and brackets stays text', () => {
    const html = renderToString(<ToneBuilder existing={tone({ name: 'A "big" <b>' })} onDone={noop} />);
    expect(html).toContain('value="A &quot;big&quot; &lt;b>"');
  });
});

describe('tone picker', () => {
  it('lists the tones with their layers, marking the current one', () => {
    const tones = [tone(), tone({ id: 'tone-y', name: 'Flute', layers: [{ type: 'triangle', gain: 1, detune: 0 }] })];
    const html = renderToString(<TonePicker tones={tones} currentToneId="tone-y" anchor={{ top: 10, bottom: 30, left: 50 }} onPick={noop} />);
    expect(html).toContain('style="top:34px;left:50px;"');
    expect(html.match(/class="tone-picker-item"/g)).toHaveLength(1);
    expect(html).toMatch(/class="tone-picker-item current">.*Flute/);
    expect(html).toContain('<span class="tone-picker-info">S+S</span>');
    expect(html).toContain('<span class="tone-picker-info">T</span>');
  });
});

describe('context menu', () => {
  it('shows each item’s shortcut, and greys out what can’t run', () => {
    const html = renderToString(<ContextMenu x={0} y={0} onClose={noop} items={[
      { label: 'Smooth Curve', shortcut: 'Shift+S', onClick: noop },
      { label: 'Join', disabled: true, onClick: noop },
    ]} />);
    expect(html).toContain('<div class="context-menu-item"><span class="context-menu-label">Smooth Curve</span><span class="context-menu-shortcut">Shift+S</span></div>');
    expect(html).toContain('<div class="context-menu-item disabled"><span class="context-menu-label">Join</span></div>');
  });
});

describe('MIDI arm dialog', () => {
  const comp = createComposition();
  const lead = createTrack('Lead', comp.toneLibrary[0]!.id);
  const bass = createTrack('Bass <low>', 'no-such-tone');

  it('offers the tracks, the first chosen', () => {
    const html = renderToString(<MidiArmDialog tracks={[lead, bass]} toneLibrary={comp.toneLibrary} onDone={noop} />);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`value="${lead.id}" checked`));
    expect(html).toContain('Bass &lt;low>');
    expect(html).toContain('<span class="midi-arm-tone" style="color:var(--tone-fallback);">?</span>');
    expect(html).toContain('id="midi-arm-confirm"');
  });

  it('with no tracks, only a new one or Cancel', () => {
    const html = renderToString(<MidiArmDialog tracks={[]} toneLibrary={comp.toneLibrary} onDone={noop} />);
    expect(html).toContain('No tracks yet');
    expect(html).not.toContain('id="midi-arm-confirm"');
    expect(html).toContain('id="midi-arm-new"');
  });
});

describe('preset save dialog', () => {
  it('starts from the given name, with no warning', () => {
    const html = renderToString(<PresetSaveDialog title="Save Snap Preset" initialName="Mine" existingNames={[]} onDone={noop} />);
    expect(html).toContain('<h2>Save Snap Preset</h2>');
    expect(html).toMatch(/id="ps-name"[^>]*value="Mine"/);
    expect(html).toMatch(/id="ps-warning" hidden/);
  });
});

describe('HUDs over the canvas', () => {
  const state = (): AppState => store.getState();

  it('Pitch HUD: the note, and the raw pitch only when it’s 2¢ or more away', () => {
    const r = pitchReadout(state(), 6900, 6901, null);
    expect(r).toEqual({ name: 'A4', cents: '', hz: '440.0 Hz', raw: null, dynamics: '' });
    const off = pitchReadout(state(), 6900, 6930, 0.5);
    expect(off.raw).toEqual({ name: 'A4', cents: '+30¢' });
    expect(off.dynamics).toBe('▁▃ 0.50');
  });

  it('Pitch HUD: hidden without a readout, a separator only with a raw pitch', () => {
    expect(renderToString(<PitchHud readout={signal<PitchReadout | null>(null)} />)).toMatch(/^<div id="pitch-hud" hidden>/);
    const html = renderToString(<PitchHud readout={signal<PitchReadout | null>(pitchReadout(state(), 6900, 6930, null))} />);
    expect(html).toContain('<div id="pitch-hud"><span class="hud-slot hud-note">A4</span>');
    expect(html).toContain('<span class="hud-slot hud-sep">·</span>');
  });

  it('Perf HUD: dashes before the first frame, shown when View › Perf HUD is on', () => {
    store.setPerfHudVisible(false);
    expect(renderToString(<PerfHud readout={signal<PerfReadout | null>(null)} />)).toMatch(/^<div id="perf-hud" hidden>.*—/);
    store.setPerfHudVisible(true);
    const r = perfReadout({ frameMsP50: 16.66, frameMsP99: 33.3, synthCount: 2, oscillatorCount: 5, voiceCount: 1, audioBaseLatencyMs: 10, liveVoiceMode: 'worklet' });
    const html = renderToString(<PerfHud readout={signal<PerfReadout | null>(r)} />);
    expect(html).toMatch(/^<div id="perf-hud">/);
    expect(html).toContain('16.7 / 33.3 ms');
    expect(html).toContain('10.0 ms latency · live: worklet');
    store.setPerfHudVisible(false);
  });

  const engine = (idleMs: number) => ({
    getCountdownLabel: () => '3',
    getIdleMs: () => idleMs,
    getAfkTimeoutMs: () => 60_000,
  });
  const rolling = (over: Partial<TransportState>): AppState => ({ ...state(), transport: { mode: 'playing', clock: 'open', capture: 'none', countdownStartedAt: 0, ...over } });

  it('the count-in shows only during a count-in', () => {
    expect(countdownLabel(state(), engine(0), 0)).toBeNull();
    expect(countdownLabel({ ...state(), transport: { mode: 'countdown', clock: 'play', capture: 'armed', countdownStartedAt: 5 } }, engine(0), 6)).toBe('3');
  });

  it('the idle warning counts down the last 30 s before an idle stop', () => {
    const jam = rolling({});
    expect(afkLabel(jam, engine(0), true, 0)).toBeNull();
    expect(afkLabel(jam, engine(JAM_IDLE_TIMEOUT_MS - AFK_WARNING_LEAD_MS + 500), true, 0)).toBe('30s');
    // A recording stops sooner (the engine's AFK timeout).
    const rec = rolling({ clock: 'play', capture: 'armed' });
    expect(afkLabel(rec, engine(55_500), true, 0)).toBe('5s');
    expect(afkLabel(rec, engine(70_000), true, 0)).toBe('0s');
    // Not while the engine isn't playing, nor when stopped.
    expect(afkLabel(rec, engine(55_500), false, 0)).toBeNull();
    expect(afkLabel(state(), engine(55_500), true, 0)).toBeNull();
  });
});
