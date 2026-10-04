import { markBgDirty } from '../app/redraw';
import { isFingerVoice } from '../canvas/fingers';
import { store } from '../state/store';
import { history } from '../state/history';
import { pitchPoints } from '../model/curve';
import { createGroupId } from '../model/curve-groups';
import { showToast } from '../ui/toast';
import { canOpenLayer, createLayerTrack, newestLayerTrack, LAYER_TRACK_LIMIT } from '../model/layer';
import { findDroppablePass, dropPassCurves, type CommittedPass } from '../model/pass-log';
import { parseHarmonyIndex } from './voices';
import type { PerformanceEngine } from '../canvas/performance-engine';

/**
 * Committing what was performed (split out of main.ts in 15.3): layers, one
 * per loop pass (10.3); the pass log behind Drop last pass (10.4); and Keep,
 * retrospective capture of the last hand (10.2, 13.33).
 */
export function createCapture(deps: { engine: PerformanceEngine }) {
  const composeEngine = deps.engine;

  // ── Layer-per-pass looping (BACKLOG 10.3) ──────────────────────
  /** Track the current pass is committing onto while Layer mode is on. Runtime
   *  only. Cleared at every loop wrap, which is what makes "one pass = one
   *  layer" true, and on session start/stop. */
  let currentLayerTrackId: string | null = null;
  /** One-shot so the track-cap toast doesn't fire on every commit. */
  let layerCapToastShown = false;

  /** Reset per-session layer state. Called when a session starts rolling and on stop. */
  function resetLayerSession() {
    currentLayerTrackId = null;
    layerCapToastShown = false;
  }

  /**
   * Where should this pass's curves land? With Layer mode off, the source track,
   * exactly as before. With it on, the layer this pass belongs to — opened lazily
   * on the first commit after a loop wrap, so a pass where nothing was played
   * leaves no empty track behind.
   *
   * Mutates `comp` when it opens a layer, so it must be called inside store.mutate.
   */
  function resolveCommitTrack(
    source: import('../types').Track,
    comp: import('../types').Composition,
  ): { track: import('../types').Track; createdTrack: boolean } {
    if (!store.getState().layerModeEnabled) return { track: source, createdTrack: false };

    if (currentLayerTrackId !== null) {
      const existing = comp.tracks.find(t => t.id === currentLayerTrackId);
      if (existing) return { track: existing, createdTrack: false };
      currentLayerTrackId = null;   // layer was deleted (e.g. dropped) — open a new one
    }

    if (!canOpenLayer(comp.tracks)) {
      // At the ceiling: keep performing into the newest layer rather than
      // silently dropping the pass or exceeding the export-safe track count.
      if (!layerCapToastShown) {
        showToast(`Layer limit reached (${LAYER_TRACK_LIMIT} tracks) — adding to the last layer`, 3500);
        layerCapToastShown = true;
      }
      const newest = newestLayerTrack(comp.tracks);
      return { track: newest ?? source, createdTrack: false };
    }

    const layer = createLayerTrack(source, comp.tracks);
    comp.tracks.push(layer);
    currentLayerTrackId = layer.id;
    return { track: layer, createdTrack: true };
  }

  /** Log of performed passes, newest last. Append-only — see pass-log.ts for why
   *  droppability is derived rather than tracked. */
  const passLog: CommittedPass[] = [];

  /** Push finalized curves onto a track, stamping a chord-cluster group when the
   *  gesture had multiple voices. Shared by the armed-release path and
   *  retrospective keep so both commit identically — and therefore the one place
   *  layer routing (10.3) and pass registration (10.4) need to hook. */
  /** Takes that make a Prism chord: harmony voices among them. */
  function isPrismChord(finalized: ReadonlyArray<{ voiceId: string }>): boolean {
    return finalized.some(f => parseHarmonyIndex(f.voiceId) !== null);
  }

  function commitFinalizedCurves(
    finalized: Array<{ voiceId: string; curve: import('../types').BezierCurve }>,
    source: import('../types').Track,
  ) {
    // Only a Prism chord is grouped. Fingers (13.33) can't be told apart, so
    // their takes stay separate, and so do a hand's several primary takes.
    const groupId = isPrismChord(finalized) ? createGroupId() : null;
    store.mutate((comp) => {
      // Resolved inside the mutation so opening a layer shares the caller's
      // history snapshot: creating the track and filling it are one undo step.
      const { track, createdTrack } = resolveCommitTrack(source, comp);
      let voiceIndex = 0;
      for (let i = 0; i < finalized.length; i++) {
        const { curve, voiceId } = finalized[i]!;
        if (groupId && !isFingerVoice(voiceId)) {
          curve.groupId = groupId;
          curve.voiceIndex = voiceIndex++;
        }
        track.curves.push(curve);
        store.setPerformCurrentCurve(voiceId, curve.id);
      }
      passLog.push({
        trackId: track.id,
        curveIds: finalized.map(f => f.curve.id),
        createdTrack,
      });
    });
  }

  /**
   * Drop the most recent performed pass (BACKLOG 10.4) — the live-looper's "undo
   * last layer". A forward, undoable delete rather than a history rewind: the
   * undo stack is linear whole-composition snapshots, so once you have edited
   * after performing, no rewind can remove just that pass. Ctrl+Z restores what
   * this drops, which is the looper's "redo layer".
   */
  function dropLastPass() {
    const comp = store.getComposition();
    const droppable = findDroppablePass(passLog, comp);
    if (!droppable) {
      showToast('No performed pass to drop', 2000);
      return;
    }

    history.snapshot();
    let removedTrackName: string | null = null;
    let curvesRemoved = 0;
    let trackToRemove: string | null = null;
    store.mutate((c) => {
      const result = dropPassCurves(c, droppable.pass, droppable.surviving);
      if (!result) return;
      curvesRemoved = result.curvesRemoved;
      if (result.shouldRemoveTrack) {
        trackToRemove = result.track.id;
        removedTrackName = result.track.name;
      }
    });
    // Track removal is a separate store call: it sweeps selection, MIDI arm,
    // projection source and planchettes, which doesn't belong inside a mutate.
    if (trackToRemove !== null) {
      if (currentLayerTrackId === trackToRemove) currentLayerTrackId = null;
      store.removeTrack(trackToRemove);
    }

    showToast(
      removedTrackName !== null
        ? `Dropped ${removedTrackName}`
        : `Dropped last pass (${curvesRemoved} curve${curvesRemoved === 1 ? '' : 's'})`,
      2000,
    );
    markBgDirty();
  }

  /**
   * Retrospective capture (BACKLOG 10.2): commit the newest *closed* uncommitted
   * phrase into a curve, after the fact. Pressing repeatedly walks backward
   * through the rolling buffer, since each keep marks its phrase committed.
   * Multi-voice gestures (Prism clusters) commit as one group.
   */
  function keepLastPhrase() {
    const st = store.getState();
    const trackId = st.selectedTrackId;
    const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
    if (!track) {
      showToast('Select a track to keep onto', 2500);
      return;
    }
    if (composeEngine.getKeepablePhraseCount() === 0) {
      showToast('Nothing to keep', 2000);
      return;
    }

    // Build curves BEFORE snapshotting: curveFromRecording produces detached
    // curves without touching the composition, so if every candidate turns out
    // too short to fit we bail without having pushed a bogus undo entry.
    // Keep the whole last hand: every take that sounded together with the newest
    // (13.33), so a chord cluster played as one gesture commits as one group and
    // a multitouch hand commits all its fingers. MIDI voices are excluded — they
    // belong to the MIDI-armed track and commit on noteOff.
    const finalized = composeEngine.keepHand(v => !v.startsWith('midi-'));
    if (finalized.length === 0) {
      showToast('Nothing to keep', 2000);
      return;
    }

    // Snapshot once per keep — each kept pass is exactly one undo entry
    // (the 10.4 decision). The engine's once-per-session debounce used by the
    // armed path deliberately doesn't apply here, or repeat keeps would collapse
    // into a single undo step.
    history.snapshot();
    commitFinalizedCurves(finalized, track);
    const beats = curveDurationBeats(finalized[0]!.curve);
    showToast(
      finalized.length === 1 ? `Kept phrase (${beats.toFixed(1)} beats)`
        : isPrismChord(finalized) ? `Kept ${finalized.length}-voice phrase (${beats.toFixed(1)} beats)`
        : `Kept ${finalized.length} phrases`,
      2000,
    );
    markBgDirty();
  }

  /** Duration of a curve's pitch lane in beats — for the keep confirmation toast. */
  function curveDurationBeats(curve: import('../types').BezierCurve): number {
    const pts = pitchPoints(curve);
    if (pts.length < 2) return 0;
    return pts[pts.length - 1]!.position.x - pts[0]!.position.x;
  }

  return {
    passLog,
    resetLayerSession,
    /** A loop wrap: the next commit opens a new layer. */
    closeLayer() { currentLayerTrackId = null; },
    /** A track is being deleted: if it was the current layer, the next pass opens a new one. */
    forgetTrack(trackId: string) { if (currentLayerTrackId === trackId) currentLayerTrackId = null; },
    commitFinalizedCurves,
    dropLastPass,
    keepLastPhrase,
  };
}

export type Capture = ReturnType<typeof createCapture>;
