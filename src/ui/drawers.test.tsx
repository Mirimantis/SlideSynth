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

  it('offers Gravity’s two feels, Instant and Glissando, and never says Magnetic (16.8)', () => {
    store.setMagneticEnabled(true);
    let html = panel();
    expect(html).toMatch(/id="gravity-feel-glissando" checked/);
    expect(html).not.toMatch(/id="gravity-force"[^>]*disabled/);
    // What the user reads: the text and the tooltips (ids keep their old names).
    const read = [...html.matchAll(/title="([^"]*)"|>([^<]+)</g)].map(m => m[1] ?? m[2]).join(' ');
    expect(read).not.toMatch(/Magnetic|Snap/i);
    // Instant doesn't use Glissando's sliders.
    store.setMagneticEnabled(false);
    html = panel();
    expect(html).toMatch(/id="gravity-feel-instant" checked/);
    expect(html).toMatch(/id="gravity-force"[^>]*disabled/);
    expect(html).toMatch(/id="gravity-speed"[^>]*disabled/);
    store.setMagneticEnabled(true);
  });

  it('names the preset the feel matches, and says Custom once it drifts', () => {
    expect(panel()).toMatch(/<option[^>]*selected[^>]*>Standard</);
    store.setMagneticStrength(0.123);
    expect(panel()).toMatch(/<option[^>]*selected[^>]*>Custom</);
  });

  it('adds frets and beat guides, not Y and X guides (13.16)', () => {
    const html = panel();
    expect(html).toMatch(/id="add-guide-y-btn"[^>]*>\+ Fret</);
    expect(html).toMatch(/id="add-guide-x-btn"[^>]*>\+ Beat</);
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

  it('Equal counts from the root, Per note in the named tuning (13.8 (b), 13.21)', () => {
    store.setPrismChordSpec({ tuning: '12-TET' });
    let html = renderToString(<PrismPanel />);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Equal \(12-TET\)</);
    // In 12-EDO Per note is the same as Equal, so it isn't offered.
    expect(html).not.toContain('value="per-note"');
    store.setTuning({ kind: 'edo', divisions: 19, equave: 'octave' });
    html = renderToString(<PrismPanel />);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Equal \(from root\)</);
    expect(html).toMatch(/<option value="per-note">Per note \(19-EDO\)</);
  });

  it('has one octave row per voice, under a Voicing header that collapses them', () => {
    store.setPrismChordSpec({ numVoices: 4 });
    const html = renderToString(<PrismPanel />);
    expect(html.match(/class="prism-voice-oct"/g)).toHaveLength(4);
    expect(html).toMatch(/<div class="panel-header" style="margin-top:8px">Voicing<\/div><div>(.(?!panel-header))*prism-voice-oct/s);
  });
});

describe('Tuning drawer (BACKLOG 13.8)', () => {
  const noop: TuningActions = new Proxy({}, { get: () => () => {} }) as TuningActions;
  const panel = () => renderToString(<TuningPanel actions={noop} />);

  it('12-EDO: letters for the root, no Tuned from or Divisions', () => {
    const html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*>12-EDO/);
    expect(html).toContain('>C#</option>');
    expect(html).not.toContain('id="tuning-from"');
    expect(html).not.toContain('Divisions');
    expect(html).toContain('Pitch lines');
    expect(html).toContain('Tune A4');
    expect(html).not.toContain('12-EDO reference');
  });

  it('other tunings offer the 12-EDO reference, which needs pitch lines (13.8 (b))', () => {
    store.setTuning({ kind: 'edo', divisions: 22, equave: 'octave' });
    // Off by default: too busy most of the time (13.8 (f)).
    expect(panel()).toMatch(/id="reference-lines-toggle"/);
    expect(panel()).not.toMatch(/id="reference-lines-toggle"[^>]*checked/);
    store.setReferenceLines(true);
    expect(panel()).toMatch(/id="reference-lines-toggle"[^>]*checked/);
    store.setPitchLinesVisible(false);
    expect(panel()).toMatch(/id="reference-lines-toggle"[^>]*disabled/);
  });

  it('an equal division shows N, Tuned from, and only the scales that fit', () => {
    store.setTuning({ kind: 'edo', divisions: 24, equave: 'octave' });
    const html = panel();
    expect(html).toMatch(/id="tuning-divisions"[^>]*value="24"/);
    expect(html).toContain('id="tuning-from"');
    expect(html).toContain('Maqam Rast');
    expect(html).not.toContain('Dorian');
  });

  it('draws the pitch circle: a tick per degree, a dot per scale note, a ring on the root (13.8 (c))', () => {
    store.setRoot(2);
    store.setScaleId('major');
    const html = panel();
    expect(html.match(/class="pitch-circle-tick"/g)).toHaveLength(12);
    expect(html.match(/class="pitch-circle-dot"/g)).toHaveLength(7);
    expect(html.match(/class="pitch-circle-root"/g)).toHaveLength(1);
    expect(html).toMatch(/class="pitch-circle-degree in-scale root" data-degree="2"/);
    expect(html).not.toContain('pitch-circle-standard');   // 12-EDO has no inner ring
  });

  it('other octave tunings get the 12-note inner ring; Bohlen–Pierce doesn’t', () => {
    store.setTuning({ kind: 'edo', divisions: 19, equave: 'octave' });
    expect(panel().match(/class="pitch-circle-standard-dot"/g)).toHaveLength(12);
    store.setTuning({ kind: 'edo', divisions: 13, equave: 'tritave' });
    expect(panel()).not.toContain('pitch-circle-standard');
  });

  it('offers the Custom scale once there is one that fits', () => {
    store.setScaleId('all'); // from All notes (a new composition starts in Major)
    expect(panel()).not.toContain('value="custom"');
    store.toggleScaleDegree(1);
    const html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*value="custom"[^>]*>Custom \(11 notes\)</);
    expect(html).toContain('Custom (11 notes)</text>');
  });

  it('offers the imported .scl tuning, with its description as plain text (13.8 (d))', () => {
    expect(panel()).not.toContain('Imported (.scl)');
    store.importTuning({
      kind: 'imported', name: 'meanquar', description: '<b>Aaron</b>', degrees: [0, 400, 700], period: 1200,
      ratios: [null, null, null], periodRatio: null,
    });
    let html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*value="imported"[^>]*>meanquar \(3 notes\)</);
    expect(html).toContain('&lt;b>Aaron&lt;/b>');
    expect(html).not.toContain('<b>Aaron');
    store.setTuning({ kind: 'edo', divisions: 12, equave: 'octave' });
    html = panel();
    expect(html).toContain('meanquar (3 notes)');
    expect(html).not.toContain('class="tuning-description"');
  });

  it('a historical table keeps the 12-note scales', () => {
    store.setTuning({ kind: 'table', id: 'werckmeister-3' });
    const html = panel();
    expect(html).toMatch(/<option[^>]*selected[^>]*>Werckmeister III/);
    expect(html).toContain('Dorian');
  });
});

