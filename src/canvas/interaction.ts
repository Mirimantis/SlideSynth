import type { Vec2, BezierCurve, Lane, LanePoint, Track, TransformBoxState } from '../types';
import type { Viewport } from './viewport';
import { store } from '../state/store';
import { history } from '../state/history';
import { createCurve, createControlPoint, addPointToCurve, movePoint, setHandle, getSegmentControlPoints, computeMultiCurveBBox, computePointSubsetBBox, deepCopyPoints, applyTransformToCurve, splitCurveAtSegment, splitCurveAtPoint, applyAutoSmoothHandles, reclampHandlesAround, pitchPoints } from '../model/curve';
import { deepCopyLanes, ensureLane } from '../model/lane';
import { pointKeysByCurve } from '../model/point-selection';
import { snapToGrid, getAdaptiveSubdivisions } from '../utils/snap';
import type { SnapConfig } from '../utils/snap';
import { getScaleById } from '../utils/scales';
import { computeProjectionTargetsAtX } from './projection-renderer';
import { SUBDIVISIONS_PER_BEAT, MIN_PITCH_CENTS, MAX_PITCH_CENTS, CENTS_PER_OCTAVE } from '../constants';
import { chordOffsets } from '../utils/harmonics';
import { createGroupId, expandSelectionToGroups, remapGroupIds } from '../model/curve-groups';
import { nearestPointOnCubicScaled, evaluateCubic, findTForX } from '../utils/bezier-math';
import { hitTestTransformBox, getTransformCursor } from './transform-box-renderer';
import { hitTestLoopMarkers } from './loop-markers';
import { hitTestGuides } from './guides';

export const SECONDS_RULER_HEIGHT = 16;
export const BEAT_RULER_HEIGHT = 24;
export const RULER_HEIGHT = SECONDS_RULER_HEIGHT + BEAT_RULER_HEIGHT;

/** A curve's lanes other than the mandatory pitch lane (e.g. volume) —
 *  the transform box keeps these time-locked with the pitch lane. */
function nonPitchLanesOf(curve: BezierCurve): Lane[] {
  return curve.lanes.filter(l => l.type !== 'pitch');
}

/** Reset a curve's non-pitch lanes back to a snapshot taken at drag start
 *  (mirrors the pitch-lane restore done before an alt-drag duplicate). */
function restoreNonPitchLanes(curve: BezierCurve, original: Lane[]): void {
  for (const lane of curve.lanes) {
    if (lane.type === 'pitch') continue;
    const orig = original.find(l => l.type === lane.type);
    if (!orig) continue;
    for (let i = 0; i < lane.points.length; i++) {
      const origPt = orig.points[i];
      if (!origPt) continue;
      lane.points[i]!.position.x = origPt.position.x;
      lane.points[i]!.position.y = origPt.position.y;
      lane.points[i]!.handleIn = origPt.handleIn ? { ...origPt.handleIn } : null;
      lane.points[i]!.handleOut = origPt.handleOut ? { ...origPt.handleOut } : null;
    }
  }
}

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
  /** ID of the guide currently being dragged. */
  draggingGuideId: string | null;
  /** Screen Y of cursor (for ruler zone detection). */
  cursorScreenY: number;
  /** Whether the cursor is currently over the canvas element. */
  cursorInCanvas: boolean;
  /** Preview position for the scissors tool (world coords), null if no valid cut. */
  scissorsPreview: Vec2 | null;
  /** Active drag-marquee on empty canvas (BACKLOG 8.3). When set, a rubber-band
   *  rect is drawn between `startWorld` and `currentWorld`; on mouseup the
   *  enclosed anchor points are committed to the multi-point selection. */
  marquee: { startWorld: Vec2; currentWorld: Vec2; additive: boolean } | null;
  /** Multi-point group drag (BACKLOG 8.3). When set, mousemove translates every
   *  selected point by `cursor - dragStartWorld`. `originalPositionsByKey` is
   *  the pre-drag snapshot so the offset is computed against a stable origin. */
  pointGroupDrag: {
    dragStartWorld: Vec2;
    originalPositionsByKey: Map<string, Vec2>;
  } | null;
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
    draggingGuideId: null,
    cursorScreenY: 0,
    cursorInCanvas: false,
    scissorsPreview: null,
    marquee: null,
    pointGroupDrag: null,
  };

  /**
   * True when the Compose canvas is in a Scroll-Canvas Playback state that
   * hands LMB to Perform. Tool handlers early-return in that case so they
   * don't fire on the same mouse events.
   */
  function isComposePerformLocked(): boolean {
    const st = store.getState();
    return st.playback.state === 'playing'
        && (st.scrollCanvasEnabled || st.performance.recordArmed);
  }

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
        for (const pt of pitchPoints(curve)) {
          const distPx = Math.abs(pt.position.x - worldX) * zoomX;
          if (distPx < bestDistPx) {
            bestDistPx = distPx;
            bestPointX = pt.position.x;
          }
        }
      }
    }
    if (bestPointX !== null) return Math.max(0, bestPointX);
    const snap = buildSnapConfig(zoomX, worldX);
    const snapped = snap.enabled ? snapToGrid(worldX, 0, snap).wx : worldX;
    return Math.max(0, snapped);
  }

  canvas.addEventListener('mousemove', (e) => {
    if (isComposePerformLocked()) return;
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

    // Guide drag — move the guide along its perpendicular axis with the same
    // snap behavior the cursor itself uses, but DON'T let the guide snap to
    // itself (filter own ID out of the snap config).
    if (istate.draggingGuideId) {
      const guide = store.getComposition().guides.find(g => g.id === istate.draggingGuideId);
      if (guide) {
        const dragSnap = buildSnapConfigExcludingGuide(vp.state.zoomX, raw.wx, guide.id);
        const snappedNow = dragSnap.enabled ? snapToGrid(raw.wx, raw.wy, dragSnap) : raw;
        const next = guide.orientation === 'x'
          ? Math.max(0, snappedNow.wx)
          : Math.max(MIN_PITCH_CENTS, Math.min(MAX_PITCH_CENTS, snappedNow.wy));
        store.updateGuide(guide.id, { position: next });
      }
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

    const snapped = snapToGrid(world.wx, world.wy, buildSnapConfig(vp.state.zoomX, world.wx));

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

    // Drag-marquee (BACKLOG 8.3) — update the rubber-band rect, redraw, return.
    if (istate.marquee) {
      istate.marquee.currentWorld = { x: raw.wx, y: raw.wy };
      return;
    }

    // Multi-point group drag (BACKLOG 8.3) — translate every selected point
    // by the cursor delta. dx is clamped per-curve so no selected point
    // crosses an *unselected* neighbor's X (would corrupt monotonic ordering).
    if (istate.pointGroupDrag) {
      const start = istate.pointGroupDrag.dragStartWorld;
      let dx = eff.wx - start.x;
      const dy = eff.wy - start.y;
      const orig = istate.pointGroupDrag.originalPositionsByKey;

      // Group keys by curve so we can inspect each curve's neighbor structure.
      const byCurve = new Map<string, Set<number>>();
      for (const key of orig.keys()) {
        const sep = key.lastIndexOf(':');
        if (sep < 0) continue;
        const cid = key.slice(0, sep);
        const pidx = Number(key.slice(sep + 1));
        if (!Number.isFinite(pidx)) continue;
        let s = byCurve.get(cid);
        if (!s) { s = new Set(); byCurve.set(cid, s); }
        s.add(pidx);
      }

      const comp = store.getComposition();
      const SAFE_GAP = 0.001;
      let minDx = -Infinity;
      let maxDx = Infinity;
      for (const [cid, indices] of byCurve) {
        let curve: BezierCurve | undefined;
        for (const t of comp.tracks) {
          curve = t.curves.find(c => c.id === cid);
          if (curve) break;
        }
        if (!curve) continue;
        for (const idx of indices) {
          const origPos = orig.get(`${cid}:${idx}`);
          if (!origPos) continue;
          const prev = pitchPoints(curve)[idx - 1];
          const next = pitchPoints(curve)[idx + 1];
          if (prev && !indices.has(idx - 1)) {
            // Unselected left neighbor pins the lower bound for this point.
            minDx = Math.max(minDx, prev.position.x + SAFE_GAP - origPos.x);
          }
          if (next && !indices.has(idx + 1)) {
            // Unselected right neighbor pins the upper bound.
            maxDx = Math.min(maxDx, next.position.x - SAFE_GAP - origPos.x);
          }
        }
      }
      dx = Math.max(minDx, Math.min(maxDx, dx));

      store.mutate(comp2 => {
        for (const [cid, indices] of byCurve) {
          for (const t of comp2.tracks) {
            const c = t.curves.find(cc => cc.id === cid);
            if (!c) continue;
            for (const idx of indices) {
              const origPos = orig.get(`${cid}:${idx}`);
              const pt = pitchPoints(c)[idx];
              if (origPos && pt) {
                pt.position.x = origPos.x + dx;
                pt.position.y = origPos.y + dy;
              }
            }
            break;
          }
        }
      });
      return;
    }

    // Transform box dragging
    if (istate.transformBox?.activeHandle && istate.transformBox.dragStart) {
      const tb = istate.transformBox;
      const track = getSelectedTrack();
      if (track) {
        // Alt-drag translate: duplicate curves and drag the copies. Only
        // engages in whole-curve mode — duplicating a point-subset selection
        // is deferred to a follow-up (BACKLOG 8.3 scope).
        if (e.altKey && tb.activeHandle === 'translate' && !istate.altDuplicated && !tb.pointIndicesPerCurve) {
          istate.altDuplicated = true;
          // Restore originals to their snapshot positions
          store.mutate(() => {
            for (const curveId of tb.curveIds) {
              const curve = track.curves.find(c => c.id === curveId);
              const origPts = tb.originalPointsMap.get(curveId);
              if (curve && origPts) {
                for (let i = 0; i < pitchPoints(curve).length; i++) {
                  const orig = origPts[i]!;
                  pitchPoints(curve)[i]!.position.x = orig.position.x;
                  pitchPoints(curve)[i]!.position.y = orig.position.y;
                  pitchPoints(curve)[i]!.handleIn = orig.handleIn ? { ...orig.handleIn } : null;
                  pitchPoints(curve)[i]!.handleOut = orig.handleOut ? { ...orig.handleOut } : null;
                }
                const origNonPitch = tb.originalNonPitchLanesMap.get(curveId);
                if (origNonPitch) restoreNonPitchLanes(curve, origNonPitch);
              }
            }
          });
          // Create duplicates and switch the transform box to them. Preserve
          // chord-group / freehand-group identity within the dupe set with a
          // fresh id (so the duplicated cluster moves together but doesn't
          // collide with the source).
          const newIds: string[] = [];
          const newOrigMap = new Map<string, LanePoint[]>();
          const newNonPitchMap = new Map<string, Lane[]>();
          const created: BezierCurve[] = [];
          store.mutate(() => {
            for (const curveId of tb.curveIds) {
              const original = track.curves.find(c => c.id === curveId);
              if (!original || pitchPoints(original).length === 0) continue;
              const dup = createCurve();
              dup.lanes = deepCopyLanes(original.lanes);
              dup.groupId = original.groupId ?? null;
              if (original.voiceIndex !== undefined) dup.voiceIndex = original.voiceIndex;
              track.curves.push(dup);
              newIds.push(dup.id);
              newOrigMap.set(dup.id, deepCopyPoints(pitchPoints(dup)));
              newNonPitchMap.set(dup.id, deepCopyLanes(nonPitchLanesOf(dup)));
              created.push(dup);
            }
            remapGroupIds(created);
          });
          tb.curveIds = newIds;
          tb.originalPointsMap = newOrigMap;
          tb.originalNonPitchLanesMap = newNonPitchMap;
          store.setSelectedCurves(newIds);
        }

        store.mutate(() => {
          for (const curveId of tb.curveIds) {
            const curve = track.curves.find(c => c.id === curveId);
            const origPts = tb.originalPointsMap.get(curveId);
            if (curve && origPts) {
              const subset = tb.pointIndicesPerCurve?.get(curveId) ?? null;
              const origNonPitch = tb.originalNonPitchLanesMap.get(curveId) ?? null;
              applyTransformToCurve(curve, origPts, tb.bbox, tb.activeHandle!, tb.dragStart!, { x: eff.wx, y: eff.wy }, subset, origNonPitch);
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
    if (isComposePerformLocked()) return;
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
    const snapped = snapToGrid(world.wx, world.wy, buildSnapConfig(vp.state.zoomX, world.wx));
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

    // Snap-guide hit-test (Phase 8.7) — only intercepts clicks in Select mode,
    // and only when guides are visible AND not locked. Other tools fall through
    // to their normal behavior (e.g. Draw places a point) so guides don't get
    // in the way of authoring; users switch to Select to manage guides.
    if (
      state.activeTool === 'select'
      && state.guidesVisible
      && !state.guidesLocked
      && state.composition.guides.length > 0
    ) {
      const hitGuideId = hitTestGuides(vp, sx, sy, state.composition.guides);
      if (hitGuideId) {
        history.snapshot();
        store.setSelectedGuide(hitGuideId);
        istate.draggingGuideId = hitGuideId;
        return;
      }
      // Missed: in Select mode, clear guide selection so the tool actions below
      // don't operate against a stale selection. (In other tools, leave guide
      // selection alone — the user might be editing the label via the panel.)
      if (state.selectedGuideId) {
        store.setSelectedGuide(null);
      }
    }

    if (state.activeTool === 'draw') {
      handleDrawClick(istate, snappedPt, vp);
    } else if (state.activeTool === 'select') {
      // Check transform box hit first
      if (istate.transformBox) {
        // In point-subset mode (BACKLOG 8.3) the bbox can be very small (e.g.
        // wraps a single anchor), so its corner handles cluster around the
        // anchor and hijack shift+click. Bypass the transform-box hit entirely
        // when shift is held and we're in point-mode — let handleSelectClick
        // handle the anchor-toggle path.
        const inPointMode = !!istate.transformBox.pointIndicesPerCurve;
        const skipForShiftToggle = inPointMode && e.shiftKey;
        const hit = skipForShiftToggle ? null : hitTestTransformBox(sx, sy, istate.transformBox.bbox, vp);
        if (hit) {
          const track = getSelectedTrack();
          if (!track) return;
          const tb = istate.transformBox;

          // Octave arrows are instant actions, not drags
          if (hit === 'octaveUp' || hit === 'octaveDown') {
            history.snapshot();
            const shift = hit === 'octaveUp' ? CENTS_PER_OCTAVE : -CENTS_PER_OCTAVE;
            const subsetMap = tb.pointIndicesPerCurve;
            store.mutate(() => {
              for (const curveId of tb.curveIds) {
                const curve = track.curves.find(c => c.id === curveId);
                if (!curve) continue;
                const subset = subsetMap?.get(curveId);
                if (subset && subset.size > 0) {
                  for (const idx of subset) {
                    if (pitchPoints(curve)[idx]) pitchPoints(curve)[idx]!.position.y += shift;
                  }
                } else {
                  for (const pt of pitchPoints(curve)) pt.position.y += shift;
                }
              }
            });
            const curves = tb.curveIds.map(id => track.curves.find(c => c.id === id)).filter((c): c is BezierCurve => !!c);
            tb.bbox = subsetMap
              ? computePointSubsetBBox(curves, subsetMap)
              : computeMultiCurveBBox(curves);
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
          const map = new Map<string, LanePoint[]>();
          const nonPitchMap = new Map<string, Lane[]>();
          for (const curveId of tb.curveIds) {
            const curve = track.curves.find(c => c.id === curveId);
            if (curve) {
              map.set(curveId, deepCopyPoints(pitchPoints(curve)));
              nonPitchMap.set(curveId, deepCopyLanes(nonPitchLanesOf(curve)));
            }
          }
          tb.originalPointsMap = map;
          tb.originalNonPitchLanesMap = nonPitchMap;
          return;
        }
        // Click outside the box dismisses it
        istate.transformBox = null;
      }
      const result = handleSelectClick(istate, rawPt, vp, e.shiftKey);
      if (result === 'miss') {
        // Empty canvas hit. Start a drag-marquee — mouseup will commit the
        // selection (or treat as a click if the drag was tiny). Don't clear
        // selection yet so a quick miss-click + drag doesn't lose the
        // existing selection mid-gesture. (BACKLOG 8.3)
        istate.marquee = {
          startWorld: { ...rawPt },
          currentWorld: { ...rawPt },
          additive: e.shiftKey,
        };
      }
    } else if (state.activeTool === 'delete') {
      handleDeleteClick(rawPt, vp);
    } else if (state.activeTool === 'scissors') {
      handleScissorsClick(rawPt, vp);
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (isComposePerformLocked()) return;
    // End drag-marquee (BACKLOG 8.3) — commit selected points, or treat as a
    // click on empty canvas if the drag was below the click threshold.
    if (istate.marquee) {
      const m = istate.marquee;
      istate.marquee = null;
      const zoomX = vp.state.zoomX;
      const zoomY = vp.state.zoomY;
      const pxW = Math.abs(m.currentWorld.x - m.startWorld.x) * zoomX;
      const pxH = Math.abs(m.currentWorld.y - m.startWorld.y) * zoomY;
      if (pxW < 4 && pxH < 4) {
        // Below the click threshold — treat as a plain click on empty canvas:
        // clear selection unless this was a shift-click (additive).
        if (!m.additive) {
          store.setSelectedCurve(null);
          store.setSelectedPoint(null);
          istate.transformBox = null;
        }
        return;
      }
      // Commit: collect every anchor point on the *active track* whose position
      // falls inside the rect, then update selection. Active-track-only matches
      // the BACKLOG 8.23 invariant for shift-multi-select.
      const minX = Math.min(m.startWorld.x, m.currentWorld.x);
      const maxX = Math.max(m.startWorld.x, m.currentWorld.x);
      const minY = Math.min(m.startWorld.y, m.currentWorld.y);
      const maxY = Math.max(m.startWorld.y, m.currentWorld.y);
      const track = getSelectedTrack();
      const newKeys = new Set<string>();
      if (track) {
        for (const curve of track.curves) {
          for (let i = 0; i < pitchPoints(curve).length; i++) {
            const p = pitchPoints(curve)[i]!;
            if (p.position.x >= minX && p.position.x <= maxX
                && p.position.y >= minY && p.position.y <= maxY) {
              newKeys.add(`${curve.id}:${i}`);
            }
          }
        }
      }
      if (m.additive) {
        store.addPointKeys(newKeys);
      } else {
        store.setSelectedPointKeys(newKeys);
      }
      store.syncSelectedCurvesFromPoints();
      if (track) rebuildTransformBox(istate, track);
      return;
    }
    // End multi-point group drag (BACKLOG 8.3) — points are already at their
    // final positions; just clear the drag state and rebuild the transform box.
    if (istate.pointGroupDrag) {
      istate.pointGroupDrag = null;
      istate.dragStartWorld = null;
      const track = getSelectedTrack();
      if (track) rebuildTransformBox(istate, track);
      return;
    }
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
    // End guide drag — snapshot was taken on mousedown, so just release.
    if (istate.draggingGuideId) {
      istate.draggingGuideId = null;
      return;
    }
    // Finalize transform drag
    if (istate.transformBox?.activeHandle) {
      const track = getSelectedTrack();
      if (track) {
        const tb = istate.transformBox;
        const curves = tb.curveIds.map(id => track.curves.find(c => c.id === id)).filter((c): c is BezierCurve => !!c);
        tb.bbox = tb.pointIndicesPerCurve
          ? computePointSubsetBBox(curves, tb.pointIndicesPerCurve)
          : computeMultiCurveBBox(curves);
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
    if (isComposePerformLocked()) return;
    // Don't hijack keys while the user is typing in a form field — matches the
    // global hotkey handler's guard in main.ts so Enter/Delete/Backspace/Escape
    // stay native to inputs (e.g. comp-name, BPM).
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace')
        && state.selectedCurveIds.size > 0
        && state.selectedPointIndex === null
        && state.selectedPointKeys.size === 0) {
      // Whole-curve delete only fires when neither single-point nor
      // multi-point (BACKLOG 8.3) selection is active. The main.ts handler
      // owns those two cases and runs in the same keydown dispatch.
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
    if (isComposePerformLocked()) return;
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

  // Harmonic Prism Draw mode: dispatch to chord-cluster placement.
  if (state.harmonicPrism.drawMode) {
    handleDrawClickPrism(istate, worldPt);
    return;
  }

  // Determine the target curve. If the user has explicitly selected a curve
  // that differs from the stale drawingCurve (e.g. they switched tools via
  // hotkey, picked a different curve, then came back to Draw), honor the
  // selection instead of the stale draw target.
  const singleSelectedId = store.getSelectedCurveId();
  if (
    istate.drawingCurve &&
    singleSelectedId &&
    singleSelectedId !== istate.drawingCurve.id
  ) {
    istate.drawingCurve = null;
  }
  // Also clear if the previous drawingCurve was deleted out from under us.
  if (istate.drawingCurve && !track.curves.includes(istate.drawingCurve)) {
    istate.drawingCurve = null;
  }
  const targetCurve = istate.drawingCurve
    ?? (singleSelectedId
      ? track.curves.find(c => c.id === singleSelectedId)
      : null);

  // Hit-test against existing points on the target curve
  if (targetCurve) {
    for (let i = 0; i < pitchPoints(targetCurve).length; i++) {
      const pt = pitchPoints(targetCurve)[i]!;
      if (screenDist(worldPt, pt.position, vp) < DRAW_HIT_PX) {
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
      if (state.bezierAutoSmooth) applyAutoSmoothHandles(targetCurve, idx, state.autoSmoothXRatio);
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
    if (state.bezierAutoSmooth) applyAutoSmoothHandles(istate.drawingCurve, idx, state.autoSmoothXRatio);
    store.setSelectedPoint(idx);

    // Start dragging handle for new point
    istate.dragging = 'handleOut';
    istate.dragCurveId = istate.drawingCurve.id;
    istate.dragPointIndex = idx;
    istate.dragStartWorld = { ...worldPt };
  }
}

/** Result returned by handleSelectClick — `'hit'` means the click was consumed
 *  (point/handle/segment); `'miss'` means it landed on empty canvas and the
 *  caller should consider starting a marquee (BACKLOG 8.3). */
type SelectClickResult = 'hit' | 'miss';

function handleSelectClick(istate: InteractionState, worldPt: Vec2, vp: Viewport, shiftKey: boolean): SelectClickResult {
  const activeTrack = getSelectedTrack();
  if (!activeTrack) return 'miss';

  // Plain click (no shift): scan every visible (non-muted) track so the user
  // can grab any curve they see, with the active track auto-following the hit
  // (BACKLOG 8.23). Shift-click stays locked to the active track so an
  // accidental click on a non-active curve can't torpedo a multi-select in
  // progress. Iterate in `comp.tracks` order so click priority matches the
  // render z-order (later tracks draw on top, last hit wins for overlaps).
  const comp = store.getComposition();
  const candidateTracks: Track[] = shiftKey
    ? [activeTrack]
    : comp.tracks.filter(t => !t.muted);

  // Phase 1: anchor points. Anchors override handles when overlapping.
  for (const t of candidateTracks) {
    for (const curve of t.curves) {
      for (let i = 0; i < pitchPoints(curve).length; i++) {
        const pt = pitchPoints(curve)[i]!;
        if (screenDist(worldPt, pt.position, vp) < SELECT_HIT_PX) {
          if (shiftKey) {
            // Shift+click on an anchor: toggle the *individual point* in the
            // multi-point selection (BACKLOG 8.3). The parent-curve set is
            // re-derived from the union of selected points so the curve
            // highlight follows automatically.
            store.togglePointKey(curve.id, i);
            store.syncSelectedCurvesFromPoints();
            rebuildTransformBox(istate, activeTrack);
          } else {
            // Click on a point. If the clicked point is already part of a
            // multi-point selection (size >= 2), start a *group drag* instead
            // of collapsing back to a single-point selection (BACKLOG 8.3).
            const stateNow = store.getState();
            const pointKey = `${curve.id}:${i}`;
            const inGroup = stateNow.selectedPointKeys.size >= 2 && stateNow.selectedPointKeys.has(pointKey);
            if (inGroup) {
              // Group-drag: snapshot every selected point's current position
              // and translate them together as the cursor moves.
              history.snapshot();
              const positions = new Map<string, Vec2>();
              const comp2 = store.getComposition();
              for (const key of stateNow.selectedPointKeys) {
                const sep = key.lastIndexOf(':');
                if (sep < 0) continue;
                const cid = key.slice(0, sep);
                const pidx = Number(key.slice(sep + 1));
                if (!Number.isFinite(pidx)) continue;
                for (const tt of comp2.tracks) {
                  const cc = tt.curves.find(c => c.id === cid);
                  if (cc && pitchPoints(cc)[pidx]) {
                    positions.set(key, { x: pitchPoints(cc)[pidx]!.position.x, y: pitchPoints(cc)[pidx]!.position.y });
                    break;
                  }
                }
              }
              istate.pointGroupDrag = {
                dragStartWorld: { ...pt.position },
                originalPositionsByKey: positions,
              };
              istate.dragStartWorld = { ...pt.position };
              istate.transformBox = null;
              return 'hit';
            }
            // Plain single-point click: switch to its track (if needed),
            // select curve+point, start single-point drag.
            if (t.id !== activeTrack.id) store.setSelectedTrack(t.id);
            history.snapshot();
            istate.dragging = 'point';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            istate.dragStartWorld = { ...pt.position };
            store.setSelectedCurve(curve.id);
            store.setSelectedPoint(i);
            // Seed the multi-point selection with this single point so the
            // visual highlight matches selectedPointIndex (the white-fill rule
            // in curve-renderer reads selectedPointKeys).
            store.setSelectedPointKeys(new Set([pointKey]));
            store.syncSelectedCurvesFromPoints();
            istate.transformBox = null;
          }
          return 'hit';
        }
      }
    }
  }

  // Phase 2: handle hits. Only available in single-curve mode without Shift,
  // and handles only render for the active track's selected curve, so this
  // stays single-track regardless of cross-track scope.
  const singleCurveId = store.getSelectedCurveId();
  if (singleCurveId && !shiftKey) {
    const curve = activeTrack.curves.find(c => c.id === singleCurveId);
    if (curve) {
      for (let i = 0; i < pitchPoints(curve).length; i++) {
        const pt = pitchPoints(curve)[i]!;
        if (pt.handleIn) {
          const habs: Vec2 = { x: pt.position.x + pt.handleIn.x, y: pt.position.y + pt.handleIn.y };
          if (screenDist(worldPt, habs, vp) < SELECT_HIT_PX) {
            history.snapshot();
            istate.dragging = 'handleIn';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            istate.dragStartWorld = { ...habs };
            store.setSelectedPoint(i);
            return 'hit';
          }
        }
        if (pt.handleOut) {
          const habs: Vec2 = { x: pt.position.x + pt.handleOut.x, y: pt.position.y + pt.handleOut.y };
          if (screenDist(worldPt, habs, vp) < SELECT_HIT_PX) {
            history.snapshot();
            istate.dragging = 'handleOut';
            istate.dragCurveId = curve.id;
            istate.dragPointIndex = i;
            istate.dragStartWorld = { ...habs };
            store.setSelectedPoint(i);
            return 'hit';
          }
        }
      }
    }
  }

  // Phase 3: curve segments (click on the line between points).
  for (const t of candidateTracks) {
    for (const curve of t.curves) {
      if (pitchPoints(curve).length < 2) continue;
      for (let i = 0; i < pitchPoints(curve).length - 1; i++) {
        const seg = getSegmentControlPoints(curve, i);
        if (!seg) continue;
        const nearest = nearestPointOnCubicScaled(
          seg.p0, seg.p1, seg.p2, seg.p3, worldPt,
          vp.state.zoomX, vp.state.zoomY,
        );
        if (nearest.dist < SELECT_HIT_PX) {
          if (shiftKey) {
            store.toggleSelectedCurve(curve.id);
            rebuildTransformBox(istate, activeTrack);
          } else {
            if (t.id !== activeTrack.id) store.setSelectedTrack(t.id);
            store.setSelectedCurve(curve.id);
            store.setSelectedPoint(null);
            rebuildTransformBox(istate, t);
          }
          return 'hit';
        }
      }
    }
  }

  // Phase 4: empty canvas. Don't clear here — the caller (mousedown) decides
  // between starting a marquee (drag) and clearing (click) based on the
  // mouseup gesture. (BACKLOG 8.3.)
  return 'miss';
}

/** Rebuild the transform box from the current selectedCurveIds, expanding to
 *  include every chord-group sibling so the box wraps the whole cluster.
 *
 *  When `selectedPointKeys` is non-empty, the transform box switches to
 *  point-subset mode (BACKLOG 8.3): bbox wraps just those points, future
 *  scale/translate/octave ops apply only to those points, and chord-group
 *  expansion is skipped (point-level selection is intentionally not
 *  group-aware — selecting one point in a chord-cluster sibling shouldn't
 *  drag the whole cluster's points along). */
export function rebuildTransformBox(istate: InteractionState, track: Track): void {
  const state = store.getState();
  const pointMode = state.selectedPointKeys.size > 0;

  let selectedIds: string[];
  let pointIndicesPerCurve: Map<string, Set<number>> | null = null;

  if (pointMode) {
    pointIndicesPerCurve = pointKeysByCurve(state.selectedPointKeys);
    selectedIds = [...pointIndicesPerCurve.keys()];
  } else {
    const expanded = expandSelectionToGroups(state.selectedCurveIds, track);
    selectedIds = [...expanded];
    // If group expansion added members not currently in selectedCurveIds, sync the
    // selection so the rest of the UI reflects the cluster.
    if (selectedIds.length !== state.selectedCurveIds.size) {
      store.setSelectedCurves(selectedIds);
    }
  }

  const curves = selectedIds
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is BezierCurve => !!c);
  if (curves.length === 0) {
    istate.transformBox = null;
    return;
  }
  const map = new Map<string, LanePoint[]>();
  const nonPitchMap = new Map<string, Lane[]>();
  for (const curve of curves) {
    map.set(curve.id, deepCopyPoints(pitchPoints(curve)));
    nonPitchMap.set(curve.id, deepCopyLanes(nonPitchLanesOf(curve)));
  }
  const bbox = pointMode && pointIndicesPerCurve
    ? computePointSubsetBBox(curves, pointIndicesPerCurve)
    : computeMultiCurveBBox(curves);
  istate.transformBox = {
    curveIds: selectedIds,
    originalPointsMap: map,
    originalNonPitchLanesMap: nonPitchMap,
    bbox,
    activeHandle: null,
    dragStart: null,
    pointIndicesPerCurve,
  };
}

function handleDeleteClick(worldPt: Vec2, vp: Viewport): void {
  const track = getSelectedTrack();
  if (!track) return;

  for (const curve of track.curves) {
    for (let i = 0; i < pitchPoints(curve).length; i++) {
      const pt = pitchPoints(curve)[i]!;
      if (screenDist(worldPt, pt.position, vp) < DELETE_HIT_PX) {
        history.snapshot();
        // Group-aware: deleting any point on a grouped curve removes the entire
        // group (matches Phase 2 design: groups couple delete actions).
        if (curve.groupId) {
          const groupId = curve.groupId;
          store.mutate(() => {
            for (let j = track.curves.length - 1; j >= 0; j--) {
              if (track.curves[j]!.groupId === groupId) track.curves.splice(j, 1);
            }
          });
          return;
        }
        store.mutate(() => {
          pitchPoints(curve).splice(i, 1);
          // Remove curve if empty
          if (pitchPoints(curve).length === 0) {
            const idx = track.curves.indexOf(curve);
            if (idx >= 0) track.curves.splice(idx, 1);
          }
        });
        return;
      }
    }
  }
}

/** Screen-space distance between two world points. The only correct way to
 *  hit-test a fixed-pixel radius: X (beats) and Y (pitch cents) use very
 *  different world-units-per-pixel scales, so comparing a raw world-space
 *  Euclidean distance against a single radius (the old approach) silently
 *  breaks whenever those two scales diverge — as they now do, since pitch
 *  moved from semitone- to cents-scale Y values. */
function screenDist(a: Vec2, b: Vec2, vp: Viewport): number {
  const dx = (a.x - b.x) * vp.state.zoomX;
  const dy = (a.y - b.y) * vp.state.zoomY;
  return Math.sqrt(dx * dx + dy * dy);
}

const DRAW_HIT_PX = 8;       // Draw tool: click-to-grab-existing-point radius
const SELECT_HIT_PX = 4;     // Select tool: point / handle / segment hit radius
const DELETE_HIT_PX = 8;     // Delete tool: point hit radius
const FIND_CURVE_HIT_PX = 8; // findCurveAt: point / segment hit radius
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
    if (pitchPoints(curve).length < 3) continue;
    for (let i = 1; i < pitchPoints(curve).length - 1; i++) {
      if (screenDist(worldPt, pitchPoints(curve)[i]!.position, vp) < SCISSORS_HIT_PX) {
        return { curve, segmentIndex: -1, t: 0, point: { ...pitchPoints(curve)[i]!.position }, atPoint: true };
      }
    }
  }

  // Second pass: cut on curve segments (screen-space distance)
  const snap = buildSnapConfig(vp.state.zoomX);
  for (const curve of track.curves) {
    if (pitchPoints(curve).length < 2) continue;
    for (let i = 0; i < pitchPoints(curve).length - 1; i++) {
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
    const cutPts = pitchPoints(cut.curve);
    const pointIdx = cutPts.findIndex(p => p.position.x === cut.point.x && p.position.y === cut.point.y);
    if (pointIdx < 1 || pointIdx >= cutPts.length - 1) return;
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

/**
 * Harmonic Prism Draw mode click handler — places N grouped sibling curves
 * (or extends an existing chord cluster) at the snapped (X, base Y), with
 * each voice at base Y + chord offset.
 */
function handleDrawClickPrism(istate: InteractionState, worldPt: Vec2): void {
  const state = store.getState();
  const track = getSelectedTrack();
  if (!track) return;

  const spec = state.harmonicPrism.chordSpec;
  const offsets = chordOffsets(spec);
  if (offsets.length === 0) return;

  // Identify a chord-cluster primary to extend, if any:
  //   - the active drawingCurve, if it's voiceIndex 0 of a group, OR
  //   - the singly-selected curve, if it's voiceIndex 0 of a group.
  let primary: BezierCurve | null = istate.drawingCurve;
  if (primary && (!primary.groupId || primary.voiceIndex !== 0 || !track.curves.includes(primary))) {
    primary = null;
  }
  if (!primary) {
    const selId = store.getSelectedCurveId();
    if (selId) {
      const sel = track.curves.find(c => c.id === selId);
      if (sel && sel.groupId && sel.voiceIndex === 0) primary = sel;
    }
  }

  const clampY = (y: number) => Math.max(MIN_PITCH_CENTS, Math.min(MAX_PITCH_CENTS, y));

  if (primary && primary.groupId) {
    // EXTEND existing chord cluster: add a parallel point to each sibling.
    const groupId = primary.groupId;
    const siblings = track.curves.filter(c => c.groupId === groupId);
    history.snapshot();
    let primaryNewIdx = 0;
    store.mutate(() => {
      for (const sib of siblings) {
        const vIdx = sib.voiceIndex ?? 0;
        if (vIdx >= offsets.length) continue; // current spec has fewer voices than placed; skip
        const offset = offsets[vIdx]!;
        const point = createControlPoint(worldPt.x, clampY(worldPt.y + offset));
        const idx = addPointToCurve(sib, point);
        reclampHandlesAround(sib, idx);
        if (state.bezierAutoSmooth) applyAutoSmoothHandles(sib, idx, state.autoSmoothXRatio);
        if (sib.id === primary!.id) primaryNewIdx = idx;
      }
    });
    istate.drawingCurve = primary;
    store.setSelectedCurves(siblings.map(s => s.id));
    store.setSelectedPoint(primaryNewIdx);
    istate.dragging = 'handleOut';
    istate.dragCurveId = primary.id;
    istate.dragPointIndex = primaryNewIdx;
    istate.dragStartWorld = { ...worldPt };
    return;
  }

  // CREATE a brand new chord cluster.
  history.snapshot();
  const groupId = createGroupId();
  const newCurves: BezierCurve[] = [];
  let primaryCurve: BezierCurve | null = null;
  store.mutate(comp => {
    const t = comp.tracks.find(tt => tt.id === state.selectedTrackId);
    if (!t) return;
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i]!;
      const curve = createCurve();
      curve.groupId = groupId;
      curve.voiceIndex = i;
      const point = createControlPoint(worldPt.x, clampY(worldPt.y + offset));
      addPointToCurve(curve, point);
      t.curves.push(curve);
      newCurves.push(curve);
      if (i === 0) primaryCurve = curve;
    }
  });
  if (!primaryCurve) return;
  // Re-fetch primary from track since store.mutate may have replaced refs (it doesn't here, but be safe).
  istate.drawingCurve = primaryCurve;
  store.setSelectedCurves(newCurves.map(c => c.id));
  store.setSelectedPoint(0);
  istate.dragging = 'handleOut';
  istate.dragCurveId = (primaryCurve as BezierCurve).id;
  istate.dragPointIndex = 0;
  istate.dragStartWorld = { ...worldPt };
}

function handleDrag(istate: InteractionState, snapped: { wx: number; wy: number }): void {
  const track = getSelectedTrack();
  if (!track || !istate.dragCurveId) return;

  const curve = track.curves.find(c => c.id === istate.dragCurveId);
  if (!curve) return;

  // Identify chord-cluster siblings for placement-time handle propagation.
  // We mirror handle deltas across siblings only during the in-progress draw
  // (post-click handle pull). Once the user leaves Draw mode or starts editing
  // the cluster via Select tool, point/handle drags are local to one curve.
  const state = store.getState();
  const isPlacementDrag = state.activeTool === 'draw'
    && istate.drawingCurve !== null
    && istate.drawingCurve.id === istate.dragCurveId;
  const propagateToSiblings = isPlacementDrag
    && curve.groupId
    && curve.voiceIndex === 0
    && (istate.dragging === 'handleOut' || istate.dragging === 'handleIn');
  const siblings = propagateToSiblings
    ? track.curves.filter(c => c.groupId === curve.groupId && c.id !== curve.id)
    : [];

  store.mutate(() => {
    if (istate.dragging === 'point') {
      movePoint(curve, istate.dragPointIndex, { x: snapped.wx, y: snapped.wy });
      // Re-clamp neighboring handles so they don't extend past the moved point.
      reclampHandlesAround(curve, istate.dragPointIndex);
    } else if (istate.dragging === 'handleOut' || istate.dragging === 'handleIn') {
      const pt = pitchPoints(curve)[istate.dragPointIndex];
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

      // Chord-cluster placement: copy the handle relative offsets to every sibling
      // at the same point index so all voices share the same shape.
      if (propagateToSiblings) {
        for (const sib of siblings) {
          if (istate.dragPointIndex >= pitchPoints(sib).length) continue;
          setHandle(sib, istate.dragPointIndex, which, rel);
          setHandle(sib, istate.dragPointIndex, opposite, mirrorRel);
        }
      }
    }
  });
}

function finishDrawing(istate: InteractionState): void {
  // Attach a default volume lane once the drawn curve spans a real time range,
  // so it's immediately editable in the Parameters Graph. No-op for < 2 points
  // or if a lane already exists; the default value matches the sampler fallback
  // so audio is unchanged.
  if (istate.drawingCurve) ensureLane(istate.drawingCurve, 'volume');
  istate.drawingCurve = null;
  istate.dragging = null;
  store.setSelectedCurve(null);
  store.setSelectedPoint(null);
}


/** Find the curve (point or segment) at a given world position. */
function findCurveAt(worldPt: Vec2, vp: Viewport, track: Track): BezierCurve | null {
  // Check anchor points
  for (const curve of track.curves) {
    for (const pt of pitchPoints(curve)) {
      if (screenDist(worldPt, pt.position, vp) < FIND_CURVE_HIT_PX) return curve;
    }
  }

  // Check curve segments
  for (const curve of track.curves) {
    if (pitchPoints(curve).length < 2) continue;
    for (let i = 0; i < pitchPoints(curve).length - 1; i++) {
      const seg = getSegmentControlPoints(curve, i);
      if (!seg) continue;
      const nearest = nearestPointOnCubicScaled(
        seg.p0, seg.p1, seg.p2, seg.p3, worldPt,
        vp.state.zoomX, vp.state.zoomY,
      );
      if (nearest.dist < FIND_CURVE_HIT_PX) return curve;
    }
  }

  return null;
}

function getSelectedTrack(): Track | undefined {
  const state = store.getState();
  return state.composition.tracks.find(t => t.id === state.selectedTrackId);
}

/** Like buildSnapConfig, but filters one guide ID out of the guide targets so
 *  a dragging guide doesn't snap to itself. */
export function buildSnapConfigExcludingGuide(zoomX: number, wxForProjection: number, excludeGuideId: string): SnapConfig {
  const cfg = buildSnapConfig(zoomX, wxForProjection);
  const state = store.getState();
  if (!state.guidesVisible) return cfg;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const g of state.composition.guides) {
    if (g.id === excludeGuideId) continue;
    if (g.orientation === 'x') xs.push(g.position);
    else ys.push(g.position);
  }
  return {
    ...cfg,
    guideXTargets: xs.length > 0 ? xs : undefined,
    guideYTargets: ys.length > 0 ? ys : undefined,
  };
}

export function buildSnapConfig(zoomX?: number, wxForProjection?: number): SnapConfig {
  const state = store.getState();
  const subdivisions = zoomX !== undefined
    ? getAdaptiveSubdivisions(zoomX)
    : SUBDIVISIONS_PER_BEAT;

  // Harmonic Prism: when projection mode is active, add echo Y targets
  // at the cursor X as additional snap candidates.
  let projectionTargets: readonly number[] | undefined;
  const prism = state.harmonicPrism;
  if (prism.projectionSourceId && wxForProjection !== undefined) {
    const track = state.composition.tracks.find(t =>
      t.curves.some(c => c.id === prism.projectionSourceId),
    );
    const source = track?.curves.find(c => c.id === prism.projectionSourceId);
    if (source) {
      projectionTargets = computeProjectionTargetsAtX(
        source,
        prism.chordSpec,
        prism.projectionOctaveRange,
        wxForProjection,
      );
    }
  }

  // User-defined snap guides (Phase 8.7) — only participate in snap when visible.
  let guideXTargets: readonly number[] | undefined;
  let guideYTargets: readonly number[] | undefined;
  if (state.guidesVisible && state.composition.guides.length > 0) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const g of state.composition.guides) {
      if (g.orientation === 'x') xs.push(g.position);
      else ys.push(g.position);
    }
    if (xs.length > 0) guideXTargets = xs;
    if (ys.length > 0) guideYTargets = ys;
  }

  return {
    enabled: state.snapEnabled,
    subdivisionsPerBeat: subdivisions,
    scaleRoot: state.scaleRoot,
    scale: state.scaleId ? getScaleById(state.scaleId) ?? null : null,
    hidePitchLines: state.hidePitchLines,
    projectionTargets,
    guideXTargets,
    guideYTargets,
  };
}
