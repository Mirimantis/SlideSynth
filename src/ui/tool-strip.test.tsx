import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { createTrack } from '../model/track';
import { TRANSPORT_STOPPED } from '../state/transport';
import type { CommandRegistry } from '../commands/registry';
import { ToolStrip } from './tool-strip';

const commands: CommandRegistry = {
  run: () => true,
  enabled: () => true,
  checked: () => undefined,
  installKeyboard: () => () => {},
};

function seed() {
  const comp = createComposition();
  const track = createTrack('Lead', comp.toneLibrary[0]!.id);
  comp.tracks = [track];
  store.loadComposition(comp);
  store.setSelectedTrack(track.id);
  store.setTransport(TRANSPORT_STOPPED);
  store.setPerformMode(false);
  store.setTool('select');
  store.setPrismDrawMode(false);
  store.setPrismChordSpec({ numVoices: 3 });
}

const strip = (locked = false) => renderToString(<ToolStrip commands={commands} locked={signal(locked)} />);
/** The aria-labels of the lit buttons. */
const lit = (html: string) => [...html.matchAll(/aria-label="([^"]+)" aria-pressed="true"/g)].map(m => m[1]);

describe('tool strip (BACKLOG 16.4)', () => {
  beforeEach(seed);

  it('holds the four tools and the Perform entry, and lights the active tool', () => {
    const html = strip();
    for (const label of ['Draw', 'Select', 'Delete', 'Slice', 'Perform']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(lit(html)).toEqual(['Select']);
  });

  it('in Perform, lights Perform and no tool', () => {
    store.setPerformMode(true);
    expect(lit(strip())).toEqual(['Perform']);
  });

  it('a recording keeps Perform lit but not clickable', () => {
    store.setPerformMode(true);
    store.setTransport({ mode: 'playing', clock: 'play', capture: 'armed', countdownStartedAt: 0 });
    expect(strip()).toMatch(/<button[^>]*perform-entry[^>]*disabled/);
  });

  it('greys every button while the left button is sounding', () => {
    expect(strip(true).match(/disabled/g)).toHaveLength(5);
  });

  it('shows the chord badge on Draw and Perform only while Prism Draw is on', () => {
    expect(strip()).not.toContain('chord-badge');
    store.setPrismDrawMode(true);
    const html = strip();
    expect(html.match(/class="chord-badge"[^>]*>3</g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="Draw"[^]*chord-badge[^]*aria-label="Select"/);
  });
});
