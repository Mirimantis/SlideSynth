import { describe, it, expect } from 'vitest';
import { formatCents, formatDynamics, formatHz } from './pitch-hud';
import { sliderPosToZoomX, zoomXToSliderPos } from './zoom-sliders';
import { createFrameTimes } from './frame-times';
import { MIN_ZOOM_X, MAX_ZOOM_X } from '../constants';

// Pieces split out of main.ts in 15.3.

describe('Pitch HUD formatting', () => {
  it('signs cents and leaves an exact note blank', () => {
    expect(formatCents(0)).toBe('');
    expect(formatCents(12)).toBe('+12¢');
    expect(formatCents(-3)).toBe('-3¢');
  });

  it('gives low frequencies an extra decimal', () => {
    expect(formatHz(55)).toBe('55.00 Hz');
    expect(formatHz(440)).toBe('440.0 Hz');
  });

  it('draws the dynamics as a bar of one to four steps, clamped', () => {
    expect(formatDynamics(0)).toBe('▁ 0.00');
    expect(formatDynamics(0.5)).toBe('▁▃ 0.50');
    expect(formatDynamics(1)).toBe('▁▃▅▇ 1.00');
    expect(formatDynamics(3)).toBe('▁▃▅▇ 1.00');
  });
});

describe('the time-zoom slider', () => {
  it('spans the zoom range end to end, logarithmically', () => {
    expect(sliderPosToZoomX(0)).toBeCloseTo(MIN_ZOOM_X);
    expect(sliderPosToZoomX(1000)).toBeCloseTo(MAX_ZOOM_X);
    expect(sliderPosToZoomX(500)).toBeCloseTo(Math.sqrt(MIN_ZOOM_X * MAX_ZOOM_X));
  });

  it('maps a zoom to the slider and back', () => {
    for (const pos of [0, 137, 500, 999]) expect(zoomXToSliderPos(sliderPosToZoomX(pos))).toBe(pos);
    expect(zoomXToSliderPos(MAX_ZOOM_X * 10)).toBe(1000);
  });
});

describe('frame times', () => {
  it('reports percentiles of the frame gaps, 0 before any', () => {
    const ft = createFrameTimes();
    expect(ft.percentile(0.5)).toBe(0);
    let t = 1000;
    ft.push(t);
    for (const gap of [16, 16, 17, 16, 50]) { t += gap; ft.push(t); }
    expect(ft.percentile(0.5)).toBeCloseTo(16);
    expect(ft.percentile(0.99)).toBeCloseTo(50);
  });
});
