import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nudgeWeight, pushCurve, smoothCurve, pointsInReach } from './nudge';
import { createCurve, createControlPoint, addPointToCurve, pitchPoints, deepCopyPoints } from './curve';
import { createComposition } from './composition';
import { store } from '../state/store';
import { history } from '../state/history';
import { createInteraction } from '../canvas/interaction';
import { createViewport } from '../canvas/viewport';

/** The Area Nudge brush (BACKLOG 13.26). */

function curveAt(...pts: Array<[number, number]>) {
  const c = createCurve();
  for (const [x, y] of pts) addPointToCurve(c, createControlPoint(x, y));
  return c;
}
/** A wobbly glide: a point every 0.1 beat, ±20 ¢ around 6000. */
const wobble = () => curveAt(...Array.from({ length: 41 }, (_, i): [number, number] => [i * 0.1, 6000 + (i % 2 ? 20 : -20)]));
const ys = (c: ReturnType<typeof createCurve>) => pitchPoints(c).map(p => p.position.y);
const xs = (c: ReturnType<typeof createCurve>) => pitchPoints(c).map(p => p.position.x);

describe('the falloff', () => {
  it('is 1 at the centre, 0 at the edge and beyond, a half at halfway', () => {
    expect(nudgeWeight(0)).toBe(1);
    expect(nudgeWeight(1)).toBe(0);
    expect(nudgeWeight(-2)).toBe(0);
    expect(nudgeWeight(0.5)).toBeCloseTo(0.5, 9);
  });
});

describe('Push', () => {
  it('moves the centre fully and fades out; points out of reach stay', () => {
    const c = curveAt([0, 6000], [1, 6000], [2, 6000], [3, 6000], [4, 6000]);
    const orig = deepCopyPoints(pitchPoints(c));
    expect(pushCurve(c, orig, 2, 2, 0, 100)).toBe(true);
    expect(ys(c)).toEqual([6000, 6050, 6100, 6050, 6000].map(v => expect.closeTo(v, 6)));
    // Absolute from the start: dragging back puts it back.
    pushCurve(c, orig, 2, 2, 0, 0);
    expect(ys(c)).toEqual([6000, 6000, 6000, 6000, 6000]);
  });

  it('bends handles with the same field', () => {
    const c = curveAt([0, 6000], [2, 6000], [4, 6000]);
    pitchPoints(c)[1]!.handleOut = { x: 0.5, y: 0 };
    const orig = deepCopyPoints(pitchPoints(c));
    pushCurve(c, orig, 2, 2, 0, 100);
    // The tip, 0.5 beat right of the centre, moved less than the point did.
    expect(pitchPoints(c)[1]!.handleOut!.y).toBeLessThan(0);
  });

  it('in time, points never pass each other, and those out of reach stay', () => {
    const c = wobble();
    const orig = deepCopyPoints(pitchPoints(c));
    pushCurve(c, orig, 2, 0.5, 3, 0);   // a big drag right with a small brush
    const after = xs(c);
    for (let i = 1; i < after.length; i++) expect(after[i]!).toBeGreaterThan(after[i - 1]!);
    for (let i = 0; i < after.length; i++) {
      if (Math.abs(orig[i]!.position.x - 2) >= 0.5) expect(after[i]).toBe(orig[i]!.position.x);
    }
    // They piled up at the leading edge instead.
    expect(after[25]! - after[20]!).toBeLessThan(0.1);
  });

  it('can’t take a curve before beat 0', () => {
    const c = curveAt([0, 6000], [1, 6000], [2, 6000]);
    pushCurve(c, deepCopyPoints(pitchPoints(c)), 0, 1, -3, 0);
    expect(xs(c)[0]).toBe(0);
  });
});

describe('Smooth', () => {
  it('irons out wobble in pitch under the brush, and leaves the rest', () => {
    const c = wobble();
    const spread = (from: number, to: number) => {
      const v = ys(c).slice(from, to);
      return Math.max(...v) - Math.min(...v);
    };
    for (let k = 0; k < 20; k++) smoothCurve(c, 2, 0.6, 0.5, 'pitch', 0.25);
    expect(spread(18, 23)).toBeLessThan(5);
    expect(spread(0, 5)).toBe(40);   // out of reach
    expect(ys(c)[0]).toBe(5980);     // the curve's end never moves
  });

  it('in time, evens out the spacing and keeps the order', () => {
    const c = curveAt([0, 6000], [0.1, 6000], [0.2, 6000], [1.5, 6000], [2, 6000]);
    for (let k = 0; k < 30; k++) smoothCurve(c, 1, 2, 0.5, 'time', 0.25);
    const x = xs(c);
    for (let i = 1; i < x.length; i++) expect(x[i]!).toBeGreaterThan(x[i - 1]!);
    const gaps = x.slice(1).map((v, i) => v - x[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.2);
  });

  it('the brush shows the points it reaches, by weight', () => {
    const reach = pointsInReach([0, 1, 2], 1, 1);
    expect(reach).toEqual([{ index: 1, weight: 1 }]);
  });
});

describe('a Nudge stroke on the canvas', () => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: { cursor: '' }, title: '' } as unknown as HTMLCanvasElement;
  const vp = createViewport();
  const interaction = createInteraction(canvas, vp, { isPerformInputActive: () => false });
  const at = (x: number, y: number, shiftKey = false) =>
    ({ clientX: x, clientY: y, button: 0, altKey: false, shiftKey, ctrlKey: false, metaKey: false }) as PointerEvent;
  const curve = () => store.getState().composition.tracks[0]!.curves[0]!;

  beforeEach(() => {
    store.loadComposition(createComposition());
    const c = curveAt([1, 6000], [2, 6000], [3, 6000]);
    store.mutate(comp => { comp.tracks[0]!.curves.push(c); });
    store.setTool('nudge');
    store.setNudgeMode('push');
    store.setNudgeAxes('pitch');
    store.setNudgeSize(10000);   // reaches the whole curve at any zoom
    history.clear();
  });

  it('a drag is one undo step, and never snaps', () => {
    const p = vp.worldToScreen(2, 6000);
    interaction.input.down(at(p.sx, p.sy));
    interaction.input.move(at(p.sx, p.sy - 7));
    interaction.input.up(at(p.sx, p.sy - 7));
    const moved = pitchPoints(curve())[1]!.position.y;
    expect(moved).toBeGreaterThan(6000);
    expect(moved % 100).not.toBe(0);   // not on a staff line: no snap
    history.undo();
    expect(pitchPoints(curve())[1]!.position.y).toBe(6000);
  });

  it('the brush follows the cursor during a stroke, unsnapped (for the highlight and ring)', () => {
    store.setNudgeAxes('both');
    const p = vp.worldToScreen(2, 6000);
    interaction.input.down(at(p.sx, p.sy));
    interaction.input.move(at(p.sx + 30, p.sy - 7));
    const cursor = interaction.cursorWorld!;
    expect(cursor.x).toBeCloseTo(vp.screenToWorld(p.sx + 30, 0).wx, 6);
    expect(cursor.y % 100).not.toBe(0);
    // Push's band moves by the time shift so far.
    expect(interaction.nudgeDrag!.dx).toBeCloseTo(30 / vp.state.zoomX, 6);
    interaction.input.up(at(p.sx + 30, p.sy - 7));
  });

  it('a press without a drag leaves no undo step', () => {
    const p = vp.worldToScreen(2, 6000);
    interaction.input.down(at(p.sx, p.sy));
    interaction.input.up(at(p.sx, p.sy));
    expect(history.canUndo()).toBe(false);
  });
});
