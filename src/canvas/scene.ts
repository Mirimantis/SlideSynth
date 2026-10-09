/**
 * Drawing both canvases and the Parameters Graph from the current state
 * (BACKLOG 15.5; split out of main.ts in 15.3). Read-only: it never changes
 * the composition. The frame loop in main.ts decides when to draw.
 */

import type { BezierCurve, PlanchetteState } from '../types';
import type { Viewport } from './viewport';
import type { ParamViewport } from './param-viewport';
import type { ParamInteraction } from './param-interaction';
import type { PerformanceEngine } from './performance-engine';
import type { PlaybackEngine } from '../audio/playback';
import { store } from '../state/store';
import { currentSnapConfig } from '../state/snap-config';
import { isPerformInputActive } from '../state/perform-mode';
import { isRecordArmed } from '../state/transport';
import { takeBgDirty } from '../app/redraw';
import { measureLengthInBeats } from '../model/composition';
import { pitchPoints } from '../model/curve';
import { displayedLane } from '../model/lane';
import { trackShown } from '../model/track';
import { shownGuides } from '../model/frets';
import { pointsInReach } from '../model/nudge';
import {
  DEFAULT_MOVE_INTERVAL, moveIntervalShort, pitchLabel, prismOffsets, prismOffsetsAt, resolveTuning, staffGridFor,
} from '../tuning/tuning';
import { snapToGrid } from '../utils/snap';
import { themeColor } from '../theme/theme';
import { editingCurveIds, transformBoxHoldsGroup, RULER_HEIGHT, GUIDE_HANDLE_WIDTH, type Interaction } from './interaction';
import { renderStaff } from './staff-renderer';
import { renderRuler } from './ruler-renderer';
import { renderCurves, renderDrawPreview } from './curve-renderer';
import { renderTransformBox } from './transform-box-renderer';
import { outlinedGroups, renderGroupOutlines } from './group-outline';
import { renderMarquee } from './marquee-renderer';
import { renderProjection, renderProjectionSourceHighlight, renderPrismDrawPreview } from './projection-renderer';
import { renderNudgeBrush, renderNudgeRing } from './nudge-brush';
import { renderPlayhead } from './playhead';
import { renderLoopMarkers } from './loop-markers';
import { renderGuideHandle, renderGuides } from './guides';
import { renderParamGraph } from './param-graph-renderer';
import {
  renderPlanchettes, renderFreePlanchette, renderRail, renderRecordingTrails,
} from './planchette';

export interface SceneDeps {
  bgCtx: CanvasRenderingContext2D;
  fgCtx: CanvasRenderingContext2D;
  paramCtx: CanvasRenderingContext2D;
  canvasContainer: HTMLElement;
  viewport: Viewport;
  paramViewport: ParamViewport;
  interaction: Interaction;
  paramInteraction: ParamInteraction;
  composeEngine: PerformanceEngine;
  playback: PlaybackEngine;
  /** The Parameters Graph canvas's size in CSS px. */
  paramSize(): { w: number; h: number };
  getSelectedParamCurve(): BezierCurve | null;
  /** Hold-A audition is sounding (the free planchette). */
  previewActive(): boolean;
  effectiveScrollCanvas(): boolean;
  /** The planchettes at the pitches they sound (Prism offsets applied). */
  planchettesAsSounding(planchettes: PlanchetteState[]): PlanchetteState[];
  /** A voice's dynamics for its halo, or null to draw it plain. */
  planchetteDynamicsOf(voiceId: string): number | null;
}

export interface Scene {
  draw(): void;
  /** Frames drawn so far: flat while idle (15.5). */
  drawCount(): number;
}

export function createScene(deps: SceneDeps): Scene {
  const {
    bgCtx, fgCtx, paramCtx, canvasContainer, viewport, paramViewport, interaction, paramInteraction,
    composeEngine, playback, paramSize, getSelectedParamCurve, previewActive, effectiveScrollCanvas,
    planchettesAsSounding, planchetteDynamicsOf,
  } = deps;
  let drawCount = 0;

  /** Draw both canvases from current state. Read-only (15.5). */
  function draw() {
    drawCount++;
    const state = store.getState();
    const comp = state.composition;
    const rect = canvasContainer.getBoundingClientRect();

    // Background: staff grid. Stays visible during Harmonic Prism projection
    // so the user can see where they are in the pitch spectrum; snap itself
    // switches to echo-only targets (see snapToGrid).
    if (takeBgDirty()) {

      const measureLen = measureLengthInBeats(comp);
      bgCtx.clearRect(0, 0, rect.width, rect.height);
      renderStaff(
        bgCtx, viewport, rect.width, rect.height, measureLen,
        state.hidePitchLines ? null : staffGridFor(state), state.referenceLines,
      );
      renderRuler(bgCtx, viewport, rect.width, measureLen, comp.bpm);
    }

    // Foreground: curves + playhead + interaction
    fgCtx.clearRect(0, 0, rect.width, rect.height);

    // Transform box (rendered behind curves so unselected curves remain clickable)
    const activeTrack = comp.tracks.find(t => t.id === state.selectedTrackId);
    if (interaction.transformBox) {
      const tb = interaction.transformBox;
      renderTransformBox(
        fgCtx, viewport, tb.bbox, tb.activeHandle, !!activeTrack && transformBoxHoldsGroup(tb, activeTrack),
        state.moveInterval === DEFAULT_MOVE_INTERVAL ? null : moveIntervalShort(state.moveInterval),
      );
    }
    // Groups with a hovered or selected member share an outline (16.5).
    if (activeTrack && !isPerformInputActive(state)) {
      renderGroupOutlines(fgCtx, viewport, outlinedGroups(activeTrack, state.selectedCurveIds, interaction.hoverGroupedCurveId));
    }

    // Harmonic Prism — resolve the projection source curve up front. (The store
    // drops a source whose curve is deleted.)
    let prismSource: BezierCurve | null = null;
    if (state.harmonicPrism.projectionSourceId) {
      const prismSrcId = state.harmonicPrism.projectionSourceId;
      for (const track of comp.tracks) {
        const found = track.curves.find(c => c.id === prismSrcId);
        if (found) { prismSource = found; break; }
      }
    }

    // Projection echoes: rendered behind curves.
    if (prismSource) {
      renderProjection(
        fgCtx,
        viewport,
        prismSource,
        prismOffsets(state.harmonicPrism.chordSpec, state),
        state.harmonicPrism.projectionOctaveRange,
        rect.width,
        rect.height,
      );
    }

    // Render curves for all tracks
    const geometryVersion = store.compositionVersion();
    for (const track of comp.tracks) {
      // Hidden tracks, and guide tracks with the Guides switch off, aren't drawn;
      // muted ones are, dimmed (13.10 (b)).
      if (!trackShown(track, state.guidesVisible)) continue;
      const tone = comp.toneLibrary.find(t => t.id === track.toneId);
      if (!tone) continue;

      const isActiveTrack = track.id === state.selectedTrackId;
      const emptySet = new Set<string>();
      renderCurves(
        fgCtx, viewport, track.curves, tone,
        isActiveTrack ? state.selectedCurveIds : emptySet,
        isActiveTrack ? store.getSelectedCurveId() : null,
        isActiveTrack ? state.selectedPointIndex : null,
        isActiveTrack,
        isActiveTrack ? state.selectedPoints : null,
        geometryVersion,
        // Guide tracks draw as guides, unless the Guides switch hides them all.
        !!track.guide,
        track.muted,
      );
    }

    // Rainbow highlight on the projection-source curve (drawn last so it sits
    // on top of the normal curve stroke).
    if (prismSource) {
      renderProjectionSourceHighlight(fgCtx, viewport, prismSource);
    }

    // The active tool's hover overlays (draw preview line, Prism chord preview,
    // slice marker) follow the cursor only while the tool owns the pointer: not
    // after the cursor has left the canvas, and not in Perform, where the tools
    // get no pointer moves and the overlays would freeze where Perform began.
    const toolHoverVisible = !state.performMode && interaction.cursorInCanvas;

    // Draw preview line when in draw mode (hidden during Ctrl-select).
    if (state.activeTool === 'draw' && interaction.cursorWorld && toolHoverVisible) {
      // Use the drawing curve, or the single selected curve if not actively drawing
      const singleId = store.getSelectedCurveId();
      const previewCurve = interaction.drawingCurve
        ?? (singleId
          ? comp.tracks.find(t => t.id === state.selectedTrackId)
              ?.curves.find(c => c.id === singleId)
          : null);
      const points = previewCurve ? pitchPoints(previewCurve) : undefined;
      const track = comp.tracks.find(t => t.id === state.selectedTrackId);
      const tone = track ? comp.toneLibrary.find(t => t.id === track.toneId) : null;
      const color = tone?.color ?? themeColor('accent');

      if (points && points.length > 0) {
        const cx = interaction.cursorWorld.x;

        // Find the neighboring point(s) the cursor sits between
        const firstPt = points[0]!;
        const lastPt = points[points.length - 1]!;

        if (cx <= firstPt.position.x) {
          // Before the first point — connect to the first point
          renderDrawPreview(fgCtx, viewport, firstPt.position, interaction.cursorWorld, color);
        } else if (cx >= lastPt.position.x) {
          // After the last point — connect to the last point
          renderDrawPreview(fgCtx, viewport, lastPt.position, interaction.cursorWorld, color);
        } else {
          // Between two points — connect to both neighbors
          for (let i = 0; i < points.length - 1; i++) {
            if (cx >= points[i]!.position.x && cx <= points[i + 1]!.position.x) {
              renderDrawPreview(fgCtx, viewport, points[i]!.position, interaction.cursorWorld, color);
              renderDrawPreview(fgCtx, viewport, points[i + 1]!.position, interaction.cursorWorld, color);
              break;
            }
          }
        }
      } else if (track) {
        // No curve yet — show standalone cursor dot for first point placement
        const scr = viewport.worldToScreen(interaction.cursorWorld.x, interaction.cursorWorld.y);
        fgCtx.beginPath();
        fgCtx.arc(scr.sx, scr.sy, 4, 0, Math.PI * 2);
        fgCtx.fillStyle = color;
        fgCtx.globalAlpha = 0.6;
        fgCtx.fill();
        fgCtx.globalAlpha = 1;
      }
    }

    // Harmonic Prism Draw mode: render the multi-planchette chord preview at the
    // cursor. Each click will place N grouped sibling curves at these Y offsets.
    // In Perform the rail planchettes show the chord instead.
    if (state.activeTool === 'draw'
        && state.harmonicPrism.drawMode
        && interaction.cursorWorld
        && toolHoverVisible) {
      const snap = currentSnapConfig({
        zoomX: viewport.state.zoomX, atBeat: interaction.cursorWorld.x, excludeCurveIds: editingCurveIds(interaction),
      });
      const snapped = snapToGrid(interaction.cursorWorld.x, interaction.cursorWorld.y, snap);
      const cursorScreenX = viewport.worldToScreen(snapped.wx, 0).sx;
      renderPrismDrawPreview(
        fgCtx,
        viewport,
        cursorScreenX,
        snapped.wy,
        prismOffsetsAt(state.harmonicPrism.chordSpec, state, snapped.wy),
        rect.height,
        RULER_HEIGHT,
      );
    }

    // The Nudge brush (13.26): over the curve being nudged, or the one hovered,
    // moving with the cursor. During a Push the lit points are the ones being
    // moved, by the weight they had when the stroke began. A faint ring round the
    // cursor shows the size.
    if (state.activeTool === 'nudge' && !state.performMode) {
      const drag = interaction.nudgeDrag;
      const cursor = interaction.cursorWorld;
      if (drag) {
        const curve = comp.tracks.flatMap(t => t.curves).find(c => c.id === drag.curveId);
        if (curve) {
          const push = state.nudgeMode === 'push';
          const centerX = push ? drag.centerX + drag.dx : cursor?.x ?? drag.centerX;
          const reach = push
            ? pointsInReach(drag.orig.map(p => p.position.x), drag.centerX, drag.radius)
            : pointsInReach(pitchPoints(curve).map(p => p.position.x), centerX, drag.radius);
          renderNudgeBrush(fgCtx, viewport, curve, centerX, drag.radius, reach, RULER_HEIGHT, rect.height);
        }
      } else if (toolHoverVisible && interaction.nudgeHover) {
        const hover = interaction.nudgeHover;
        const curve = comp.tracks.flatMap(t => t.curves).find(c => c.id === hover.curveId);
        if (curve) {
          const reach = pointsInReach(pitchPoints(curve).map(p => p.position.x), hover.centerX, hover.radius);
          renderNudgeBrush(fgCtx, viewport, curve, hover.centerX, hover.radius, reach, RULER_HEIGHT, rect.height);
        }
      }
      if (cursor && (drag || toolHoverVisible)) {
        const s = viewport.worldToScreen(cursor.x, cursor.y);
        renderNudgeRing(fgCtx, s.sx, s.sy, state.nudgeSize);
      }
    }

    // Scissors preview dot
    if (state.activeTool === 'scissors' && interaction.scissorsPreview && toolHoverVisible) {
      const scr = viewport.worldToScreen(interaction.scissorsPreview.x, interaction.scissorsPreview.y);
      fgCtx.beginPath();
      fgCtx.arc(scr.sx, scr.sy, 5, 0, Math.PI * 2);
      fgCtx.fillStyle = themeColor('scissors-dot');
      fgCtx.fill();
      fgCtx.lineWidth = 1.5;
      fgCtx.strokeStyle = themeColor('scissors-dot-edge');
      fgCtx.stroke();
    }

    // Loop markers (behind the playhead so it stays on top)
    if (store.getState().loopEnabled) {
      renderLoopMarkers(fgCtx, viewport, comp.loopStartBeats, comp.loopEndBeats, rect.height);
    }

    // Snap guides — between loop markers and the playhead so the playhead always
    // wins Z-order. Only those on show, which are the ones that pull (Guides,
    // and Frets for frets, 13.22).
    const guidesShown = shownGuides(state);
    if (guidesShown.length > 0) {
      renderGuides(
        fgCtx, viewport, guidesShown, rect.width, rect.height, state.selectedGuideId,
        c => pitchLabel(state, c), resolveTuning(state.tuning).period,
      );
    }
    // The handle frets and beat guides are dragged out of (13.17), over the ruler's left end.
    renderGuideHandle(fgCtx, GUIDE_HANDLE_WIDTH, RULER_HEIGHT, state.guidesLocked);

    // Live recording trail: polyline of in-flight samples per voice. Drawn above
    // committed curves but below the rail/planchette glyph so the planchette
    // visually leads the trail. Buffers are cleared on finalize, so the trail
    // disappears the same frame the simplified curve commits.
    renderRecordingTrails(
      fgCtx,
      viewport,
      composeEngine.getRecordingBuffers(),
      rect.height,
      state.harmonicPrism.drawMode,
    );

    // Playhead vs Rail.
    // Scroll Canvas ON (or Record forcing it on): the playhead becomes a stationary rail
    // at canvas-centre — visible in Idle too, so pressing Play starts from where the user
    // already sees the rail (rail + planchette dot + pulse).
    // Scroll Canvas OFF: classic moving playhead at the stored position.
    const railVisible = effectiveScrollCanvas();
    const freePlanchetteVisible = !playback.isPlaying()
      && previewActive()
      && interaction.cursorInCanvas
      && interaction.cursorWorld != null;
    // Rail-bound planchette dot is only meaningful when an actual or potential
    // tone is sounding/recording — Playback running, Record armed, or LMB held
    // in Perform. In Scroll Canvas idle the rail still shows (so the user knows
    // where Play would start), but the planchette dot is hidden so it doesn't
    // visually promise a tone is sounding when none is.
    const railPlanchetteVisible = railVisible
      && !freePlanchetteVisible
      && (state.performMode
          || playback.isPlaying()
          || isRecordArmed(state.transport)
          || composeEngine.isLmbDown());
    if (railVisible) {
      if (freePlanchetteVisible) {
        // Free planchette at cursor is the action location (preview tone follows cursor),
        // so draw just the rail — skip the rail-bound planchette dot to avoid a duplicate.
        renderRail(fgCtx, rect.width, rect.height, composeEngine.getLastLoopWrapAt());
        // Composition+tone preview: also render a transient playhead at cursor X so the
        // user can see where in the composition they're scrubbing. Rail still marks where
        // a real Play would start from; this playhead disappears when preview ends.
        if (state.drawPreviewMode === 'composition' && interaction.cursorWorld) {
          renderPlayhead(fgCtx, viewport, interaction.cursorWorld.x, rect.height);
        }
      } else if (railPlanchetteVisible) {
        renderPlanchettes(
          fgCtx, viewport, rect.width, rect.height,
          planchettesAsSounding(state.performance.planchettes),
          composeEngine.getLastLoopWrapAt(),
          state.harmonicPrism.drawMode,
          planchetteDynamicsOf,
        );
      } else {
        renderRail(fgCtx, rect.width, rect.height, composeEngine.getLastLoopWrapAt());
      }
    } else {
      const playheadBeat = playback.isPlaying()
        ? playback.getPositionBeats()
        : state.playback.positionBeats;
      renderPlayhead(fgCtx, viewport, playheadBeat, rect.height);
    }

    // Drag-marquee rubber-band (BACKLOG 8.3) — drawn on top of everything else
    // so it's always visible during the drag.
    if (interaction.marquee) {
      renderMarquee(fgCtx, viewport, interaction.marquee.startWorld, interaction.marquee.currentWorld);
    }

    // Free planchette: Idle + hold-A audition + cursor over canvas.
    // Rendered at cursor X so the user sees exactly where they'd place / are hearing.
    if (freePlanchetteVisible && interaction.cursorWorld) {
      const cursorWorld = interaction.cursorWorld;
      const cursorScreenX = viewport.worldToScreen(cursorWorld.x, 0).sx;
      // Same snap config the preview tone is tuned with (guides and Prism
      // echoes included), so the dot sits where the pitch you hear is (14.4).
      const snapped = snapToGrid(0, cursorWorld.y, currentSnapConfig({ zoomX: viewport.state.zoomX, atBeat: cursorWorld.x }));
      renderFreePlanchette(
        fgCtx, viewport, cursorScreenX, snapped.wy,
        cursorWorld.y, rect.height,
      );
    }

    // ── Parameters Graph: selected curve's volume lane (X-locked to main canvas) ──
    {
      const selCurve = getSelectedParamCurve();
      let paramColor = themeColor('accent');
      if (selCurve) {
        for (const track of comp.tracks) {
          if (track.curves.includes(selCurve)) {
            const tone = comp.toneLibrary.find(t => t.id === track.toneId);
            if (tone) paramColor = tone.color;
            break;
          }
        }
      }
      const paramPlayheadBeat = playback.isPlaying()
        ? playback.getPositionBeats()
        : state.playback.positionBeats;
      const selPts = selCurve ? pitchPoints(selCurve) : undefined;
      const pitchStart = selPts && selPts.length > 0 ? selPts[0]!.position.x : null;
      const pitchEnd = selPts && selPts.length > 0 ? selPts[selPts.length - 1]!.position.x : null;
      renderParamGraph(
        paramCtx, paramViewport, viewport,
        paramSize().w, paramSize().h,
        // A curve with no volume lane shows the default it sounds with; the graph
        // attaches it on the first edit (param-interaction.ts).
        (selCurve ? displayedLane(selCurve, 'volume') : null) ?? null,
        paramColor,
        paramInteraction.selectedIndex(),
        paramPlayheadBeat,
        pitchStart,
        pitchEnd,
      );
    }
  }

  return { draw, drawCount: () => drawCount };
}
