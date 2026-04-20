import type { Vec2, BezierCurve, ControlPoint, Track, TransformBoxState } from '../types';
import type { Viewport } from './viewport';
import { store } from '../state/store';
import { history } from '../state/history';
import { createCurve, createControlPoint, addPointToCurve, movePoint, setHandle, getSegmentControlPoints, computeMultiCurveBBox, deepCopyPoints, applyTransformToCurve, splitCurveAtSegment, splitCurveAtPoint, applyAutoSmoothHandles, reclampHandlesAround } from '../model/curve';
import { snapToGrid, getAdaptiveSubdivisions } from '../utils/snap';
import type { SnapConfig } from '../utils/snap';
import { getScaleById } from '../utils/scales';
import { SUBDIVISIONS_PER_BEAT } from '../constants';
import { distToPoint, nearestPointOnCubic, nearestPointOnCubicScaled, evaluateCubic, findTForX } from '../utils/bezier-math';
import { hitTestTransformBox, getTransformCursor } from './transform-box-renderer';
import { hitTestLoopMarkers } from './loop-markers';

export const SECONDS_RULER_HEIGHT = 16;
export const BEAT_RULER_HEIGHT = 24;
export const RULER_HEIGHT = SECONDS_RULER_HEIGHT + BEAT_RULER_HEIGHT;

export interface InteractionCallbacks {
  onPlayheadScrub?(beats: number, phase: 'start' | 'move' | 'end'): void;
  onLoopMarkerDrag?(which: 'start' | 'end', beats: number, phase: 'start' | 'move' | 'end'): void;
  onCursorMove?(worldX: number, worldY: number, screenY: number): void;
  onCursorLeave?(): void;
}

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
  /** World position where the current drag started (for shift-constrain). */
  dragStartWorld: Vec2 | null;
  /** Whether alt-duplicate has already been performed for the current transform drag. */
  altDuplicated: boolean;
  /** Whether Ctrl temporarily switched from draw to select (for Ctrl-click). */
  ctrlSwitchedTool: boolean;
  /** Whether we're currently scrubbing the playhead in the ruler zone. */
  scrubbing: boolean;
  /** Which loop marker is being dragged in the ruler, if any. */
  draggingLoopMarker: 'start' | 'end' | null;
  /** Screen Y of cursor (for ruler zone detection). */
  cursorScreenY: number;
  /** Whether the cursor is currently over the canvas element. */
  cursorInCanvas: boolean;
  /** Preview position for the scissors tool (world coords), null if no valid cut. */
  scissorsPreview: Vec2 | null;
}

export function createInteraction(
  canvas: HTMLCanvasElement,
  vp: Viewport,
  callbacks?: InteractionCallbacks,
): InteractionState {
  const istate: InteractionState = {
    cursorWorld: null,
    drawingCurve: null,
    dragging: null,
    dragCurveId: null,
    dragPointIndex: -1,
    transformBox: null,
    dragStartWorld: null,
    altDuplicated: false,
    ctrlSwitchedTool: false,
    scrubbing: false,
    draggingLoopMarker: null,
    cursorScreenY: 0,
    cursorInCanvas: false,
    scissorsPreview: null,
  };

  /**
   * Snap a world beat to either the nearest curve control point X (within 8 screen pixels)
   * or the beat grid. Used during loop-marker drag.
   */
  function snapBeatForMarker(worldX: number): number {
    const zoomX = vp.state.zoomX;
    const comp = store.getComposition();
    let bestPointX: number | null = null;
    let bestDistPx = 8; // within 8 screen pixels
    for (const track of comp.tracks) {
      for (const curve of track.curves) {
        for (const pt of curve.points) {
          const distPx = Math.abs(pt.position.x - worldX) * zoomX;
          if (distPx < bestDistPx) {
            bestDistPx = distPx;
            bestPointX = pt.position.x;
          }
        }
      }
    }
    if (bestPointX !== null) return Math.max(0, bestPointX);
    const snap = buildSnapConfig(zoomX);
    const snapped = snap.enabled ? snapToGrid(worldX, 0, snap).wx : worldX;
    return Math.max(0, snapped);
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);
    const raw = { wx: world.wx, wy: world.wy };

    // Loop-marker drag — update marker position (snaps to curve points + grid)
    if (istate.draggingLoopMarker) {
      const beat = snapBeatForMarker(raw.wx);
      callbacks?.onLoopMarkerDrag?.(istate.draggingLoopMarker, beat, 'move');
      return;
    }

    // Playhead scrubbing — update position and skip all other interaction
    if (istate.scrubbing) {
      const snap = buildSnapConfig(vp.state.zoomX);
      const snappedBeat = snap.enabled ? snapToGrid(raw.wx, 0, snap).wx : raw.wx;
      const beat = Math.max(0, snappedBeat);
      callbacks?.onPlayheadScrub?.(beat, 'move');
      return;
    }

    const snapped = snapToGrid(world.wx, world.wy, buildSnapConfig(vp.state.zoomX));

    // Determine effective coordinates:
    // - Handles: raw (no snap) to allow smooth curve shaping
    // - Points / transforms / idle: snapped
    const isHandleDrag = istate.dragging === 'handleIn' || istate.dragging === 'handleOut';
    let eff = isHandleDrag ? raw : snapped;

    // Shift-constrain: lock to horizontal or vertical axis during any drag
    const isDragging = istate.dragging || (istate.transformBox?.activeHandle && istate.transformBox.dragStart);
    const dragOrigin = istate.dragStartWorld ?? istate.transformBox?.dragStart ?? null;
    if (e.shiftKey && isDragging && dragOrigin) {
      const dx = Math.abs(eff.wx - dragOrigin.x);
      const dy = Math.abs(eff.wy - dragOrigin.y);
      if (dx >= dy) {
        eff = { wx: eff.wx, wy: dragOrigin.y };
      } else {
        eff = { wx: dragOrigin.x, wy: eff.wy };
      }
    }

    istate.cursorWorld = { x: eff.wx, y: eff.wy };
    istate.cursorScreenY = sy;
    callbacks?.onCursorMove?.(eff.wx, eff.wy, sy);

    // Transform box dragging
    if (istate.transformBox?.activeHandle && istate.transformBox.dragStart) {
      const tb = istate.transformBox;
      const track = getSelectedTrack();
      if (track) {
        // Alt-drag translate: duplicate curves and drag the copies
        if (e.altKey && tb.activeHandle === 'translate' && !istate.altDuplicated) {
          istate.altDuplicated = true;
          // Restore originals to their snapshot positions
          store.mutate(() => {
            for (const curveId of tb.curveIds) {
              const curve = track.curves.find(c => c.id === curveId);
              const origPts = tb.originalPointsMap.get(curveId);
              if (curve && origPts) {
                for (let i = 0; i < curve.points.length; i++) {
                  const orig = origPts[i]!;
                  curve.points[i]!.position.x = orig.position.x;
                  curve.points[i]!.position.y = orig.position.y;
                  curve.points[i]!.handleIn = orig.handleIn ? { ...orig.handleIn } : null;
                  curve.points[i]!.handleOut = orig.handleOut ? { ...orig.handleOut } : null;
                }
              }
            }
          });
          // Create duplicates and switch the transform box to them
          const newIds: string[] = [];
          const newOrigMap = new Map<string, ControlPoint[]>();
          store.mutate(() => {
            for (const curveId of tb.curveIds) {
              const original = track.curves.find(c => c.id === curveId);
              if (!original || original.points.length === 0) continue;
              const dup = createCurve();
              dup.points = deepCopyPoints(original.points);
              track.curves.push(dup);
              newIds.push(dup.id);
              newOrigMap.set(dup.id, deepCopyPoints(dup.points));
            }
          });
          tb.curveIds = newIds;
          tb.originalPointsMap = newOrigMap;
          store.setSelectedCurves(newIds);
        }

        store.mutate(() => {
          for (const curveId of tb.curveIds) {
            const curve = track.curves.find(c => c.id === curveId);
            const origPts = tb.originalPointsMap.get(curveId);
            if (curve && origPts) {
              applyTransformToCurve(curve, origPts, tb.bbox, tb.activeHandle!, tb.dragStart!, { x: eff.wx, y: eff.wy });
            }
          }
        });
      }
      return;
    }

    // Cursor: ruler zone, transform box, or default
    if (!istate.dragging && sy < RULER_HEIGHT) {
      canvas.style.cursor = 'col-resize';
      canvas.title = 'Click to position playhead';
    } else if (istate.transformBox && !istate.dragging) {
      const hit = hitTestTransformBox(sx, sy, istate.transformBox.bbox, vp);
      canvas.style.cursor = hit ? getTransformCursor(hit) : 'default';
      canvas.title = hit === 'octaveUp' ? '1 Octave Up'
        : hit === 'octaveDown' ? '1 Octave Down'
        : '';
    } else if (!istate.dragging && store.getState().activeTool === 'scissors') {
      canvas.style.cursor = 'crosshair';
      canvas.title = 'Click a curve to split';
      istate.scissorsPreview = findScissorsPreview({ x: raw.wx, y: raw.wy }, vp);
    } else if (!istate.dragging) {
      istate.scissorsPreview = null;
      canvas.style.cursor = 'default';
      canvas.title = '';
    }

    // Handle dragging
    if (istate.dragging) {
      handleDrag(istate, eff);
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left click only
    // Alt is for panning, but allow through when a transform box is active
    // in select mode (alt-drag to duplicate)
    if (e.altKey && !(istate.transformBox && store.getState().activeTool === 'select')) return;

    const state = store.getState();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = vp.screenToWorld(sx, sy);
    const rawPt: Vec2 = { x: world.wx, y: world.wy };
    const snapped = snapToGrid(world.wx, world.wy, buildSnapConfig(vp.state.zoomX));
    const snappedPt: Vec2 = { x: snapped.wx, y: snapped.wy };

    // Ruler zone: first try loop-marker drag (if Loop is on), then fall through
    // to playhead scrub.
    if (sy < RULER_HEIGHT && !e.altKey) {
      const comp = state.composition;
      // Hit-test loop markers only when Loop is currently enabled.
      const loopOn = document.getElementById('loop-toggle') instanceof HTMLInputElement
        && (document.getElementById('loop-toggle') as HTMLInputElement).checked;
      if (loopOn) {
        const which = hitTestLoopMarkers(vp, sx, comp.loopStartBeats, comp.loopEndBeats);
        if (which) {
          istate.draggingLoopMarker = which;
          const beat = snapBeatForMarker(world.wx);
          callbacks?.onLoopMarkerDrag?.(which, beat, 'start');
          return;
        }
      }
      const snap = buildSnapConfig(vp.state.zoomX);
      const snappedBeat = snap.enabled ? snapToGrid(world.wx, 0, snap).wx : world.wx;
      const beat = Math.max(0, snappedBeat);
      istate.scrubbing = true;
      callbacks?.onPlayheadScrub?.(beat, 'start');
      return;
    }

    if (state.activeTool === 'draw') {
      handleDrawClick(istate, snappedPt, vp);
    } else if (state.activeTool === 'select') {
      // Check transform box hit first
      if (istate.transformBox) {
        const hit = hitTestTransformBox(sx, sy, istate.transformBox.bbox, vp);
        if (hit) {
          const track = getSelectedTrack();
          if (!track) return;
          const tb = istate.transformBox;

          // Octave arrows are instant actions, not drags
          if (hit === 'octaveUp' || hit === 'octaveDown') {
            history.snapshot();
            const shift = hit === 'octaveUp' ? 12 : -12;
            store.mutate(() => {
              for (const curveId of tb.curveIds) {
                const curve = track.curves.find(c => c.id === curveId);
                if (curve) {
                  for (const pt of curve.points) {
                    pt.position.y += shift;
                  }
                }
              }
            });
            const curves = tb.curveIds.map(id => track.curves.find(c => c.id === id)).filter((c): c is BezierCurve => !!c);
            tb.bbox = computeMultiCurveBBox(curves);
            return;
          }

          // For translate hits, check for curve selection first
          if (hit === 'translate') {
            const curveHit = findCurveAt(rawPt, vp, track);
            if (curveHit && e.shiftKey) {
              // Shift+click inside box: toggle curve in/out of selection
              store.toggleSelectedCurve(curveHit.id);
              store.setSelectedPoint(null);
              rebuildTransformBox(istate, track);
              return;
            }
            if (curveHit && !state.selectedCurveIds.has(curveHit.id)) {
              // Clicked an unselected curve inside box: select it instead
              store.setSelectedCurve(curveHit.id);
              store.setSelectedPoint(null);
              rebuildTransformBox(istate, track);
              return;
            }
          }

          // Start a transform drag (resize handles, or translate on selected/empty)
          history.snapshot();
          istate.altDuplicated = false;
          tb.activeHandle = hit;
          tb.dragStart = { ...snappedPt };
          const map = new Map<string, ControlPoint[]>();
          for (const curveId of tb.curveIds) {
            const curve = track.curves.find(c => c.id === curveId);
            if (curve) map.set(curveId, deepCopyPoints(curve.points));
          }
          tb.originalPointsMap = map;
          return;
        }
        // Click outside the box dismisses it
        istate.transformBox = null;
      }
      handleSelectClick(istate, rawPt, vp, e.shiftKey);
    } else if (state.activeTool === 'delete') {
      handleDeleteClick(rawPt, vp);
    } else if (state.activeTool === 'scissors') {
      handleScissorsClick(rawPt, vp);
    }
  });

  canvas.addEventListener('mouseup', () => {
    // End loop-marker drag
    if (istate.draggingLoopMarker) {
      const which = istate.draggingLoopMarker;
      istate.draggingLoopMarker = null;
      const comp = store.getComposition();
      callbacks?.onLoopMarkerDrag?.(which, which === 'start' ? comp.loopStartBeats : comp.loopEndBeats, 'end');
      return;
    }
    // End playhead scrubbing
    if (istate.scrubbing) {
      istate.scrubbing = false;
      callbacks?.onPlayheadScrub?.(store.getState().playback.positionBeats, 'end');
      return;
    }
    // Finalize transform drag
    if (istate.transformBox?.activeHandle) {
      const track = getSelectedTrack();
      if (track) {
        const tb = istate.transformBox;
        const curves = tb.curveIds.map(id => track.curves.find(c => c.id === id)).filter((c): c is BezierCurve => !!c);
        tb.bbox = computeMultiCurveBBox(curves);
      }
      istate.transformBox.activeHandle = null;
      istate.transformBox.dragStart = null;
      istate.dragStartWorld = null;
      istate.altDuplicated = false;
      return;
    }
    istate.dragging = null;
    istate.dragCurveId = null;
    istate.dragPointIndex = -1;
    istate.dragStartWorld = null;
  });

  // Enter to finish drawing, Escape to cancel/dismiss
  // Ctrl held in draw mode temporarily switches to select
  // Delete/Backspace deletes selected curve (when no point is selected)
  window.addEventListener('keydown', (e) => {
    const state = store.getState();
    const inDrawMode = state.activeTool === 'draw';
    const hasDrawTarget = istate.drawingCurve || store.getSelectedCurveId();
    if (e.key === 'Escape' && istate.transformBox) {
      istate.transformBox = null;
      canvas.style.cursor = 'default';
    } else if (e.key === 'Enter' && inDrawMode && hasDrawTarget) {
      finishDrawing(istate);
    } else if (e.key === 'Escape' && inDrawMode && hasDrawTarget) {
      finishDrawing(istate);
    } else if (e.key === 'Control' && inDrawMode) {
      istate.ctrlSwitchedTool = true;
      store.setTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedCurveIds.size > 0 && state.selectedPointIndex === null) {
      history.snapshot();
      const idsToDelete = [...state.selectedCurveIds];
      store.mutate(comp => {
        const track = comp.tracks.find(t => t.id === state.selectedTrackId);
        if (track) {
          for (const curveId of idsToDelete) {
            const idx = track.curves.findIndex(c => c.id === curveId);
            if (idx >= 0) track.curves.splice(idx, 1);
          }
        }
      });
      store.setSelectedCurve(null);
      istate.transformBox = null;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && istate.ctrlSwitchedTool) {
      istate.ctrlSwitchedTool = false;
      store.setTool('draw');
      // Draw doesn't use the transform box — drop it, but keep curve selection
      // so Draw extends the curve that was selected during the temp-Select.
      istate.transformBox = null;
    }
  });

  canvas.addEventListener('mouseenter', () => { istate.cursorInCanvas = true; });
  canvas.addEventListener('mouseleave', () => {
    istate.cursorInCanvas = false;
    callbacks?.onCursorLeave?.();
  });

  return istate;
}

function handleDrawClick(istate: InteractionState, worldPt: Vec2, vp: Viewport): void {
  const state = store.getState();
  const track = getSelectedTrack();
  if (!track) return;

  // Determine the target curve: either the one being drawn, or the single selected curve
  const singleSelectedId = store.getSelectedCurveId();
  const targetCurve = istate.drawingCurve
    ?? (singleSelectedId
      ? track.curves.find(c => c.id === singleSelectedId)
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
        history.snapshot();
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
        istate.dragStartWorld = { ...worldPt };
        return;
      }
    }
  }

  if (!istate.drawingCurve) {
    if (targetCurve) {
      // Add point to the selected curve
      history.snapshot();
      istate.drawingCurve = targetCurve;
      const point = createControlPoint(worldPt.x, worldPt.y);
      const idx = addPointToCurve(targetCurve, point);
      // Re-clamp neighboring handles so they don't extend past the new point.
      reclampHandlesAround(targetCurve, idx);
      if (state.bezierAutoSmooth) applyAutoSmoothHandles(targetCurve, idx);
      store.setSelectedPoint(idx);

      // Start dragging handle
      istate.dragging = 'handleOut';
      istate.dragCurveId = targetCurve.id;
      istate.dragPointIndex = idx;
      istate.dragStartWorld = { ...worldPt };
    } else {
      // Start a new curve
      history.snapshot();
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
      istate.dragStartWorld = { ...worldPt };
    }
  } else {
    // Add point to existing drawing curve
    history.snapshot();
    const point = createControlPoint(worldPt.x, worldPt.y);
    const idx = addPointToCurve(istate.drawingCurve, point);
    // Re-clamp neighboring handles so they don't extend past the new point.
    reclampHandlesAround(istate.drawingCurve, idx);
    if (state.bezierAutoSmooth) applyAutoSmoothHandles(istate.drawingCurve, idx);
    store.setSelectedPoint(idx);

    // Start dragging handle for new point
    istate.dragging = 'handleOut';
    istate.dragCurveId = istate.drawingCurve.id;
    istate.dragPointIndex = idx;
    istate.dragStartWorld = { ...worldPt };
  }
}

function handleSelectClick(istate: InteractionState, worldPt: Vec2, vp: Viewport, shiftKey: boolean): void {
  const track = getSelectedTrack();
  if (!track) return;

  const hitRadiusX = 8 / vp.state.zoomX;
  const hitRadiusY = 8 / vp.state.zoomY;
  const hitRadius = Math.max(hitRadiusX, hitRadiusY);

  // Handle hits only available in single-curve mode, without Shift
  const singleCurveId = store.getSelectedCurveId();
  if (singleCurveId && !shiftKey) {
    const curve = track.curves.find(c => c.id === singleCurveId);
    if (curve) {
      for (let i = 0; i < curve.points.length; i++) {
        const pt = curve.points[i]!;
        if (pt.handleIn) {
          const habs: Vec2 = { x: pt.position.x + pt.handleIn.x, y: pt.position.y + pt.handleIn.y };
          if (distToPoint(worldPt, habs) < hitRadius) {
            history.snapshot();
            istate.dragging = 'handleIn';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            istate.dragStartWorld = { ...habs };
            store.setSelectedPoint(i);
            return;
          }
        }
        if (pt.handleOut) {
          const habs: Vec2 = { x: pt.position.x + pt.handleOut.x, y: pt.position.y + pt.handleOut.y };
          if (distToPoint(worldPt, habs) < hitRadius) {
            history.snapshot();
            istate.dragging = 'handleOut';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            istate.dragStartWorld = { ...habs };
            store.setSelectedPoint(i);
            return;
          }
        }
      }
    }
  }

  // Hit-test anchor points on all curves
  for (const curve of track.curves) {
    for (let i = 0; i < curve.points.length; i++) {
      const pt = curve.points[i]!;
      if (distToPoint(worldPt, pt.position) < hitRadius) {
        if (shiftKey) {
          // Shift+click on a point: toggle the curve in selection
          store.toggleSelectedCurve(curve.id);
          rebuildTransformBox(istate, track);
        } else {
          // Click on a point: select that curve, select the point, start drag
          history.snapshot();
          istate.dragging = 'point';
          istate.dragCurveId = curve.id;
          istate.dragPointIndex = i;
          istate.dragStartWorld = { ...pt.position };
          store.setSelectedCurve(curve.id);
          store.setSelectedPoint(i);
          istate.transformBox = null;
        }
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
      const nearest = nearestPointOnCubic(seg.p0, seg.p1, seg.p2, seg.p3, worldPt);
      if (nearest.dist < hitRadius) {
        if (shiftKey) {
          store.toggleSelectedCurve(curve.id);
        } else {
          store.setSelectedCurve(curve.id);
        }
        store.setSelectedPoint(null);
        rebuildTransformBox(istate, track);
        return;
      }
    }
  }

  // Click on empty space → deselect (unless Shift held)
  if (!shiftKey) {
    store.setSelectedCurve(null);
    store.setSelectedPoint(null);
    istate.transformBox = null;
  }
}

/** Rebuild the transform box from the current selectedCurveIds. */
export function rebuildTransformBox(istate: InteractionState, track: Track): void {
  const state = store.getState();
  const selectedIds = [...state.selectedCurveIds];
  const curves = selectedIds
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is BezierCurve => !!c);
  if (curves.length === 0) {
    istate.transformBox = null;
    return;
  }
  const map = new Map<string, ControlPoint[]>();
  for (const curve of curves) {
    map.set(curve.id, deepCopyPoints(curve.points));
  }
  istate.transformBox = {
    curveIds: selectedIds,
    originalPointsMap: map,
    bbox: computeMultiCurveBBox(curves),
    activeHandle: null,
    dragStart: null,
  };
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
        history.snapshot();
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

/** Screen-space distance between two world points. */
function screenDist(a: Vec2, b: Vec2, vp: Viewport): number {
  const dx = (a.x - b.x) * vp.state.zoomX;
  const dy = (a.y - b.y) * vp.state.zoomY;
  return Math.sqrt(dx * dx + dy * dy);
}

const SCISSORS_HIT_PX = 8; // pixel threshold for scissors hit-testing

/**
 * Find the scissors cut target: which curve, segment index, parameter t, and preview point.
 * Checks interior control points first (snap-to-point), then curve segments.
 * When snap is enabled, the cut X is snapped to the beat grid.
 */
function findScissorsCut(worldPt: Vec2, vp: Viewport): {
  curve: BezierCurve; segmentIndex: number; t: number; point: Vec2; atPoint: boolean;
} | null {
  const track = getSelectedTrack();
  if (!track) return null;

  // First pass: snap to interior control points
  for (const curve of track.curves) {
    if (curve.points.length < 3) continue;
    for (let i = 1; i < curve.points.length - 1; i++) {
      if (screenDist(worldPt, curve.points[i]!.position, vp) < SCISSORS_HIT_PX) {
        return { curve, segmentIndex: -1, t: 0, point: { ...curve.points[i]!.position }, atPoint: true };
      }
    }
  }

  // Second pass: cut on curve segments (screen-space distance)
  const snap = buildSnapConfig(vp.state.zoomX);
  for (const curve of track.curves) {
    if (curve.points.length < 2) continue;
    for (let i = 0; i < curve.points.length - 1; i++) {
      const seg = getSegmentControlPoints(curve, i);
      if (!seg) continue;
      const nearest = nearestPointOnCubicScaled(
        seg.p0, seg.p1, seg.p2, seg.p3, worldPt,
        vp.state.zoomX, vp.state.zoomY,
      );
      if (nearest.dist < SCISSORS_HIT_PX && nearest.t > 0.001 && nearest.t < 0.999) {
        let t = nearest.t;
        let point = { ...nearest.point };

        // Snap X to beat grid if snap is enabled
        if (snap.enabled) {
          const step = 1 / snap.subdivisionsPerBeat;
          const snappedX = Math.max(0, Math.round(point.x / step) * step);
          // Only snap if the snapped X is still inside this segment
          if (snappedX > seg.p0.x && snappedX < seg.p3.x) {
            t = findTForX(seg.p0, seg.p1, seg.p2, seg.p3, snappedX);
            point = evaluateCubic(seg.p0, seg.p1, seg.p2, seg.p3, t);
          }
        }

        if (t > 0.001 && t < 0.999) {
          return { curve, segmentIndex: i, t, point, atPoint: false };
        }
      }
    }
  }

  return null;
}

function handleScissorsClick(worldPt: Vec2, vp: Viewport): void {
  const cut = findScissorsCut(worldPt, vp);
  if (!cut) return;

  history.snapshot();
  if (cut.atPoint) {
    // Split at existing control point
    const pointIdx = cut.curve.points.findIndex(p => p.position.x === cut.point.x && p.position.y === cut.point.y);
    if (pointIdx < 1 || pointIdx >= cut.curve.points.length - 1) return;
    const { left, right } = splitCurveAtPoint(cut.curve, pointIdx);
    const track = getSelectedTrack()!;
    store.mutate(() => {
      const idx = track.curves.indexOf(cut.curve);
      if (idx >= 0) track.curves.splice(idx, 1, left, right);
    });
  } else {
    const { left, right } = splitCurveAtSegment(cut.curve, cut.segmentIndex, cut.t);
    const track = getSelectedTrack()!;
    store.mutate(() => {
      const idx = track.curves.indexOf(cut.curve);
      if (idx >= 0) track.curves.splice(idx, 1, left, right);
    });
  }
  store.setSelectedCurve(null);
  store.setSelectedPoint(null);
}

function findScissorsPreview(worldPt: Vec2, vp: Viewport): Vec2 | null {
  const cut = findScissorsCut(worldPt, vp);
  return cut ? cut.point : null;
}

function handleDrag(istate: InteractionState, snapped: { wx: number; wy: number }): void {
  const track = getSelectedTrack();
  if (!track || !istate.dragCurveId) return;

  const curve = track.curves.find(c => c.id === istate.dragCurveId);
  if (!curve) return;

  store.mutate(() => {
    if (istate.dragging === 'point') {
      movePoint(curve, istate.dragPointIndex, { x: snapped.wx, y: snapped.wy });
      // Re-clamp neighboring handles so they don't extend past the moved point.
      reclampHandlesAround(curve, istate.dragPointIndex);
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


/** Find the curve (point or segment) at a given world position. */
function findCurveAt(worldPt: Vec2, vp: Viewport, track: Track): BezierCurve | null {
  const hitRadiusX = 8 / vp.state.zoomX;
  const hitRadiusY = 8 / vp.state.zoomY;
  const hitRadius = Math.max(hitRadiusX, hitRadiusY);

  // Check anchor points
  for (const curve of track.curves) {
    for (const pt of curve.points) {
      if (distToPoint(worldPt, pt.position) < hitRadius) return curve;
    }
  }

  // Check curve segments
  for (const curve of track.curves) {
    if (curve.points.length < 2) continue;
    for (let i = 0; i < curve.points.length - 1; i++) {
      const seg = getSegmentControlPoints(curve, i);
      if (!seg) continue;
      const nearest = nearestPointOnCubic(seg.p0, seg.p1, seg.p2, seg.p3, worldPt);
      if (nearest.dist < hitRadius) return curve;
    }
  }

  return null;
}

function getSelectedTrack(): Track | undefined {
  const state = store.getState();
  return state.composition.tracks.find(t => t.id === state.selectedTrackId);
}

function buildSnapConfig(zoomX?: number): SnapConfig {
  const state = store.getState();
  const subdivisions = zoomX !== undefined
    ? getAdaptiveSubdivisions(zoomX)
    : SUBDIVISIONS_PER_BEAT;
  return {
    enabled: state.snapEnabled,
    subdivisionsPerBeat: subdivisions,
    scaleRoot: state.scaleRoot,
    scale: state.scaleId ? getScaleById(state.scaleId) ?? null : null,
  };
}
