import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInteraction, overGuideHandle, GUIDE_HANDLE_WIDTH, RULER_HEIGHT } from './interaction';
import { createViewport } from './viewport';
import { store } from '../state/store';
import { history } from '../state/history';
import { createComposition } from '../model/composition';

/**
 * The guide handle (BACKLOG 13.17): drag down out of the ruler's left end
 * for a fret, right for a beat guide; back onto the handle to cancel.
 */

// Just enough of a canvas for the interaction: it reads its position and sets
// a cursor. It also listens for keys on the window.
vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' }, title: '' } as unknown as HTMLCanvasElement;
const interaction = createInteraction(canvas, createViewport(), { isPerformInputActive: () => false });
const at = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }) as PointerEvent;
const drag = (...path: Array<[number, number]>) => {
  interaction.input.down(at(...path[0]!));
  for (const p of path.slice(1)) interaction.input.move(at(...p));
  interaction.input.up(at(...path[path.length - 1]!));
};
const guides = () => store.getComposition().guides;

beforeEach(() => {
  store.loadComposition(createComposition());
  store.setGuidesLocked(false);
  history.clear();
});

describe('the guide handle (BACKLOG 13.17)', () => {
  it('sits at the ruler’s left end', () => {
    expect(overGuideHandle(GUIDE_HANDLE_WIDTH - 1, RULER_HEIGHT - 1)).toBe(true);
    expect(overGuideHandle(GUIDE_HANDLE_WIDTH, 10)).toBe(false);
    expect(overGuideHandle(5, RULER_HEIGHT)).toBe(false);
  });

  it('down makes a fret, right a beat guide; each selected and one undo step', () => {
    drag([6, 20], [7, 60], [8, 300]);
    expect(guides()).toHaveLength(1);
    expect(guides()[0]!.orientation).toBe('y');
    expect(store.getState().selectedGuideId).toBe(guides()[0]!.id);

    drag([6, 20], [60, 22], [300, 25]);
    expect(guides().map(g => g.orientation)).toEqual(['y', 'x']);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(guides()).toHaveLength(1);
  });

  it('waits for one direction to lead clearly', () => {
    drag([6, 20], [14, 28], [16, 30]);
    expect(guides()).toHaveLength(0);
  });

  it('released back on the handle, the guide is gone and leaves no undo step', () => {
    drag([6, 20], [7, 200], [6, 30]);
    expect(guides()).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
  });

  it('does nothing while guides are locked', () => {
    store.setGuidesLocked(true);
    drag([6, 20], [7, 60], [8, 300]);
    expect(guides()).toHaveLength(0);
  });
});
