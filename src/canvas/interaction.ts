import type { Vec2, BezierCurve, Track } from '../types';
import type { Viewport } from './viewport';
import { store } from '../state/store';
import { createCurve, createControlPoint, addPointToCurve, movePoint, setHandle } from '../model/curve';
import { snapToGrid, DEFAULT_SNAP_CONFIG } from '../utils/snap';
import { distToPoint } from '../utils/bezier-math';


export interface InteractionState {
  /** Mouse world position (snapped if snap on, unless shift held). */
  cursorWorld: Vec2 | null;
  /** Curve currently being drawn (pen tool). */
  drawingCurve: BezierCurve | null;
  /** Whether we're currently dragging a handle. */
  dragging: 'point' | 'handleIn' | 'handleOut' | null;
  dragCurveId: string | null;
  dragPointIndex: number;
}

export function createInteraction(
  canvas: HTMLCanvasElement,
  vp: Viewport,
): InteractionState {
  const istate: InteractionState = {
    cursorWorld: null,
    drawingCurve: null,
    dragging: null,
    dragCurveId: null,
    dragPointIndex: -1,
  };

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);

    const snap = !e.shiftKey && store.getState().snapEnabled;
    const snapped = snapToGrid(world.wx, world.wy, { ...DEFAULT_SNAP_CONFIG, enabled: snap });
    istate.cursorWorld = { x: snapped.wx, y: snapped.wy };

    // Handle dragging
    if (istate.dragging) {
      handleDrag(istate, snapped);
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left click only
    if (e.altKey) return; // alt is for panning

    const state = store.getState();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);
    const snap = !e.shiftKey && state.snapEnabled;
    const snapped = snapToGrid(world.wx, world.wy, { ...DEFAULT_SNAP_CONFIG, enabled: snap });
    const worldPt: Vec2 = { x: snapped.wx, y: snapped.wy };

    if (state.activeTool === 'draw') {
      handleDrawClick(istate, worldPt, vp);
    } else if (state.activeTool === 'select') {
      handleSelectClick(istate, worldPt, vp);
    } else if (state.activeTool === 'delete') {
      handleDeleteClick(worldPt, vp);
    }
  });

  canvas.addEventListener('mouseup', () => {
    istate.dragging = null;
    istate.dragCurveId = null;
    istate.dragPointIndex = -1;
  });

  // Double-click to finish drawing
  canvas.addEventListener('dblclick', () => {
    if (istate.drawingCurve) {
      finishDrawing(istate);
    }
  });

  // Escape to cancel drawing
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && istate.drawingCurve) {
      cancelDrawing(istate);
    }
  });

  return istate;
}

function handleDrawClick(istate: InteractionState, worldPt: Vec2, _vp: Viewport): void {
  const state = store.getState();
  const track = getSelectedTrack();
  if (!track) return;

  if (!istate.drawingCurve) {
    // Start a new curve
    const curve = createCurve();
    const point = createControlPoint(worldPt.x, worldPt.y);
    addPointToCurve(curve, point);
    istate.drawingCurve = curve;

    store.mutate(comp => {
      const t = comp.tracks.find(t => t.id === state.selectedTrackId);
      if (t) t.curves.push(curve);
    });
    store.setSelectedCurve(curve.id);
    store.setSelectedPoint(0);

    // Start dragging handle
    istate.dragging = 'handleOut';
    istate.dragCurveId = curve.id;
    istate.dragPointIndex = 0;
  } else {
    // Add point to existing drawing curve
    const point = createControlPoint(worldPt.x, worldPt.y);
    const idx = addPointToCurve(istate.drawingCurve, point);
    store.setSelectedPoint(idx);

    // Start dragging handle for new point
    istate.dragging = 'handleOut';
    istate.dragCurveId = istate.drawingCurve.id;
    istate.dragPointIndex = idx;
  }
}

function handleSelectClick(istate: InteractionState, worldPt: Vec2, vp: Viewport): void {
  const state = store.getState();
  const track = getSelectedTrack();
  if (!track) return;

  // Hit-test against all points in all curves of selected track
  // Convert hit radius from screen pixels to approximate world units
  const hitRadiusX = 8 / vp.state.zoomX;
  const hitRadiusY = 8 / vp.state.zoomY;
  const hitRadius = Math.max(hitRadiusX, hitRadiusY);

  for (const curve of track.curves) {
    for (let i = 0; i < curve.points.length; i++) {
      const pt = curve.points[i]!;

      // Check handle hits first (smaller targets, higher priority when selected)
      if (curve.id === state.selectedCurveId) {
        if (pt.handleIn) {
          const habs: Vec2 = { x: pt.position.x + pt.handleIn.x, y: pt.position.y + pt.handleIn.y };
          if (distToPoint(worldPt, habs) < hitRadius) {
            istate.dragging = 'handleIn';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            store.setSelectedCurve(curve.id);
            store.setSelectedPoint(i);
            return;
          }
        }
        if (pt.handleOut) {
          const habs: Vec2 = { x: pt.position.x + pt.handleOut.x, y: pt.position.y + pt.handleOut.y };
          if (distToPoint(worldPt, habs) < hitRadius) {
            istate.dragging = 'handleOut';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            store.setSelectedCurve(curve.id);
            store.setSelectedPoint(i);
            return;
          }
        }
      }

      // Check anchor point hit
      if (distToPoint(worldPt, pt.position) < hitRadius) {
        istate.dragging = 'point';
        istate.dragCurveId = curve.id;
        istate.dragPointIndex = i;
        store.setSelectedCurve(curve.id);
        store.setSelectedPoint(i);
        return;
      }
    }
  }

  // Click on empty space → deselect
  store.setSelectedCurve(null);
  store.setSelectedPoint(null);
}

function handleDeleteClick(worldPt: Vec2, vp: Viewport): void {
  const track = getSelectedTrack();
  if (!track) return;

  const hitRadiusX = 8 / vp.state.zoomX;
  const hitRadiusY = 8 / vp.state.zoomY;
  const hitRadius = Math.max(hitRadiusX, hitRadiusY);

  for (const curve of track.curves) {
    for (let i = 0; i < curve.points.length; i++) {
      const pt = curve.points[i]!;
      if (distToPoint(worldPt, pt.position) < hitRadius) {
        store.mutate(() => {
          curve.points.splice(i, 1);
          // Remove curve if empty
          if (curve.points.length === 0) {
            const idx = track.curves.indexOf(curve);
            if (idx >= 0) track.curves.splice(idx, 1);
          }
        });
        return;
      }
    }
  }
}

function handleDrag(istate: InteractionState, snapped: { wx: number; wy: number }): void {
  const track = getSelectedTrack();
  if (!track || !istate.dragCurveId) return;

  const curve = track.curves.find(c => c.id === istate.dragCurveId);
  if (!curve) return;

  store.mutate(() => {
    if (istate.dragging === 'point') {
      movePoint(curve, istate.dragPointIndex, { x: snapped.wx, y: snapped.wy });
    } else if (istate.dragging === 'handleOut' || istate.dragging === 'handleIn') {
      const pt = curve.points[istate.dragPointIndex];
      if (!pt) return;
      const rel: Vec2 = {
        x: snapped.wx - pt.position.x,
        y: snapped.wy - pt.position.y,
      };
      const which = istate.dragging === 'handleOut' ? 'out' : 'in';
      setHandle(curve, istate.dragPointIndex, which, rel);

      // Mirror handle for smooth curves
      const opposite = which === 'out' ? 'in' : 'out';
      const mirrorRel: Vec2 = { x: -rel.x, y: -rel.y };
      setHandle(curve, istate.dragPointIndex, opposite, mirrorRel);
    }
  });
}

function finishDrawing(istate: InteractionState): void {
  istate.drawingCurve = null;
  istate.dragging = null;
}

function cancelDrawing(istate: InteractionState): void {
  if (istate.drawingCurve) {
    const state = store.getState();
    store.mutate(comp => {
      const track = comp.tracks.find(t => t.id === state.selectedTrackId);
      if (track) {
        const idx = track.curves.findIndex(c => c.id === istate.drawingCurve?.id);
        if (idx >= 0) track.curves.splice(idx, 1);
      }
    });
    istate.drawingCurve = null;
    store.setSelectedCurve(null);
  }
}

function getSelectedTrack(): Track | undefined {
  const state = store.getState();
  return state.composition.tracks.find(t => t.id === state.selectedTrackId);
}
