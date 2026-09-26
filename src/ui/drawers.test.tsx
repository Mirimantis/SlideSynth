import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { SnapPanel, type SnapActions } from './snap-panel';
import { PrismPanel } from './prism-panel';

const actions: SnapActions = {
  askPresetName: async () => null,
  confirmDeletePreset: () => false,
  addGuide: () => {},
  redrawGuides: () => {},
  notify: () => {},
};

beforeEach(() => {
  store.loadComposition(createComposition());
  store.setGuidesLocked(false);
});

describe('Snap drawer (BACKLOG 16.4)', () => {
  const panel = () => renderToString(<SnapPanel actions={actions} />);

  it('calls the physics Gravity, not Magnetic', () => {
    const html = panel();
    expect(html).toContain('>Gravity</span>');
    expect(html).not.toMatch(/Magnetic/i);
  });

  it('names the preset the feel matches, and says Custom once it drifts', () => {
    expect(panel()).toMatch(/<option[^>]*selected[^>]*>Standard</);
    store.setMagneticStrength(0.123);
    expect(panel()).toMatch(/<option[^>]*selected[^>]*>Custom</);
  });

  it('locked guides can’t be added to', () => {
    expect(panel()).not.toMatch(/id="add-guide-x-btn"[^>]*disabled/);
    store.setGuidesLocked(true);
    expect(panel()).toMatch(/id="add-guide-x-btn"[^>]*disabled/);
  });
});

describe('Harmonic Prism drawer (BACKLOG 16.4)', () => {
  it('calls the chord tuning Intonation (Equal / Just)', () => {
    store.setPrismChordSpec({ tuning: 'just-intonation' });
    const html = renderToString(<PrismPanel />);
    expect(html).toContain('>Intonation</label>');
    expect(html).toMatch(/<option[^>]*selected[^>]*>Just</);
    expect(html).not.toContain('>Tuning</label>');
  });

  it('has one octave row per voice', () => {
    store.setPrismChordSpec({ numVoices: 4 });
    expect(renderToString(<PrismPanel />).match(/class="prism-voice-oct"/g)).toHaveLength(4);
  });
});
