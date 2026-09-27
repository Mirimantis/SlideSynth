import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fretLines, fretLinePitch, moveFretLine, shownGuides } from './frets';
import type { GuideDefinition } from '../types';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';
import { snapConfigFor } from '../state/snap-config';
import { store } from '../state/store';
import { history } from '../state/history';
import { createComposition } from './composition';
import { createInteraction } from '../canvas/interaction';
import { createViewport } from '../canvas/viewport';

const fret = (position: number, octaves = false): GuideDefinition =>
  ({ id: 'f', orientation: 'y', position, label: '', ...(octaves ? { repeat: 'octave' as const } : {}) });
const BP = 1200 * Math.log2(3);

describe('octave frets (BACKLOG 13.18)', () => {
  it('a single fret has one line; an octave fret one per period across the range', () => {
    expect(fretLines(fret(6700), 1200)).toEqual([{ k: 0, cents: 6700 }]);
    const lines = fretLines(fret(6700, true), 1200);
    expect(lines.map(l => l.cents)).toContain(700 + 1200);
    expect(lines.every(l => l.cents >= MIN_PITCH_CENTS && l.cents <= MAX_PITCH_CENTS)).toBe(true);
    expect(lines.find(l => l.k === 0)!.cents).toBe(6700);
    expect(lines[1]!.cents - lines[0]!.cents).toBe(1200);
  });

  it('repeats every period of a tuning that isn’t octave-based', () => {
    const lines = fretLines(fret(6000, true), BP);
    expect(lines[1]!.cents - lines[0]!.cents).toBeCloseTo(BP, 6);
    expect(fretLinePitch(fret(6000, true), 2, BP)).toBeCloseTo(6000 + 2 * BP, 6);
  });

  it('dragging any line moves them all by the same interval', () => {
    // Line k = 1 (7900) dragged to 8100: the placed pitch goes 6700 → 6900.
    expect(moveFretLine(fret(6700, true), 1, 8100, 1200)).toEqual({ position: 6900, k: 1 });
  });

  it('keeps the placed pitch on the range by folding it an octave', () => {
    // Placed 100 ¢ above the bottom; its line 5 octaves up dragged down 300 ¢
    // would put the placed pitch 200 ¢ below the range, so it folds up an octave.
    const moved = moveFretLine(fret(MIN_PITCH_CENTS + 100, true), 5, MIN_PITCH_CENTS + 5 * 1200 - 200, 1200);
    expect(moved.position).toBe(MIN_PITCH_CENTS - 200 + 1200);
    expect(moved.position + moved.k * 1200).toBe(MIN_PITCH_CENTS + 5 * 1200 - 200);
  });
});

describe('octave frets in snapping, the store and dragging (BACKLOG 13.18)', () => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' }, title: '' } as unknown as HTMLCanvasElement;
  const vp = createViewport();
  const interaction = createInteraction(canvas, vp, { isPerformInputActive: () => false });
  const at = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }) as PointerEvent;

  beforeEach(() => {
    store.loadComposition(createComposition());
    store.setGuidesVisible(true);
    store.setGuidesLocked(false);
    store.setTool('select');
    store.addGuide(fret(6700, true));
    history.clear();
  });

  it('pulls at every line', () => {
    const cfg = snapConfigFor(store.getState());
    expect(cfg.guideYTargets).toContain(6700);
    expect(cfg.guideYTargets).toContain(7900);
    expect(cfg.guideYTargets).toContain(5500);
    expect(snapConfigFor(store.getState(), { excludeGuideId: 'f' }).guideYTargets).toBeUndefined();
  });

  it('Single keeps only the placed pitch', () => {
    store.updateGuide('f', { repeat: undefined });
    expect(store.getComposition().guides[0]).not.toHaveProperty('repeat');
    expect(snapConfigFor(store.getState()).guideYTargets).toEqual([6700]);
  });

  it('grabbing another octave’s line selects the fret and moves every line', () => {
    vp.setZoomY(0.14);
    const y = (cents: number) => vp.worldToScreen(0, cents).sy;
    interaction.input.down(at(300, y(7900)));
    expect(store.getState().selectedGuideId).toBe('f');
    expect(interaction.draggingGuideLine).toBe(1);
    interaction.input.move(at(300, y(8100)));
    interaction.input.up(at(300, y(8100)));
    expect(store.getComposition().guides[0]!.position).toBe(6900);
  });
});

describe('Frets hidden (BACKLOG 13.22)', () => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' }, title: '' } as unknown as HTMLCanvasElement;
  const vp = createViewport();
  const interaction = createInteraction(canvas, vp, { isPerformInputActive: () => false });
  const at = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }) as PointerEvent;
  const beatGuide: GuideDefinition = { id: 'b', orientation: 'x', position: 4, label: '' };

  beforeEach(() => {
    store.loadComposition(createComposition());
    store.setGuidesVisible(true);
    store.setGuidesLocked(false);
    store.setFretsVisible(true);
    store.setTool('select');
    store.addGuide(fret(6700));
    store.addGuide(beatGuide);
  });

  it('only frets hide; beat guides stay on show', () => {
    store.setFretsVisible(false);
    expect(shownGuides(store.getState()).map(g => g.id)).toEqual(['b']);
    store.setGuidesVisible(false);
    expect(shownGuides(store.getState())).toEqual([]);
    store.setGuidesVisible(true);
    store.setFretsVisible(true);
    expect(shownGuides(store.getState()).map(g => g.id)).toEqual(['f', 'b']);
  });

  it('hiding them lets go of a selected fret, not a selected beat guide', () => {
    store.setSelectedGuide('f');
    store.setFretsVisible(false);
    expect(store.getState().selectedGuideId).toBeNull();
    store.setSelectedGuide('b');
    store.setGuidesVisible(true);
    store.setFretsVisible(true);
    store.setFretsVisible(false);
    expect(store.getState().selectedGuideId).toBe('b');
  });

  it('a hidden fret can’t be picked on the canvas', () => {
    vp.setZoomY(0.14);
    store.setFretsVisible(false);
    interaction.input.down(at(300, vp.worldToScreen(0, 6700).sy));
    interaction.input.up(at(300, vp.worldToScreen(0, 6700).sy));
    expect(store.getState().selectedGuideId).toBeNull();
    expect(store.getComposition().guides.find(g => g.id === 'f')!.position).toBe(6700);
  });

  it('Scale → frets brings the frets back', () => {
    store.setFretsVisible(false);
    store.addScaleFrets();
    expect(store.getState().fretsVisible).toBe(true);
  });
});
