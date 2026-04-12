import type { Vec2, BezierCurve, Track, TransformBoxState } from '../types';
import type { Viewport } from './viewport';
import { store } from '../state/store';
import { createCurve, createControlPoint, addPointToCurve, movePoint, setHandle, getSegmentControlPoints, computeCurveBBox, deepCopyPoints, applyTransformToCurve } from '../model/curve';
import { snapToGrid, DEFAULT_SNAP_CONFIG } from '../utils/snap';
import { distToPoint, nearestPointOnCubic } from '../utils/bezier-math';
import { hitTestTransformBox, getTransformCursor } from './transform-box-renderer';


export interface InteractionState {
  /** Mouse world position (snapped if snap on, unless shift held). */
  cursorWorld: Vec2 | null;
  /** Curve currently being drawn (pen tool). */
  drawingCurve: BezierCurve | null;
  /** Whether we're currently dragging a handle. */
  dragging: 'point' | 'handleIn' | 'handleOut' | null;
  dragCurveId: string | null;
  dragPointIndex: number;
  /** Transform box state (active when double-click selects a curve for transform). */
  transformBox: TransformBoxState | null;
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
    transformBox: null,
  };

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);

    const snap = !e.shiftKey && store.getState().snapEnabled;
    const snapped = snapToGrid(world.wx, world.wy, { ...DEFAULT_SNAP_CONFIG, enabled: snap });
    istate.cursorWorld = { x: snapped.wx, y: snapped.wy };

    // Transform box dragging
    if (istate.transformBox?.activeHandle && istate.transformBox.dragStart) {
      const tb = istate.transformBox;
      const track = getSelectedTrack();
      const curve = track?.curves.find(c => c.id === tb.curveId);
      if (curve) {
        store.mutate(() => {
          applyTransformToCurve(curve, tb.originalPoints, tb.bbox, tb.activeHandle!, tb.dragStart!, { x: snapped.wx, y: snapped.wy });
        });
      }
      return;
    }

    // Transform box hover cursor + tooltip
    if (istate.transformBox && !istate.dragging) {
      const hit = hitTestTransformBox(sx, sy, istate.transformBox.bbox, vp);
      canvas.style.cursor = hit ? getTransformCursor(hit) : 'default';
      canvas.title = hit === 'octaveUp' ? '1 Octave Up'
        : hit === 'octaveDown' ? '1 Octave Down'
        : '';
    } else if (!istate.dragging) {
      canvas.style.cursor = 'default';
      canvas.title = '';
    }

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
      // Check transform box hit first
      if (istate.transformBox) {
        const hit = hitTestTransformBox(sx, sy, istate.transformBox.bbox, vp);
        if (hit) {
          const track = getSelectedTrack();
          const curve = track?.curves.find(c => c.id === istate.transformBox!.curveId);
          if (!curve) return;

          // Octave arrows are instant actions, not drags
          if (hit === 'octaveUp' || hit === 'octaveDown') {
            const shift = hit === 'octaveUp' ? 12 : -12;
            store.mutate(() => {
              for (const pt of curve.points) {
                pt.position.y += shift;
              }
            });
            istate.transformBox.bbox = computeCurveBBox(curve);
            return;
          }

          // Start a transform drag
          istate.transformBox.activeHandle = hit;
          istate.transformBox.dragStart = { ...worldPt };
          istate.transformBox.originalPoints = deepCopyPoints(curve.points);
          return;
        }
        // Click outside the box dismisses it
        istate.transformBox = null;
      }
      handleSelectClick(istate, worldPt, vp);
    } else if (state.activeTool === 'delete') {
      handleDeleteClick(worldPt, vp);
    }
  });

  canvas.addEventListener('mouseup', () => {
    // Finalize transform drag
    if (istate.transformBox?.activeHandle) {
      const track = getSelectedTrack();
      const curve = track?.curves.find(c => c.id === istate.transformBox!.curveId);
      if (curve) {
        // Recompute bbox from transformed points
        istate.transformBox.bbox = computeCurveBBox(curve);
      }
      istate.transformBox.activeHandle = null;
      istate.transformBox.dragStart = null;
      return;
    }
    istate.dragging = null;
    istate.dragCurveId = null;
    istate.dragPointIndex = -1;
  });

  // Double-click in select mode to activate transform box
  canvas.addEventListener('dblclick', (e) => {
    const state = store.getState();
    if (state.activeTool !== 'select') return;
    const track = getSelectedTrack();
    if (!track) return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);
    const worldPt: Vec2 = { x: world.wx, y: world.wy };

    const hitRadiusX = 8 / vp.state.zoomX;
    const hitRadiusY = 8 / vp.state.zoomY;
    const hitRadius = Math.max(hitRadiusX, hitRadiusY);

    for (const curve of track.curves) {
      if (curve.points.length < 2) continue;
      for (let i = 0; i < curve.points.length - 1; i++) {
        const seg = getSegmentControlPoints(curve, i);
        if (!seg) continue;
        const nearest = nearestPointOnCubic(seg.p0, seg.p1, seg.p2, seg.p3, worldPt);
        if (nearest.dist < hitRadius) {
          istate.transformBox = {
            curveId: curve.id,
            originalPoints: deepCopyPoints(curve.points),
            bbox: computeCurveBBox(curve),
            activeHandle: null,
            dragStart: null,
          };
          store.setSelectedCurve(curve.id);
          store.setSelectedPoint(null);
          return;
        }
      }
    }
  });

  // Enter to finish drawing, Escape to cancel/dismiss
  // Ctrl held in draw mode temporarily switches to select
  // Delete/Backspace deletes selected curve (when no point is selected)
  window.addEventListener('keydown', (e) => {
    const state = store.getState();
    const inDrawMode = state.activeTool === 'draw';
    const hasDrawTarget = istate.drawingCurve || state.selectedCurveId;
    if (e.key === 'Escape' && istate.transformBox) {
      istate.transformBox = null;
      canvas.style.cursor = 'default';
    } else if (e.key === 'Enter' && inDrawMode && hasDrawTarget) {
      finishDrawing(istate);
    } else if (e.key === 'Escape' && inDrawMode && hasDrawTarget) {
      finishDrawing(istate);
    } else if (e.key === 'Control' && inDrawMode) {
      store.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedCurveId && state.selectedPointIndex === null) {
      const curveId = state.selectedCurveId;
      store.mutate(comp => {
        const track = comp.tracks.find(t => t.id === state.selectedTrackId);
        if (track) {
          const idx = track.curves.findIndex(c => c.id === curveId);
          if (idx >= 0) track.curves.splice(idx, 1);
        }
      });
      store.setSelectedCurve(null);
      istate.transformBox = null;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && store.getState().activeTool === 'select') {
      store.setTool('draw');
    }
  });

  return istate;
}

function handleDrawClick(istate: InteractionState, worldPt: Vec2, vp: Viewport): void {
  const state = store.getState();
  const track = getSelectedTrack();
  if (!track) return;

  // Determine the target curve: either the one being drawn, or a selected curve
  const targetCurve = istate.drawingCurve
    ?? (state.selectedCurveId
      ? track.curves.find(c => c.id === state.selectedCurveId)
      : null);

  // Hit-test against existing points on the target curve
  if (targetCurve) {
    const hitRadiusX = 8 / vp.state.zoomX;
    const hitRadiusY = 8 / vp.state.zoomY;
    const hitRadius = Math.max(hitRadiusX, hitRadiusY);

    for (let i = 0; i < targetCurve.points.length; i++) {
      const pt = targetCurve.points[i]!;
      if (distToPoint(worldPt, pt.position) < hitRadius) {
        // Hit an existing point — clear handles and set up for handle drag.
        // If the user releases without dragging, handles stay null (sharp point).
        // If the user drags, handleDrag creates new handles.
        istate.drawingCurve = targetCurve;
        store.mutate(() => {
          pt.handleIn = null;
          pt.handleOut = null;
        });
        store.setSelectedCurve(targetCurve.id);
        store.setSelectedPoint(i);
        istate.dragging = 'handleOut';
        istate.dragCurveId = targetCurve.id;
        istate.dragPointIndex = i;
        return;
      }
    }
  }

  if (!istate.drawingCurve) {
    if (targetCurve) {
      // Add point to the selected curve
      istate.drawingCurve = targetCurve;
      const point = createControlPoint(worldPt.x, worldPt.y);
      const idx = addPointToCurve(targetCurve, point);
      store.setSelectedPoint(idx);

      // Start dragging handle
      istate.dragging = 'handleOut';
      istate.dragCurveId = targetCurve.id;
      istate.dragPointIndex = idx;
    } else {
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
    }
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

  // Hit-test curve segments (click on the line between points)
  for (const curve of track.curves) {
    if (curve.points.length < 2) continue;
    for (let i = 0; i < curve.points.length - 1; i++) {
      const seg = getSegmentControlPoints(curve, i);
      if (!seg) continue;
      // nearestPointOnCubic works in world coords; convert hit radius
      // to world units using the average of X and Y zoom
      const nearest = nearestPointOnCubic(seg.p0, seg.p1, seg.p2, seg.p3, worldPt);
      if (nearest.dist < hitRadius) {
        store.setSelectedCurve(curve.id);
        store.setSelectedPoint(null);
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
  store.setSelectedCurve(null);
  store.setSelectedPoint(null);
}


function getSelectedTrack(): Track | undefined {
  const state = store.getState();
  return state.composition.tracks.find(t => t.id === state.selectedTrackId);
}
