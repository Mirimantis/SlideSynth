import type { BezierCurve } from '../types';
import type { ParamViewport } from './param-viewport';
import { store } from '../state/store';
import { history } from '../state/history';
import {
  addParamPoint, removeParamPoint, moveParamPoint, createParamPoint, ensureVolumeParam,
  setParamHandle, applyAutoSmoothParamHandles, reclampParamHandlesAround,
} from '../model/param-curve';
import { distToPoint } from '../utils/bezier-math';

const HIT_RADIUS_PX = 8;

// 'point' — move the anchor. 'handleIn'/'handleOut' — drag one handle (from a
// handle dot; asymmetric). 'penPull' — pull a fresh, mirrored handle out of a
// point in Draw mode (matches the pitch pen tool).
type DragMode = 'point' | 'handleIn' | 'handleOut' | 'penPull' | null;

export interface ParamInteraction {
  /** Index of the param point being edited (for the renderer's highlight). */
  selectedIndex(): number | null;
  /** Clear the selected param point (e.g. when the selected curve changes). */
  resetSelection(): void;
}

/**
 * Wire pointer interaction on the Parameters Graph canvas for the currently
 * selected curve's volume lane. Respects the active tool:
 *   - Draw: click empty space to place a point (auto-smoothed if the Bezier
 *     Auto-Smoothing toggle is on); click+drag a point or its handles to shape.
 *   - Delete: click a point to remove it (keeps >= 1).
 *   - Select / Scissors: drag points and handles.
 * Double-click adds a point and right-click removes one, in any tool.
 * Point X is clamped to the pitch curve's time extent so the lane stays aligned.
 */
export function createParamInteraction(
  canvas: HTMLCanvasElement,
  pvp: ParamViewport,
  getSelectedCurve: () => BezierCurve | null,
): ParamInteraction {
  let selectedIndex: number | null = null;
  let drag: DragMode = null;

  function localPos(e: MouseEvent): { sx: number; sy: number } {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  /** Pitch curve's [startBeat, endBeat] — the lane's valid X range. */
  function pitchExtent(curve: BezierCurve): [number, number] | null {
    const n = curve.points.length;
    if (n < 1) return null;
    return [curve.points[0]!.position.x, curve.points[n - 1]!.position.x];
  }

  function clampBeat(curve: BezierCurve, beat: number): number {
    const ext = pitchExtent(curve);
    if (!ext) return beat;
    return Math.max(ext[0], Math.min(ext[1], beat));
  }

  function hitPoint(curve: BezierCurve, sx: number, sy: number): number | null {
    const lane = curve.parameters?.volume;
    if (!lane) return null;
    for (let i = 0; i < lane.points.length; i++) {
      const pt = lane.points[i]!;
      const s = pvp.worldToScreen(pt.position.x, pt.position.y);
      if (distToPoint({ x: sx, y: sy }, { x: s.sx, y: s.sy }) <= HIT_RADIUS_PX) return i;
    }
    return null;
  }

  function hitHandle(curve: BezierCurve, sx: number, sy: number): 'in' | 'out' | null {
    if (selectedIndex === null) return null;
    const pt = curve.parameters?.volume?.points[selectedIndex];
    if (!pt) return null;
    const checks: Array<['in' | 'out', { x: number; y: number } | null]> = [
      ['in', pt.handleIn], ['out', pt.handleOut],
    ];
    for (const [which, h] of checks) {
      if (!h) continue;
      const s = pvp.worldToScreen(pt.position.x + h.x, pt.position.y + h.y);
      if (distToPoint({ x: sx, y: sy }, { x: s.sx, y: s.sy }) <= HIT_RADIUS_PX) return which;
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const curve = getSelectedCurve();
    if (!curve) return;
    const tool = store.getState().activeTool;
    const ctrl = e.ctrlKey || e.metaKey;
    const { sx, sy } = localPos(e);

    // Handle dots of the selected point take priority (drag a single handle).
    const handle = hitHandle(curve, sx, sy);
    if (handle) {
      drag = handle === 'in' ? 'handleIn' : 'handleOut';
      history.snapshot();
      e.preventDefault();
      return;
    }

    const idx = hitPoint(curve, sx, sy);
    if (idx !== null) {
      if (tool === 'delete') {
        const lane = curve.parameters?.volume;
        if (lane && lane.points.length > 1) {
          history.snapshot();
          store.mutate(() => { removeParamPoint(lane, idx); });
          if (selectedIndex === idx) selectedIndex = null;
        }
        e.preventDefault();
        return;
      }
      selectedIndex = idx;
      // Draw tool (pen): drag pulls a fresh handle out of the point. Ctrl, or any
      // non-draw tool, moves the point instead.
      drag = (tool === 'draw' && !ctrl) ? 'penPull' : 'point';
      history.snapshot();
      e.preventDefault();
      return;
    }

    // Empty space.
    if (tool === 'draw' && curve.points.length >= 2) {
      const w = pvp.screenToWorld(sx, sy);
      const beat = clampBeat(curve, w.beat);
      history.snapshot();
      store.mutate(() => {
        ensureVolumeParam(curve);
        const lane = curve.parameters!.volume!;
        const i = addParamPoint(lane, createParamPoint(beat, w.value));
        // Auto-smooth if enabled (stays if the user just clicks; a drag below
        // overrides it by pulling a manual handle — same as the pitch pen tool).
        if (store.getState().bezierAutoSmooth) {
          applyAutoSmoothParamHandles(lane, i, store.getState().autoSmoothXRatio);
        }
        // Trim this point's and its neighbors' handles so none overshoot the
        // newly inserted anchor (prevents backwards-flowing segments).
        reclampParamHandlesAround(lane, i);
        selectedIndex = i;
      });
      // Ctrl: drag moves the new point. Otherwise: drag pulls its handle.
      drag = ctrl ? 'point' : 'penPull';
      e.preventDefault();
    } else {
      selectedIndex = null;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (drag === null || selectedIndex === null) return;
    const curve = getSelectedCurve();
    const lane = curve?.parameters?.volume;
    const pt = lane?.points[selectedIndex];
    if (!curve || !lane || !pt) return;
    const { sx, sy } = localPos(e);
    const w = pvp.screenToWorld(sx, sy);
    if (drag === 'point') {
      store.mutate(() => {
        moveParamPoint(lane, selectedIndex!, { x: clampBeat(curve, w.beat), y: w.value });
        // Moving changes segment lengths — re-trim handles around the point.
        reclampParamHandlesAround(lane, selectedIndex!);
      });
    } else if (drag === 'penPull') {
      // Pull a fresh, mirrored handle out of the point (smooth pen-tool point).
      const rel = { x: w.beat - pt.position.x, y: w.value - pt.position.y };
      store.mutate(() => {
        setParamHandle(lane, selectedIndex!, 'out', rel);
        setParamHandle(lane, selectedIndex!, 'in', { x: -rel.x, y: -rel.y });
      });
    } else {
      const which = drag === 'handleIn' ? 'in' : 'out';
      store.mutate(() => {
        setParamHandle(lane, selectedIndex!, which, { x: w.beat - pt.position.x, y: w.value - pt.position.y });
      });
    }
  });

  window.addEventListener('mouseup', () => { drag = null; });

  canvas.addEventListener('dblclick', (e) => {
    const curve = getSelectedCurve();
    if (!curve || curve.points.length < 2) return;
    const { sx, sy } = localPos(e);
    const w = pvp.screenToWorld(sx, sy);
    history.snapshot();
    store.mutate(() => {
      ensureVolumeParam(curve);
      const lane = curve.parameters!.volume!;
      const i = addParamPoint(lane, createParamPoint(clampBeat(curve, w.beat), w.value));
      if (store.getState().bezierAutoSmooth) {
        applyAutoSmoothParamHandles(lane, i, store.getState().autoSmoothXRatio);
      }
      reclampParamHandlesAround(lane, i);
      selectedIndex = i;
    });
    e.preventDefault();
  });

  canvas.addEventListener('contextmenu', (e) => {
    const curve = getSelectedCurve();
    if (!curve) return;
    const { sx, sy } = localPos(e);
    const idx = hitPoint(curve, sx, sy);
    if (idx === null) return;
    const lane = curve.parameters?.volume;
    if (!lane || lane.points.length <= 1) { e.preventDefault(); return; }
    e.preventDefault();
    history.snapshot();
    store.mutate(() => { removeParamPoint(lane, idx); });
    if (selectedIndex === idx) selectedIndex = null;
  });

  return {
    selectedIndex: () => selectedIndex,
    resetSelection: () => { selectedIndex = null; },
  };
}
