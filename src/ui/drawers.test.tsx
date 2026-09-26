import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { store } from '../state/store';
import { createComposition } from '../model/composition';
import { SnapPanel, type SnapActions } from './snap-panel';
import { PrismPanel } from './prism-panel';
import { TuningPanel, type TuningActions } from './tuning-panel';

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

  it('Equal names the tuning whose steps it counts in (13.8 (b))', () => {
    store.setPrismChordSpec({ tuning: '12-TET' });
    expect(renderToString(<PrismPanel />)).toMatch(/<option[^>]*selected[^>]*>Equal \(12-TET\)</);
    store.setTuning({ kind: 'edo', divisions: 19, equave: 'octave' });
    expect(renderToString(<PrismPanel />)).toMatch(/<option[^>]*selected[^>]*>Equal \(19-EDO\)</);
  });

  it('has one octave row per voice', () => {
    store.setPrismChordSpec({ numVoices: 4 });
    expect(renderToString(<PrismPanel />).match(/class="prism-voice-oct"/g)).toHaveLength(4);
  });
});

describe('Tuning drawer (BACKLOG 13.8)', () => {
  const noop: TuningActions = new Proxy({}, { get: () => () => {} }) as TuningActions;
  const panel = () => renderToString(<TuningPanel actions={noop} />);

  it('12-EDO: letters for the root, no Tuned from or Divisions', () => {
    const html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*>12-EDO/);
    expect(html).toContain('>C#</option>');
    expect(html).not.toContain('Tuned from');
    expect(html).not.toContain('Divisions');
    expect(html).toContain('Pitch lines');
    expect(html).toContain('Tune A4');
    expect(html).not.toContain('12-EDO reference');
  });

  it('other tunings offer the 12-EDO reference, which needs pitch lines (13.8 (b))', () => {
    store.setTuning({ kind: 'edo', divisions: 22, equave: 'octave' });
    expect(panel()).toMatch(/id="reference-lines-toggle"[^>]*checked/);
    store.setReferenceLines(false);
    expect(panel()).not.toMatch(/id="reference-lines-toggle"[^>]*checked/);
    store.setPitchLinesVisible(false);
    expect(panel()).toMatch(/id="reference-lines-toggle"[^>]*disabled/);
  });

  it('an equal division shows N, Tuned from, and only the scales that fit', () => {
    store.setTuning({ kind: 'edo', divisions: 24, equave: 'octave' });
    const html = panel();
    expect(html).toMatch(/id="tuning-divisions"[^>]*value="24"/);
    expect(html).toContain('Tuned from');
    expect(html).toContain('Maqam Rast');
    expect(html).not.toContain('Dorian');
  });

  it('a historical table keeps the 12-note scales', () => {
    store.setTuning({ kind: 'table', id: 'werckmeister-3' });
    const html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*>Werckmeister III/);
    expect(html).toContain('Dorian');
  });
});

