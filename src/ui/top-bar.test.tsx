import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { TRANSPORT_STOPPED } from '../state/transport';
import type { CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';
import { MenuItems } from './menu';
import { TopBar } from './top-bar';
import { TempoPanel } from './tempo-panel';
import { SettingsDialog } from './settings-dialog';
import { ToolPropertyPanel } from './tool-property-panel';

/** A registry stub: `off` commands are disabled, `on` are checked settings. */
function registry(off: CommandId[] = [], on: CommandId[] = [], checkable: CommandId[] = []): CommandRegistry {
  return {
    run: () => true,
    enabled: id => !off.includes(id),
    checked: id => (checkable.includes(id) ? on.includes(id) : undefined),
    installKeyboard: () => () => {},
  };
}

function seed() {
  const comp = createComposition();
  comp.name = 'Sketch';
  comp.bpm = 96;
  comp.beatsPerMeasure = 6;
  comp.timeSignatureDenominator = 8;
  const track = createTrack('Lead', comp.toneLibrary[0]!.id);
  comp.tracks = [track];
  store.loadComposition(comp);
  store.setSelectedTrack(track.id);
  store.setTransport(TRANSPORT_STOPPED);
  store.setPerformMode(false);
}

describe('menus (BACKLOG 16.3)', () => {
  it('show label and shortcut, grey out what can’t run, and check settings that are on', () => {
    const html = renderToString(
      <MenuItems
        entries={['edit.undo', '-', 'view.pitchHud', 'view.perfHud']}
        commands={registry(['edit.undo'], ['view.pitchHud'], ['view.pitchHud', 'view.perfHud'])}
        onPick={() => {}}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Undo.*Ctrl\+Z/);
    expect(html).toContain('role="separator"');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*✓.*Pitch HUD/);
    expect(html).toMatch(/aria-checked="false"[^>]*>.*Perf HUD/);
  });
});

describe('top bar (BACKLOG 16.3)', () => {
  beforeEach(seed);

  const bar = (keep = 0) => renderToString(
    <TopBar
      commands={registry()}
      menus={[{ label: 'File', entries: ['file.save'] }, { label: 'Edit', entries: [] }, { label: 'View', entries: [] }]}
      canUndo={signal(false)}
      canRedo={signal(true)}
      keepable={signal(keep)}
    />,
  );

  it('shows the name and menus, and neither tempo nor Perform (the strip has it)', () => {
    const html = bar();
    expect(html).toContain('value="Sketch"');
    for (const label of ['File', 'Edit', 'View']) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('BPM');
    expect(html).not.toMatch(/Perform|Jam/);
  });

  it('Play and Pause share one button that follows the transport', () => {
    expect(bar()).toContain('aria-label="Play"');
    store.setTransport({ mode: 'playing', clock: 'open', capture: 'none', countdownStartedAt: 0 });
    expect(bar()).toContain('aria-label="Pause"');
  });

  it('Keep lights up when there is something to keep', () => {
    expect(bar(0)).toMatch(/class="keep-btn"[^>]*disabled/);
    expect(bar(2)).toContain('2 keepable');
  });
});

describe('Tempo drawer and Settings (BACKLOG 16.3)', () => {
  beforeEach(seed);

  it('the Tempo drawer shows the composition’s tempo and meter', () => {
    const html = renderToString(<TempoPanel actions={{ setBpm: () => {}, setTimeSignature: () => {} }} />);
    expect(html).toContain('value="96"');
    expect(html).toMatch(/<option[^>]*selected[^>]*>6\/8/);
  });

  it('Settings renders only while open', () => {
    const open = signal(false);
    const midi = {
      supported: true,
      devices: signal([{ id: 'k1', name: 'Keystation' }]),
      activeId: signal<string | null>('k1'),
      requestList: () => {},
      select: () => {},
    };
    expect(renderToString(<SettingsDialog open={open} midi={midi} />)).toBe('');
    open.value = true;
    const html = renderToString(<SettingsDialog open={open} midi={midi} />);
    expect(html).toContain('Keystation');
    expect(html).toContain('Audible scrub');
  });

  it('in Perform, the Tool panel holds the dynamics choice', () => {
    store.setPerformMode(true);
    expect(renderToString(<ToolPropertyPanel />)).toContain('Key swell');
  });
});
