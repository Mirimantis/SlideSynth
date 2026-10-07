import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import type { CommandRegistry } from '../commands/registry';
import { App, type AppParts } from './layout';
import { createCanvasHuds } from './canvas-huds';

const registry: CommandRegistry = {
  run: () => true,
  enabled: () => true,
  checked: () => undefined,
  installKeyboard: () => () => {},
};

/** Every action a no-op. */
const noop = <T,>() => new Proxy({}, { get: () => () => {} }) as T;

function parts(): AppParts {
  return {
    commands: registry,
    canUndo: signal(false),
    canRedo: signal(false),
    keepable: signal(0),
    toolsLocked: signal(false),
    tempo: noop(),
    snap: noop(),
    tuning: noop(),
    tracks: noop(),
    settingsOpen: signal(false),
    midi: { supported: false, devices: signal([]), activeId: signal(null), requestList: () => {}, select: () => {} },
  };
}

/** The ids main.ts and the stylesheets find the layout by. */
const IDS = [
  'toolbar', 'main-area', 'rail', 'tool-strip-host', 'drawer-host',
  'drawer-tempo', 'tempo-panel', 'drawer-snap', 'snap-panel', 'drawer-prism', 'prism-panel', 'drawer-tuning', 'tuning-panel',
  'center-stack', 'canvas-row', 'canvas-container', 'bg-canvas', 'fg-canvas',
  'pitch-hud', 'perf-hud', 'countdown-overlay', 'afk-warning', 'afk-warning-countdown',
  'zoom-y-gutter', 'zoom-y', 'zoom-x-gutter', 'zoom-x',
  'param-container', 'param-resize-handle', 'param-graph-label', 'param-canvas',
  'property-panel', 'tool-prop-content', 'prop-content', 'tracks-section', 'track-list', 'add-track-btn', 'new-tone-btn',
];

beforeEach(() => {
  store.loadComposition(createComposition());
});

describe('the layout (BACKLOG 15.3, 15.4)', () => {
  it('the shell has everything main.ts and the stylesheets look up, and no panels yet', () => {
    const html = renderToString(<App huds={createCanvasHuds()} parts={null} />);
    for (const id of IDS) expect(html, id).toContain(`id="${id}"`);
    expect(html).not.toContain('tool-strip"');
    expect(html).not.toContain('toolbar-left');
  });

  it('the second render adds the panels around the same shell', () => {
    const html = renderToString(<App huds={createCanvasHuds()} parts={parts()} />);
    for (const id of IDS) expect(html, id).toContain(`id="${id}"`);
    expect(html).toContain('id="toolbar-left"');
    expect(html).toMatch(/<div id="tool-strip-host"><div class="tool-strip"/);
    // Settings stays closed until asked for.
    expect(html).not.toContain('settings-modal');
  });

  it('leaves the zoom sliders’ values to the zoom code', () => {
    const html = renderToString(<App huds={createCanvasHuds()} parts={null} />);
    expect(html).not.toMatch(/id="zoom-[xy]"[^>]*value=/);
  });

  it('a rail icon per drawer, all closed to begin with', () => {
    const html = renderToString(<App huds={createCanvasHuds()} parts={null} />);
    expect(html.match(/class="rail-icon"/g)).toHaveLength(4);
    expect(html.match(/class="drawer"/g)).toHaveLength(4);
    expect(html).not.toContain('has-open');
    // Renamed in 16.8: Snap is Gravity, Harmonic Prism is Harmonizer.
    expect(html).toMatch(/<button class="rail-icon" data-drawer="snap" title="Gravity"/);
    expect(html).toMatch(/<button class="rail-icon" data-drawer="prism" title="Harmonizer"/);
    expect(html).toMatch(/class="drawer-header" title="Harmonizer — [^"]+: harmony on or off"/);
  });

  it('the side panel has Tool, Selection and Tracks sections', () => {
    const html = renderToString(<App huds={createCanvasHuds()} parts={null} />);
    expect([...html.matchAll(/class="panel-header">([^<]+)</g)].map(m => m[1])).toEqual(['Tool', 'Selection', 'Tracks']);
  });
});

describe('collapsed panel sections are remembered', () => {
  const saved = globalThis.localStorage;
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true });
  });

  it('opens with the sections collapsed last time', () => {
    const items = new Map([['slidesynth.collapsedPanels', JSON.stringify(['Selection'])]]);
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) },
      configurable: true,
    });
    const html = renderToString(<App huds={createCanvasHuds()} parts={null} />);
    expect(html).toContain('<div class="panel-header collapsed">Selection</div><div id="prop-content" style="display:none;">');
    expect(html).toContain('<div class="panel-header">Tool</div><div id="tool-prop-content">');
  });
});
