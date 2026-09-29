import type { BezierCurve, Track } from '../types';
import type { Viewport } from '../canvas/viewport';
import type { CommandId } from './catalog';
import type { CommandHandler } from './registry';
import { store } from '../state/store';
import { history } from '../state/history';
import { copySelectedCurves, cutSelectedCurves, pasteCurves, duplicateCurves, continueCurves, hasClipboard } from '../state/clipboard';
import { moveSelectionByInterval, rebuildTransformBox, type InteractionState } from '../canvas/interaction';
import { joinCurves, sharpenCurveHandles, smoothCurveHandles, pitchPoints, deleteSelectedPoints } from '../model/curve';
import { NO_POINTS, pointCount } from '../model/point-selection';
import { simplifyCurve } from '../model/fit';
import { assignGroup, dissolveGroup, allShareGroup, anyGrouped } from '../model/curve-groups';
import { showToast } from '../ui/toast';

/** The Edit section of the command catalog (BACKLOG 15.3): undo, clipboard,
 *  delete, join, group, smooth / sharpen / simplify. */
export type EditCommandId = Extract<CommandId,
  | 'edit.undo' | 'edit.redo' | 'edit.copy' | 'edit.cut' | 'edit.paste' | 'edit.duplicate' | 'edit.continue'
  | 'edit.delete' | 'edit.join' | 'edit.group' | 'edit.ungroup' | 'edit.smooth' | 'edit.sharpen' | 'edit.simplify'
  | 'edit.moveUp' | 'edit.moveDown' | 'edit.copyUp' | 'edit.copyDown'
  | 'edit.sendToGuides' | 'edit.copyToGuides'>;

export interface EditContext {
  interaction: InteractionState;
  viewport: Viewport;
  /** The left button is performing; curve edits that would pull a curve out
   *  from under the capture are off. */
  isPerformLocked(): boolean;
  /** Where Paste lands. */
  pasteBeat(): number;
}

function activeTrack(): Track | undefined {
  const st = store.getState();
  return st.composition.tracks.find(t => t.id === st.selectedTrackId);
}

/** The selected curves on the active track. */
function selectedCurves(): { track: Track; curves: BezierCurve[] } | null {
  const track = activeTrack();
  if (!track) return null;
  const curves = [...store.getState().selectedCurveIds]
    .map(id => track.curves.find(c => c.id === id))
    .filter((c): c is BezierCurve => !!c);
  return { track, curves };
}

export function createEditCommands(ctx: EditContext): Record<EditCommandId, CommandHandler> {
  const { interaction } = ctx;

  function clearInteractionForUndo() {
    interaction.drawingCurve = null;
    interaction.dragging = null;
    interaction.transformBox = null;
  }

  /** Show a transform box around what the command just created. */
  function boxNewCurves(newIds: string[] | null) {
    const track = newIds && activeTrack();
    if (track) rebuildTransformBox(interaction, track);
  }

  const hasSelection = () => store.getState().selectedCurveIds.size > 0;
  const canMove = () => !ctx.isPerformLocked() && (hasSelection() || store.getState().selectedPoints.size > 0);
  // Curves on a sounding track, not while performing.
  const canSendToGuides = () => !ctx.isPerformLocked() && hasSelection() && !activeTrack()?.guide;
  const canCopyMove = () => !ctx.isPerformLocked() && hasSelection() && store.getState().selectedPoints.size === 0;
  /** Delete has something to act on: a guide, points, or curves. */
  const canDelete = () => {
    const s = store.getState();
    return (s.selectedGuideId !== null && !s.guidesLocked) || pointCount(s.selectedPoints) > 0
      || s.selectedPointIndex !== null || s.selectedCurveIds.size > 0;
  };

  return {
    'edit.undo': {
      run() { clearInteractionForUndo(); history.undo(); },
      enabled: () => history.canUndo(),
    },
    'edit.redo': {
      run() { clearInteractionForUndo(); history.redo(); },
      enabled: () => history.canRedo(),
    },
    // Each says when it can act, so the Edit menu (16.3) greys out the rest.
    'edit.copy': { run: () => { copySelectedCurves(); }, enabled: hasSelection },
    'edit.cut': {
      run() { if (cutSelectedCurves()) interaction.transformBox = null; },
      enabled: hasSelection,
    },
    'edit.paste': { run: () => boxNewCurves(pasteCurves(ctx.pasteBeat())), enabled: hasClipboard },
    'edit.duplicate': { run: () => boxNewCurves(duplicateCurves()), enabled: hasSelection },
    'edit.continue': { run: () => boxNewCurves(continueCurves()), enabled: hasSelection },

    'edit.delete': {
      enabled: canDelete,
      // One key, most specific selection first: a guide, then selected
      // points, then the selected curves.
      run() {
        const s = store.getState();
        if (s.selectedGuideId && !s.guidesLocked) {
          history.snapshot();
          store.removeGuide(s.selectedGuideId);
          return;
        }
        // Multi-point selection (8.3): remove every selected point. Curves left
        // with fewer than 2 points go too.
        const selectedCount = pointCount(s.selectedPoints);
        if (selectedCount > 1 || (selectedCount === 1 && s.selectedPointIndex === null)) {
          history.snapshot();
          const sel = s.selectedPoints;
          store.mutate(comp => deleteSelectedPoints(comp, sel));
          store.clearPointSelection();
          store.setSelectedCurve(null);
          return;
        }
        // The single selected point of the single selected curve.
        const curveId = store.getSelectedCurveId();
        if (curveId && s.selectedPointIndex !== null) {
          const track = activeTrack();
          const curve = track?.curves.find(c => c.id === curveId);
          if (!track || !curve) return;
          const index = s.selectedPointIndex;
          history.snapshot();
          store.mutate(() => {
            pitchPoints(curve).splice(index, 1);
            if (pitchPoints(curve).length === 0) track.curves.splice(track.curves.indexOf(curve), 1);
          });
          store.setSelectedPoint(null);
          store.setSelectedCurve(pitchPoints(curve).length > 0 ? curve.id : null);
          return;
        }
        // Whole curves, when no point is selected — and not while they may be
        // mid-capture.
        if (s.selectedCurveIds.size > 0 && s.selectedPointIndex === null && s.selectedPoints.size === 0
            && !ctx.isPerformLocked()) {
          history.snapshot();
          const ids = new Set(s.selectedCurveIds);
          store.mutate(() => {
            const track = activeTrack();
            if (!track) return;
            for (let i = track.curves.length - 1; i >= 0; i--) {
              if (ids.has(track.curves[i]!.id)) track.curves.splice(i, 1);
            }
          });
          store.setSelectedCurve(null);
          interaction.transformBox = null;
        }
      },
    },

    'edit.join': {
      enabled: () => store.getState().selectedCurveIds.size >= 2,
      run() {
        const sel = selectedCurves();
        if (!sel || sel.curves.length < 2) return;
        const { track, curves } = sel;
        // Curves from different groups can't merge (a chord-cluster member
        // can't join another cluster). Ungrouped curves join freely, and a
        // same-group join keeps the group.
        const groupIds = new Set(curves.map(c => c.groupId).filter((g): g is string => !!g));
        if (groupIds.size > 1) {
          showToast("Can't join curves from different groups");
          return;
        }
        const { zoomX, zoomY } = ctx.viewport.state;
        const { merged, consumedIds } = joinCurves(curves, Math.max(8 / zoomX, 8 / zoomY));
        if (consumedIds.size < 2) return;
        if (groupIds.size === 1) merged.groupId = [...groupIds][0]!;
        history.snapshot();
        store.mutate(() => {
          for (let i = track.curves.length - 1; i >= 0; i--) {
            if (consumedIds.has(track.curves[i]!.id)) track.curves.splice(i, 1);
          }
          track.curves.push(merged);
        });
        store.setSelectedCurve(merged.id);
        store.setSelectedPoint(null);
        interaction.transformBox = null;
      },
    },

    'edit.group': {
      enabled() {
        const sel = selectedCurves();
        return !!sel && sel.curves.length >= 2 && !allShareGroup(sel.curves);
      },
      run() {
        const sel = selectedCurves();
        if (!sel || sel.curves.length < 2 || allShareGroup(sel.curves)) return;
        history.snapshot();
        store.mutate(() => { assignGroup(sel.curves); });
        rebuildTransformBox(interaction, sel.track);
      },
    },

    'edit.ungroup': {
      enabled() {
        const sel = selectedCurves();
        return !!sel && anyGrouped(sel.curves);
      },
      run() {
        const sel = selectedCurves();
        if (!sel || !anyGrouped(sel.curves)) return;
        // Every member of every selected curve's group is dissolved.
        const groupIds = new Set(sel.curves.map(c => c.groupId).filter((g): g is string => !!g));
        const members = sel.track.curves.filter(c => c.groupId && groupIds.has(c.groupId));
        if (members.length === 0) return;
        history.snapshot();
        store.mutate(() => { dissolveGroup(members); });
        rebuildTransformBox(interaction, sel.track);
      },
    },

    // Move by an interval (13.24): the same as the transform box's arrows.
    'edit.moveUp': { enabled: canMove, run: () => { moveSelectionByInterval(interaction, 1); } },
    'edit.moveDown': { enabled: canMove, run: () => { moveSelectionByInterval(interaction, -1); } },
    'edit.copyUp': { enabled: canCopyMove, run: () => { moveSelectionByInterval(interaction, 1, true); } },
    'edit.copyDown': { enabled: canCopyMove, run: () => { moveSelectionByInterval(interaction, -1, true); } },

    // Guide tracks (13.10). Both are one undo step.
    'edit.sendToGuides': {
      enabled: canSendToGuides,
      run() {
        history.snapshot();
        store.sendCurvesToGuideTrack([...store.getState().selectedCurveIds]);
        interaction.transformBox = null;
      },
    },
    'edit.copyToGuides': {
      enabled: canSendToGuides,
      run() {
        // Selects the copies, and takes the undo snapshot.
        const copies = duplicateCurves({ inPlace: true });
        if (copies) store.sendCurvesToGuideTrack(copies);
        interaction.transformBox = null;
      },
    },

    'edit.smooth': {
      enabled: hasSelection,
      run() {
        const sel = selectedCurves();
        if (!sel || sel.curves.length === 0) return;
        history.snapshot();
        store.mutate(() => {
          const ratio = store.getState().autoSmoothXRatio;
          for (const curve of sel.curves) smoothCurveHandles(curve, ratio);
        });
      },
    },

    'edit.sharpen': {
      enabled: hasSelection,
      run() {
        const sel = selectedCurves();
        if (!sel || sel.curves.length === 0) return;
        history.snapshot();
        store.mutate(() => {
          for (const curve of sel.curves) sharpenCurveHandles(curve);
        });
      },
    },

    // 13.11: refit at the Accuracy. Selected points: the span from the first
    // to the last on each curve; otherwise whole curves.
    'edit.simplify': {
      enabled: () => !ctx.isPerformLocked() && (hasSelection() || pointCount(store.getState().selectedPoints) > 0),
      run() {
        const st = store.getState();
        const byId = new Map(st.composition.tracks.flatMap(t => t.curves).map(c => [c.id, c]));
        const jobs: { curve: BezierCurve; span?: { first: number; last: number } }[] = [];
        if (pointCount(st.selectedPoints) > 0) {
          for (const [id, indices] of st.selectedPoints) {
            const curve = byId.get(id);
            if (!curve || indices.size < 2) continue;
            jobs.push({ curve, span: { first: Math.min(...indices), last: Math.max(...indices) } });
          }
        } else {
          for (const curve of selectedCurves()?.curves ?? []) jobs.push({ curve });
        }
        if (jobs.length === 0) {
          showToast('Select curves, or at least two points on a curve');
          return;
        }
        history.snapshot();
        let changed = false;
        store.mutate(() => {
          for (const { curve, span } of jobs) {
            if (simplifyCurve(curve, st.recordAccuracy, span)) changed = true;
          }
        });
        if (!changed) {
          history.dropLastSnapshot();
          showToast(`Already as simple as ${st.recordAccuracy}¢ allows`);
          return;
        }
        // Point indices moved; keep the curves selected instead.
        if (pointCount(st.selectedPoints) > 0) store.setSelectedPoints(NO_POINTS);
        interaction.transformBox = null;
        const track = activeTrack();
        if (track) rebuildTransformBox(interaction, track);
      },
    },
  };
}
