import { JAM_IDLE_TIMEOUT_MS, KEEP_BUFFER_MS, MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';
import type { SnapConfig } from '../utils/snap';
import { markBgDirty } from '../app/redraw';
import { RULER_HEIGHT } from '../canvas/interaction';
import { createMagneticState, resetMagnetic, type MagneticState } from '../utils/snap-magnetic';
import { allocateFingerVoice, edgeScrollStep, isFingerVoice } from '../canvas/fingers';
import { store } from '../state/store';
import { history } from '../state/history';
import { getCompositionLength } from '../model/composition';
import { noteRootAt, prismOffsets, prismOffsetsAt } from '../tuning/tuning';
import { createPerformanceEngine } from '../canvas/performance-engine';
import { getAudioContext } from '../audio/engine';
import type { AppState, PlanchetteState, VoiceId } from '../types';
import { type TransportEvent, isRolling, isRecordArmed, isCapturing, isOpenEnded, performPhase } from '../state/transport';
import { createGravity } from './gravity';
import { createCapture } from './capture';
import { harmonyVoiceId, parseHarmonyIndex } from './voices';
import type { Viewport } from '../canvas/viewport';
import type { PreviewManager } from '../audio/preview';
import type { DynamicsBus } from '../audio/dynamics-bus';
import type { PlaybackEngine } from '../audio/playback';

export interface PerformerDeps {
  viewport: Viewport;
  fgCanvas: HTMLCanvasElement;
  preview: PreviewManager;
  dynamics: DynamicsBus;
  playback: PlaybackEngine;
  /** MIDI notes held now, armed or not: the swell shapes them too. */
  heldMidiNotes: ReadonlySet<number>;
  /** The beat under the rail. */
  railBeat(): number;
  /** Lowest offsetX the view may pan to (negative in the rail view). */
  minPanOffsetX(canvasWidth: number): number;
  isComposePerformActive(): boolean;
  /** The transport controller (main.ts): count-in, loop wrap, idle stop. */
  transport(event: TransportEvent): void;
}

/**
 * Live performance (split out of main.ts in 15.3): the sounding voice under
 * the left button or a finger, its Prism harmonies, extra fingers (13.33),
 * MIDI note voices' commits, capture into the rolling buffer each frame, edge
 * scrolling, and the per-frame perform tick (count-in, loop wrap, idle stop).
 */
export function createPerformer(deps: PerformerDeps) {
  const {
    viewport, fgCanvas, preview, dynamics, playback, heldMidiNotes,
    railBeat, minPanOffsetX, isComposePerformActive, transport,
  } = deps;

  // ── Compose Perform: LMB sounding + record + planchette-for-HUD ─────
  const COMPOSE_COUNTDOWN_SECONDS = 3;
  const composeEngine = createPerformanceEngine({
    countdownSeconds: COMPOSE_COUNTDOWN_SECONDS,
    afkTimeoutMs: 60_000,
    recordingBufferMax: 3600,
    loopWrapThresholdBeats: 0.5,
    keepBufferMs: KEEP_BUFFER_MS,
    recordingFit: () => {
      const st = store.getState();
      return { accuracyCents: st.recordAccuracy, legacy: st.recordFitLegacy };
    },
  });

  const gravity = createGravity({ viewport, railBeat, isComposePerformActive });
  const { magneticState, computeComposeCursorPitch, hapticFollow } = gravity;
  const capture = createCapture({ engine: composeEngine });
  const { commitFinalizedCurves } = capture;

  /** Last known compose-mode cursor screen Y. Cached so the per-frame pitch-mode
   *  tick can keep advancing the planchette pitch even when the mouse isn't moving. */
  let lastComposeSy: number | null = null;

  /** Previous snap target. Used to trigger the snap-line-cross pulse on target
   *  changes rather than on every frame while magnetic physics is interpolating. */
  let prevSnapTarget: number | null = null;

  function composeUpdatePlanchette(sy: number) {
    lastComposeSy = sy;
    if (sy < RULER_HEIGHT && !composeEngine.isLmbDown()) {
      clearPlanchettePitches();
      return;
    }
    const { cursorWorldY, snappedWorldY, snapTarget, snapConfig } = computeComposeCursorPitch(sy);
    store.setPlanchetteY('primary', cursorWorldY, snappedWorldY);
    hapticInput = { wy: cursorWorldY, config: snapConfig };
    hapticCheck();
    // Snap-line-cross pulse — fire only when crossing between two real targets.
    // Skip when either side is null (no attractor in None-mode between-guides
    // zones) so the flash doesn't fire on every frame.
    if (prevSnapTarget != null && snapTarget != null && prevSnapTarget !== snapTarget) {
      store.markPlanchetteCrossed('primary', Date.now());
    }
    prevSnapTarget = snapTarget;
    // Drive harmony voices off the primary's snapped Y. No-op outside Prism Draw
    // perform (no harmony planchettes exist) so cheap to call unconditionally.
    updateHarmonyVoices(snappedWorldY);
  }

  /** The finger's (cursor's) latest pitch and the lines around it, and the line
   *  it's on, for haptic clicks (13.35). */
  let hapticInput: { wy: number; config: SnapConfig } | null = null;
  let hapticLine: number | null = null;

  /** A haptic click when the finger comes onto a line while performing (13.35;
   *  see hapticStep): the raw cursor, not the planchette, so it marks where the
   *  lines are under the finger whatever Gravity is doing. The lines are the
   *  ones that would snap, with Snap on or off. Does nothing on a device that
   *  can't vibrate. */
  function hapticCheck() {
    if (!hapticInput || !composeEngine.isLmbDown() || !store.getState().hapticClicks) {
      hapticLine = null;
      return;
    }
    hapticLine = hapticFollow(hapticInput.wy, hapticInput.config, hapticLine);
  }

  /** The cursor left the pitch area: the mouse's planchettes have no pitch
   *  until it's back. Prism harmonies are offsets of the primary, so they clear
   *  with it — before 16.2's stopped-Perform audition they only existed during
   *  playback, and a harmony left behind here stayed frozen on the rail. MIDI
   *  planchettes follow held keys, not the mouse, and are left alone. */
  function clearPlanchettePitches() {
    for (const p of store.getState().performance.planchettes) {
      if (p.voiceId === 'primary' || p.voiceId.startsWith('harmony-')) store.setPlanchetteY(p.voiceId, null, null);
    }
    resetMagnetic(magneticState);
    prevSnapTarget = null;
    lastComposeSy = null;
  }

  /**
   * Per note (13.21): the degree the performed note's chord counts from, taken
   * where the note starts and held through its glide, so harmony voices never
   * jump mid-note. Null between notes, when the chord follows the cursor's
   * note. The degree is held rather than the offsets, so a chord-spec change
   * mid-note still applies at once.
   */
  let heldNoteRoot: number | null = null;

  /** The Prism chord's offsets for a base pitch: the held note's chord while a
   *  note sounds, else the chord on `base` (the root's without one). */
  function chordOffsetsFor(base: number | null): number[] {
    const st = store.getState();
    const spec = st.harmonicPrism.chordSpec;
    if (heldNoteRoot !== null) return prismOffsets(spec, st, heldNoteRoot);
    return base === null ? prismOffsets(spec, st) : prismOffsetsAt(spec, st, base);
  }

  /** Re-tune all currently-active harmony voices' pitch and synth from the primary's
   *  snapped Y. Called every cursor-update tick during Prism-Draw perform. */
  function updateHarmonyVoices(snappedBaseY: number) {
    const st = store.getState();
    const planchettes = st.performance.planchettes;
    if (planchettes.length <= 1) return; // only primary present — no harmonies active
    const offsets = chordOffsetsFor(snappedBaseY);
    for (let i = 1; i < offsets.length; i++) {
      const voiceId = harmonyVoiceId(i - 1);
      const planchette = planchettes.find(p => p.voiceId === voiceId);
      if (!planchette) continue; // harmony index disabled this gesture (e.g. spec changed numVoices)
      const harmonyY = snappedBaseY + offsets[i]!;
      const inRange = harmonyY >= MIN_PITCH_CENTS && harmonyY <= MAX_PITCH_CENTS;
      // cursorWorldY mirrors snapped (harmonies never have an independent raw
      // cursor — they're math offsets), so the rail render skips the ghost dot.
      store.setPlanchetteY(voiceId, inRange ? harmonyY : null, inRange ? harmonyY : null);
      if (inRange && preview.isDrawPreviewActive(voiceId)) {
        preview.updateDrawPitch(harmonyY, voiceId);
      }
    }
  }

  /** Per-frame pitch-mode tick: re-runs composeUpdatePlanchette with the last
   *  known cursor Y so Magnetic physics keeps advancing even when the mouse is
   *  still. Also updates the currently-sounding synth so the audible pitch
   *  matches. No-op when Magnetic is off. */
  function tickComposePitchMode() {
    const st = store.getState();
    if (!st.snapEnabled || !st.magneticEnabled) return;
    for (const f of fingers.values()) updateFinger(f);
    if (lastComposeSy === null) return;
    composeUpdatePlanchette(lastComposeSy);
    if (composeEngine.isLmbDown()) {
      const p = store.getState().performance.planchettes[0];
      if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
    }
  }

  // ── Y auto-scroll during Perform / Record ──────────────────────
  // When LMB is held (perform / record), if the cursor approaches the top or
  // bottom of the canvas, pan the viewport Y so the user can drag past the
  // current visible pitch range without releasing. Pan rate scales with how
  // close the cursor is to the edge.
  const PERFORM_Y_EDGE_PX = 30;            // distance from edge that triggers scroll
  const PERFORM_Y_PAN_PX_PER_FRAME = 4;    // peak scroll speed (at the very edge / off-canvas)

  function tickPerformYAutoScroll() {
    // Every finger down counts (13.33): the one nearest an edge sets the speed,
    // and fingers at both edges cancel out. Near the top reveals higher pitches
    // (pan world up = increase offsetY); near the bottom, or off-canvas below,
    // lower ones.
    const primaryHeld = composeEngine.isLmbDown() && lastComposeSy !== null;
    const ys = [...fingers.values()].map(f => f.sy);
    if (primaryHeld) ys.push(lastComposeSy!);
    if (ys.length === 0) return;
    const rect = fgCanvas.getBoundingClientRect();
    const dsy = edgeScrollStep(ys, RULER_HEIGHT, rect.height, PERFORM_Y_EDGE_PX, PERFORM_Y_PAN_PX_PER_FRAME);
    if (dsy === 0) return;
    const beforeOffsetY = viewport.state.offsetY;
    viewport.panBy(0, dsy);
    viewport.clampOffset(rect.width, rect.height, minPanOffsetX(rect.width));
    // If clampOffset rejected the pan (already at the Y bound), stop here so we
    // don't waste work re-evaluating the planchette / synth pitch.
    if (viewport.state.offsetY === beforeOffsetY) return;
    markBgDirty();
    // The world Y under the (unchanged screen) fingers has shifted — re-snap and
    // re-tune every held note, so they glide with the view.
    for (const f of fingers.values()) updateFinger(f);
    if (!primaryHeld) return;
    composeUpdatePlanchette(lastComposeSy!);
    const p = store.getState().performance.planchettes[0];
    if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
  }

  function getSelectedTrackTone() {
    const st = store.getState();
    const trackId = st.selectedTrackId;
    if (!trackId) return null;
    const track = st.composition.tracks.find(t => t.id === trackId);
    if (!track) return null;
    return st.composition.toneLibrary.find(t => t.id === track.toneId) ?? null;
  }

  function startComposePerformSounding(snappedBaseY: number) {
    const tone = getSelectedTrackTone();
    if (!tone) return;
    // The planchette array is already populated by syncHarmonyPlanchettes
    // (which runs every frame and tracks drawMode + playback/record state).
    // Just spin up a synth for each currently-active voice.
    const st = store.getState();
    // The note's chord is fixed where it starts (Per note, 13.21).
    heldNoteRoot = noteRootAt(st, snappedBaseY);
    const offsets = chordOffsetsFor(snappedBaseY);
    for (const p of st.performance.planchettes) {
      const y = voiceYFromBase(p.voiceId, snappedBaseY, offsets);
      if (y == null) continue;
      // Start at the bus's current value so the note doesn't jump on the first
      // frame. Under the `fixed` source this is exactly the old preview level.
      preview.startDrawPreview(tone, y, p.voiceId, dynamics.getValue(p.voiceId));
    }
    store.setPerformLmbSounding(true);
  }
  function updateComposePerformPitch(snappedBaseY: number) {
    // Primary's pitch update; harmony pitch updates are driven by
    // composeUpdatePlanchette → updateHarmonyVoices.
    if (preview.isDrawPreviewActive('primary')) {
      preview.updateDrawPitch(snappedBaseY + primaryChordOffset(snappedBaseY), 'primary');
    }
  }

  /**
   * Where the primary voice sits relative to the cursor's pitch while a Prism
   * chord plays: chord voice 0's offset. It isn't always 0 — a symmetric chord
   * centres on the cursor (its lowest voice sits below it), and a root octave
   * offset (8.13) moves voice 0 too. Draw always applied it; the perform and
   * audition paths assumed 0, so a symmetric triad played its middle voice
   * twice and never its lowest.
   *
   * The primary planchette itself keeps the cursor's pitch — magnetic physics,
   * the snap pulse and the Pitch HUD follow the cursor — so everything that
   * sounds, records or draws the primary voice adds this. 0 with Prism Draw off.
   */
  function primaryChordOffset(base: number | null): number {
    return store.getState().harmonicPrism.drawMode ? (chordOffsetsFor(base)[0] ?? 0) : 0;
  }

  /** The planchettes at the pitches they sound: the primary moved by
   *  primaryChordOffset(), the rest as stored. For capture and the rail. */
  function planchettesAsSounding(planchettes: PlanchetteState[]): PlanchetteState[] {
    const off = primaryChordOffset(planchettes.find(p => p.voiceId === 'primary')?.snappedWorldY ?? null);
    if (off === 0) return planchettes;
    const shift = (y: number | null) => (y == null ? null : y + off);
    return planchettes.map(p => (p.voiceId === 'primary'
      ? { ...p, cursorWorldY: shift(p.cursorWorldY), snappedWorldY: shift(p.snappedWorldY) }
      : p));
  }
  function stopComposePerformSounding() {
    // Stop every active synth (primary + any harmonies). Planchette removal is
    // handled by syncHarmonyPlanchettes when playback ends or drawMode toggles
    // off; leaving the planchettes in place during continuing playback gives
    // the user persistent chord-shape feedback even between LMB presses.
    // Only the button's own voices: extra fingers (13.33) and held MIDI notes
    // play on until they're lifted.
    for (const voiceId of lmbVoiceIds()) preview.stopDrawPreview(voiceId);
    store.setPerformLmbSounding(false);
    heldNoteRoot = null;
  }

  /** Compute the world Y a voice should sit at, given the primary's snapped Y
   *  and the current chord-spec offsets. Returns null if voice is out of range
   *  or if the spec doesn't include a slot for this voiceId. */
  function voiceYFromBase(voiceId: string, snappedBaseY: number, offsets: readonly number[]): number | null {
    let y: number;
    if (voiceId === 'primary') {
      y = snappedBaseY + primaryChordOffset(snappedBaseY);
    } else {
      const harmonyIdx = parseHarmonyIndex(voiceId);
      if (harmonyIdx == null) return null;
      const offsetIdx = harmonyIdx + 1;
      if (offsetIdx >= offsets.length) return null;
      y = snappedBaseY + offsets[offsetIdx]!;
    }
    if (y < MIN_PITCH_CENTS || y > MAX_PITCH_CENTS) return null;
    return y;
  }

  /** Reconcile the planchette array with current Prism Draw + playback/record
   *  state. Called every render frame; cheap when state already matches.
   *  Only touches Harmonic Prism harmony voices ('harmony-*'); MIDI input
   *  planchettes ('midi-*') have their own lifecycle (noteOn / noteOff) and
   *  must not be reaped here. */
  function syncHarmonyPlanchettes() {
    const st = store.getState();
    const wantHarmonies = st.harmonicPrism.drawMode &&
      (st.performMode || playback.isPlaying() || isRecordArmed(st.transport));

    if (!wantHarmonies) {
      for (const p of st.performance.planchettes) {
        if (p.voiceId.startsWith('harmony-')) preview.stopDrawPreview(p.voiceId);
      }
      store.removeHarmonyPlanchettes();
      return;
    }

    const primary = st.performance.planchettes.find(pp => pp.voiceId === 'primary');
    const offsets = chordOffsetsFor(primary?.snappedWorldY ?? null);
    const desiredHarmonyIds = new Set<string>();
    for (let i = 1; i < offsets.length; i++) desiredHarmonyIds.add(harmonyVoiceId(i - 1));

    // Remove harmony voices no longer in spec (numVoices reduced).
    const toRemove: string[] = [];
    for (const p of st.performance.planchettes) {
      if (!p.voiceId.startsWith('harmony-')) continue;
      if (!desiredHarmonyIds.has(p.voiceId)) toRemove.push(p.voiceId);
    }
    for (const voiceId of toRemove) {
      preview.stopDrawPreview(voiceId);
      store.removePerformPlanchette(voiceId);
    }

    // Add voices not yet present (numVoices increased or first time entering).
    // Seed each new harmony's Y from the primary so the rail shows it immediately
    // (otherwise the planchette has null Y until the next mousemove tick).
    for (let i = 1; i < offsets.length; i++) {
      const voiceId = harmonyVoiceId(i - 1);
      if (st.performance.planchettes.some(p => p.voiceId === voiceId)) continue;
      let initialY: number | null = null;
      if (primary?.snappedWorldY != null) {
        const y = primary.snappedWorldY + offsets[i]!;
        if (y >= MIN_PITCH_CENTS && y <= MAX_PITCH_CENTS) initialY = y;
      }
      store.addPerformPlanchette({
        voiceId,
        trackId: st.selectedTrackId,
        cursorWorldY: initialY,
        snappedWorldY: initialY,
        lastCrossedAt: 0,
      });
      // If LMB is held when a new voice spawns (e.g. user just toggled drawMode
      // mid-perform), start its synth at the right pitch immediately.
      if (composeEngine.isLmbDown() && initialY != null) {
        const tone = getSelectedTrackTone();
        if (tone) preview.startDrawPreview(tone, initialY, voiceId, dynamics.getValue(voiceId));
      }
    }
  }

  // ── Prism idle preview (hold-A audition) ─────────────────────
  /** Start the idle audition as a Prism chord cluster when drawMode is
   *  on, otherwise a single voice. Mirrors the perform-time multi-voice setup
   *  but uses the audition path (no recording, no planchettes added —
   *  the active draw-mode preview dots already show the cursor cluster). */
  function startPrismDrawPreview(tone: import('../types').ToneDefinition, snappedBaseY: number) {
    preview.startDrawPreview(tone, snappedBaseY + primaryChordOffset(snappedBaseY), 'primary');
    const st = store.getState();
    if (!st.harmonicPrism.drawMode) return;
    const offsets = chordOffsetsFor(snappedBaseY);
    for (let i = 1; i < offsets.length; i++) {
      const voiceId = harmonyVoiceId(i - 1);
      const y = snappedBaseY + offsets[i]!;
      if (y < MIN_PITCH_CENTS || y > MAX_PITCH_CENTS) continue;
      preview.startDrawPreview(tone, y, voiceId);
    }
  }

  /** Re-tune all currently-active idle preview voices from the primary's Y. */
  function updatePrismDrawPreview(snappedBaseY: number) {
    preview.updateDrawPitch(snappedBaseY + primaryChordOffset(snappedBaseY), 'primary');
    const st = store.getState();
    if (!st.harmonicPrism.drawMode) return;
    const offsets = chordOffsetsFor(snappedBaseY);
    for (let i = 1; i < offsets.length; i++) {
      const voiceId = harmonyVoiceId(i - 1);
      if (!preview.isDrawPreviewActive(voiceId)) continue;
      const y = snappedBaseY + offsets[i]!;
      if (y >= MIN_PITCH_CENTS && y <= MAX_PITCH_CENTS) preview.updateDrawPitch(y, voiceId);
    }
  }

  function captureComposeRecordingSample() {
    const st = store.getState();
    const g = st.performance;
    // Capture runs whenever a voice is actually SOUNDING in a perform context —
    // not just while armed (BACKLOG 10.2). That is what fills the rolling buffer
    // during an un-armed Perform play so "keep that" has something to commit. isLmbDown()
    // can only be true inside isComposePerformActive(), so it already implies the
    // perform context and a running transport. Silent cursor movement is never
    // captured: "what was just played" means what was heard.
    // Since 16.2 the left button also sounds in Perform while stopped (an
    // audition); with no clock running there's nothing to place, so only a
    // rolling transport captures it.
    const lmbActive = composeEngine.isLmbDown() && isRolling(st.transport);
    // Any rolling transport captures an armed MIDI track — plain Play included,
    // which used to spawn the note planchettes but never record them (15.2).
    const midiActive = st.midiArmedTrackId !== null && isRolling(st.transport);
    // Extra fingers (13.33) have a planchette only while they're down.
    const fingersActive = fingers.size > 0 && isRolling(st.transport);
    if (!lmbActive && !midiActive && !fingersActive) return;
    const beat = playback.getPositionBeats();
    // Capture every active voice (primary + any chord-cluster harmonies + every
    // held MIDI note). The engine's captureSample is keyed by voiceId and already
    // supports N parallel buffers. Per-voice gating: LMB voices when LMB is the
    // active source; MIDI voices when MIDI input is the armed source. Both can
    // run in parallel, recording into independent voices.
    for (const p of planchettesAsSounding(g.planchettes)) {
      if (p.snappedWorldY == null) continue;
      const sourceActive = p.voiceId.startsWith('midi-') ? midiActive
        : isFingerVoice(p.voiceId) ? fingersActive : lmbActive;
      if (!sourceActive) continue;
      composeEngine.captureSample(p.voiceId, {
        beat,
        note: p.snappedWorldY,
        // The dynamics bus replaces what used to be a hardcoded 0.8 (BACKLOG
        // 11.1). Its `fixed` source still returns exactly that, so a take made
        // without a dynamics input records identically to before.
        volume: dynamics.getValue(p.voiceId),
      });
    }
  }

  /** Dynamics halo resolver for the planchette renderer: null while the bus is on
   *  its `fixed` source (draw as before the bus), and null for voices that aren't
   *  sounding (an idle planchette has no dynamics to show). */
  function planchetteDynamicsOf(voiceId: string): number | null {
    if (!dynamics.isDriven()) return null;
    if (!preview.isDrawPreviewActive(voiceId)) return null;
    return dynamics.getValue(voiceId);
  }

  /** Push the bus into every sounding voice, so what you hear tracks the swell.
   *  Runs each frame; `setVoiceVolume` no-ops for voices that aren't sounding and
   *  for values that haven't moved. */
  function applyDynamicsToSoundingVoices() {
    if (!dynamics.isDriven()) return;
    for (const p of store.getState().performance.planchettes) {
      preview.setVoiceVolume(p.voiceId, dynamics.getValue(p.voiceId));
    }
    // Held MIDI notes with no armed track have no planchette but are still
    // sounding — the swell should shape them too.
    for (const note of heldMidiNotes) {
      const voiceId = `midi-${note}`;
      preview.setVoiceVolume(voiceId, dynamics.getValue(voiceId));
    }
  }

  /** Finalize one MIDI voice's recording into the MIDI-armed track. Called on
   *  noteOff and on stop boundaries (composePerformStop, loop wrap, disarm).
   *  `keepPlanchette: true` is used by the loop-wrap path so the held key keeps
   *  capturing on the loop-in side under the same voiceId — matches LMB-held
   *  perform behaviour (see finalizeComposeRecordedCurves below). BACKLOG 8.21. */
  function finalizeMidiVoice(
    midiNote: number,
    opts: { keepPlanchette?: boolean } = {},
  ) {
    const voiceId = `midi-${midiNote}`;
    const st = store.getState();
    const planchettePresent = st.performance.planchettes.some(p => p.voiceId === voiceId);
    if (!planchettePresent) return;
    const trackId = st.midiArmedTrackId;
    const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
    // Seal the note's phrase before claiming it, so the buffer never carries an
    // open phrase for a voice that has stopped sounding.
    composeEngine.closePhrase(voiceId, performance.now());
    const curve = composeEngine.finalizeCurve(voiceId, () => history.snapshot());
    if (curve && track) {
      store.mutate(() => { track.curves.push(curve); });
    } else if (!track) {
      composeEngine.clearBuffer(voiceId);
    }
    if (!opts.keepPlanchette) {
      store.removePerformPlanchette(voiceId);
    }
    markBgDirty();
  }

  /** Finalize every in-flight MIDI voice. Used on stop boundaries (Stop button,
   *  ESC, AFK, loop wrap) and when un-arming MIDI mid-recording. */
  function finalizeAllInFlightMidiVoices(opts: { keepPlanchette?: boolean } = {}) {
    const notes: number[] = [];
    for (const p of store.getState().performance.planchettes) {
      if (!p.voiceId.startsWith('midi-')) continue;
      const n = Number(p.voiceId.slice('midi-'.length));
      if (Number.isFinite(n)) notes.push(n);
    }
    for (const n of notes) finalizeMidiVoice(n, opts);
  }

  function finalizeComposeRecordedCurves() {
    const st = store.getState();
    const trackId = st.selectedTrackId;
    const track = trackId ? st.composition.tracks.find(t => t.id === trackId) : null;
    // Voice ids the LMB session owns (primary + every active harmony). MIDI
    // voices ('midi-*') deliberately excluded — they live on the MIDI-armed
    // track, not the LMB-selected track, and have their own finalize path
    // (finalizeMidiVoice / finalizeAllInFlightMidiVoices). Without this filter
    // an LMB release that lands on the same beat as a MIDI noteOff would push
    // the MIDI curve onto the LMB track.
    const voiceIds = lmbVoiceIds();
    if (!track) {
      for (const v of voiceIds) composeEngine.clearBuffer(v);
      return;
    }
    // Finalize each voice's buffer. finalizeCurve handles the once-per-session
    // history snapshot — passing the same callback for every voice is safe
    // because the engine debounces it via sessionHistorySnapshotted.
    const finalized: Array<{ voiceId: string; curve: import('../types').BezierCurve }> = [];
    for (const voiceId of voiceIds) {
      const curve = composeEngine.finalizeCurve(voiceId, () => history.snapshot());
      if (curve) finalized.push({ voiceId, curve });
    }
    if (finalized.length === 0) return;

    // If multi-voice, stamp the finalized curves as a chord cluster so they
    // behave like a Phase-2 Draw-mode placement (group selection, group delete,
    // group transform). Single-voice (no harmonies) records ungrouped as today.
    commitFinalizedCurves(finalized, track);
  }

  /** Voice ids the LMB session owns (primary + harmonies), excluding MIDI voices
   *  and extra fingers (13.33), which each have their own finalize path. */
  function lmbVoiceIds(): string[] {
    return store.getState().performance.planchettes
      .map(p => p.voiceId)
      .filter(v => !v.startsWith('midi-') && !isFingerVoice(v));
  }

  /** Seal every LMB-owned phrase. Called on release, stop, and loop wrap — after
   *  this the phrase is committable by either the armed path or "keep that". */
  function closeLmbPhrases() {
    const now = performance.now();
    for (const voiceId of lmbVoiceIds()) composeEngine.closePhrase(voiceId, now);
  }

  function tickComposePerform() {
    const st = store.getState();
    const t = st.transport;
    // Treat MIDI-armed as record-armed for engine purposes (AFK gate) so the
    // player gets the same affordances when arming via MIDI alone.
    const anyArmed = isRecordArmed(t) || st.midiArmedTrackId !== null;
    const playbackBeat = playback.getPositionBeats();

    // Keep the AFK timer fresh while there's a meaningful reason to keep waiting:
    // (a) Loop is on (intentional record-over-loops), or (b) the playhead hasn't
    // crossed the rightmost control point yet (still future content to record over).
    // Refresh per tick so the user gets a full afkTimeoutMs window after the
    // suppressing condition lifts, instead of an immediate auto-stop.
    if (anyArmed && isRolling(t) && playback.isPlaying()) {
      const rightmost = getCompositionLength(st.composition);
      if (st.loopEnabled || playbackBeat < rightmost) {
        composeEngine.markActivity(performance.now());
      }
    }

    // Idle-window selection: armed recording keeps the short AFK timeout; an
    // un-armed open-ended play (Perform) gets the long timeout; anything else
    // never auto-stops.
    const idleTimeoutMs = anyArmed
      ? composeEngine.getAfkTimeoutMs()
      : (isOpenEnded(t) ? JAM_IDLE_TIMEOUT_MS : Infinity);

    composeEngine.tick({
      now: performance.now(),
      audioNow: getAudioContext().currentTime,
      isPlaying: playback.isPlaying(),
      phase: performPhase(t),
      idleTimeoutMs,
      countdownStartedAt: t.countdownStartedAt,
      playbackBeat,
      onCountdownElapsed: () => transport({ type: 'countdown-elapsed' }),
      onLoopWrap: () => {
        // Seal phrases at the seam so none ever spans the loop boundary — a
        // phrase containing the wrap would carry a backwards beat jump and
        // couldn't be fitted. Held voices resume into a fresh phrase on the
        // loop-in side (captureSample opens one on the next sample), so a
        // gesture across the seam keeps as two contiguous curves. This is the
        // un-armed mirror of the armed 8.21 behaviour below.
        closeLmbPhrases();
        if (isCapturing(store.getState().transport) && composeEngine.isLmbDown()) finalizeComposeRecordedCurves();
        // Each held extra finger (13.33) likewise, and keeps sounding.
        sealFingerTakes(isCapturing(store.getState().transport));
        // Loop wrap during sustained MIDI notes splits the curves at the wrap so
        // recordings don't cross the loop boundary as a single curve. Keep the
        // planchettes around so capture continues for still-held keys on the
        // loop-in side under the same voiceId — matches LMB-held perform
        // behaviour, which the surrounding finalizeComposeRecordedCurves call
        // already does. (BACKLOG 8.21)
        finalizeAllInFlightMidiVoices({ keepPlanchette: true });

        // Deliberate one-pass record (BACKLOG 10.5): a queued pass starts here,
        // a pass in progress ends here. After the commits above, so the
        // finishing pass's material is captured before capture stops.
        transport({ type: 'loop-wrap' });

        // One pass = one layer (BACKLOG 10.3): closing the layer here means the
        // next commit opens a fresh one. Deliberately AFTER the commits above —
        // resetting first would push a gesture held across the seam into the
        // NEXT pass's layer, and anything kept during that pass would join it.
        capture.closeLayer();
        // And one undo step per layer: Ctrl+Z steps back a pass at a time
        // instead of taking every layer the recording made.
        if (store.getState().layerModeEnabled) composeEngine.newUndoStep();
      },
      onAfkTimeout: () => transport({ type: 'stop' }),
    });
  }

  /** Live performance's share of canvas pointer input. */
  // ── Prism Draw with several fingers (13.33, decided 2026-10-04) ──────
  // The chord plays on the newest finger down. Older fingers stay held but
  // silent; when the newest lifts, the chord goes back to the newest one still
  // down, like a monosynth playing legato. It glides there without restarting
  // (a recording stays one take), re-rooted at the finger's note: each finger
  // is a new note for the Prism's per-note chord (13.21).

  /** Fingers holding the chord, oldest first; the last one plays it. Outside
   *  Prism Draw it's just the press's own pointer. */
  let chordFingers: Array<{ pointerId: number; sy: number }> = [];

  function screenY(e: PointerEvent): number {
    return e.clientY - fgCanvas.getBoundingClientRect().top;
  }

  function isChordHolder(pointerId: number): boolean {
    return chordFingers.length > 0 && chordFingers[chordFingers.length - 1]!.pointerId === pointerId;
  }

  /** Note where a chord finger is. True when another finger plays the chord,
   *  so this move goes no further. */
  function heldSilently(pointerId: number, sy: number): boolean {
    const c = chordFingers.find(f => f.pointerId === pointerId);
    if (!c) return false;
    c.sy = sy;
    return !isChordHolder(pointerId);
  }

  /** Follow the finger playing the chord to `sy`. */
  function moveChord(sy: number) {
    composeUpdatePlanchette(sy);
    composeEngine.markActivity(performance.now());
    const p = store.getState().performance.planchettes[0];
    if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
  }

  /** Hand the chord to a finger at `sy`: re-rooted at its note, gliding there. */
  function handChordTo(sy: number) {
    heldNoteRoot = noteRootAt(store.getState(), viewport.screenToWorld(0, sy).wy);
    moveChord(sy);
  }

  /** A newer finger takes the chord. */
  function takeChord(e: PointerEvent) {
    const sy = screenY(e);
    chordFingers.push({ pointerId: e.pointerId, sy });
    handChordTo(sy);
  }

  /** A chord finger lifted. True while others still hold the chord (it goes
   *  back to the newest of them if this one was playing it); false when this
   *  was the last, so the note ends. */
  function liftChordFinger(pointerId: number): boolean {
    const i = chordFingers.findIndex(f => f.pointerId === pointerId);
    if (i < 0) return false;
    const wasPlaying = i === chordFingers.length - 1;
    chordFingers.splice(i, 1);
    if (chordFingers.length === 0) return false;
    if (wasPlaying) handChordTo(chordFingers[chordFingers.length - 1]!.sy);
    return true;
  }

  /** The button (or the last chord finger) let go: end the note. */
  function releasePress() {
    chordFingers = [];
    // A session that ended while the button was held has already released it.
    if (!composeEngine.isLmbDown()) return;
    composeEngine.onLmbUp();
    fingerOrder = fingerOrder.filter(v => v !== 'primary');
    // CRITICAL ORDERING: finalize BEFORE stopping synths so the planchette array
    // (and therefore the voiceIds we finalize) still contains every active voice.
    // syncHarmonyPlanchettes only removes harmonies when playback ends or drawMode
    // toggles off, neither of which happens at LMB-up — so the array is stable here.
    // Close first: the phrase must be sealed before either path claims it.
    closeLmbPhrases();
    if (isCapturing(store.getState().transport)) {
      finalizeComposeRecordedCurves();
    }
    // Un-armed perform no longer discards the buffer — the closed phrase stays
    // keepable for KEEP_BUFFER_MS so retrospective capture can commit it
    // after the fact (BACKLOG 10.2). Eviction ages it out.
    stopComposePerformSounding();
  }

  const performInput = {
    /** Every move, in every mode: the rail planchette and pitch HUD follow the
     *  cursor, and an un-armed Perform play counts cursor movement as presence for its
     *  idle auto-stop. */
    track(e: PointerEvent) {
      const sy = screenY(e);
      if (heldSilently(e.pointerId, sy)) return;
      composeUpdatePlanchette(sy);
      if (isComposePerformActive()) composeEngine.markActivity(performance.now());
    },
    down(e: PointerEvent) {
      // The first finger lifted while others hold the chord: a new touch is
      // the newest finger, so it takes the chord rather than restarting it.
      if (composeEngine.isLmbDown() && chordFingers.length > 0) {
        takeChord(e);
        return;
      }
      chordFingers = [{ pointerId: e.pointerId, sy: screenY(e) }];
      composeUpdatePlanchette(screenY(e));
      composeEngine.onLmbDown(performance.now());
      fingerOrder = [...fingerOrder.filter(v => v !== 'primary'), 'primary'];
      // Touching down on a line clicks too (13.35).
      hapticCheck();
      const planchette = store.getState().performance.planchettes[0];
      if (planchette?.snappedWorldY != null) {
        startComposePerformSounding(planchette.snappedWorldY);
      }
    },
    move(e: PointerEvent) {
      // track() already moved the planchette; retune the sounding voice to it.
      // Moves arrive off-canvas too while the button is held (pointer capture).
      composeEngine.markActivity(performance.now());
      if (!isChordHolder(e.pointerId)) return;
      const p = store.getState().performance.planchettes[0];
      if (p?.snappedWorldY != null) updateComposePerformPitch(p.snappedWorldY);
    },
    up(e: PointerEvent) {
      if (liftChordFinger(e.pointerId)) return;
      releasePress();
    },
    leave() {
      if (composeEngine.isLmbDown()) return;
      clearPlanchettePitches();
    },
  };

  // ── Multitouch (BACKLOG 13.33) ─────────────────────────────────
  // While a finger plays in Perform, more fingers can join on a touch screen
  // (the router decides which). Each is its own voice with its own Gravity,
  // haptic clicks and rail marker, sounding until it lifts. The first finger
  // stays the primary, with the Prism, hover and the rest; Prism Draw ignores
  // extra fingers.

  /** An extra finger playing beside the primary. */
  interface Finger {
    voiceId: VoiceId;
    /** Screen Y of its latest move. */
    sy: number;
    magnetic: MagneticState;
    /** Last snap target, for the cross flash (see prevSnapTarget). */
    prevSnapTarget: number | null;
    /** The line it's on, for haptic clicks (see hapticLine). */
    hapticLine: number | null;
  }

  /** Extra fingers down, by pointer id. */
  const fingers = new Map<number, Finger>();
  /** Voices of the fingers down, oldest first, the primary as 'primary': the
   *  pitch HUD shows the newest. */
  let fingerOrder: VoiceId[] = [];

  /** Move a finger's planchette and voice to where it is now. */
  function updateFinger(f: Finger) {
    const { cursorWorldY, snappedWorldY, snapTarget, snapConfig } = computeComposeCursorPitch(f.sy, f.magnetic);
    store.setPlanchetteY(f.voiceId, cursorWorldY, snappedWorldY);
    f.hapticLine = store.getState().hapticClicks ? hapticFollow(cursorWorldY, snapConfig, f.hapticLine) : null;
    if (f.prevSnapTarget != null && snapTarget != null && f.prevSnapTarget !== snapTarget) {
      store.markPlanchetteCrossed(f.voiceId, Date.now());
    }
    f.prevSnapTarget = snapTarget;
    if (preview.isDrawPreviewActive(f.voiceId)) preview.updateDrawPitch(snappedWorldY, f.voiceId);
  }

  /** Commit a finger's take while recording, as its own ungrouped curve, like
   *  a MIDI note. Its phrase must be closed first. */
  function commitFingerTake(voiceId: VoiceId) {
    const st = store.getState();
    const track = st.composition.tracks.find(t => t.id === st.selectedTrackId);
    if (!track) return;
    const curve = composeEngine.finalizeCurve(voiceId, () => history.snapshot());
    if (curve) commitFinalizedCurves([{ voiceId, curve }], track);
    markBgDirty();
  }

  /** Close every held finger's take (a loop wrap, a cancelled pass), committing
   *  it when `commit`. They keep sounding into a fresh take. */
  function sealFingerTakes(commit: boolean) {
    const now = performance.now();
    for (const f of fingers.values()) {
      composeEngine.closePhrase(f.voiceId, now);
      if (commit) commitFingerTake(f.voiceId);
    }
  }

  /** A finger lifted, or its session ended: close its take (committing it when
   *  `commit`) and silence it. */
  function releaseFinger(pointerId: number, f: Finger, commit: boolean) {
    fingers.delete(pointerId);
    fingerOrder = fingerOrder.filter(v => v !== f.voiceId);
    composeEngine.closePhrase(f.voiceId, performance.now());
    if (commit) commitFingerTake(f.voiceId);
    preview.stopDrawPreview(f.voiceId);
    store.removePerformPlanchette(f.voiceId);
  }

  const fingerInput = {
    down(e: PointerEvent): boolean {
      const st = store.getState();
      // Prism Draw: a newer finger takes the chord instead of a voice of its own.
      if (st.harmonicPrism.drawMode) {
        if (!composeEngine.isLmbDown() || chordFingers.length === 0) return false;
        takeChord(e);
        return true;
      }
      const voiceId = allocateFingerVoice([...fingers.values()].map(f => f.voiceId));
      const tone = getSelectedTrackTone();
      if (!voiceId || !tone) return false;
      const f: Finger = {
        voiceId,
        sy: e.clientY - fgCanvas.getBoundingClientRect().top,
        magnetic: createMagneticState(),
        prevSnapTarget: null,
        hapticLine: null,
      };
      fingers.set(e.pointerId, f);
      fingerOrder.push(voiceId);
      store.addPerformPlanchette({ voiceId, trackId: st.selectedTrackId, cursorWorldY: null, snappedWorldY: null, lastCrossedAt: 0 });
      composeEngine.markActivity(performance.now());
      updateFinger(f);
      const y = store.getState().performance.planchettes.find(p => p.voiceId === voiceId)?.snappedWorldY;
      if (y != null) preview.startDrawPreview(tone, y, voiceId, dynamics.getValue(voiceId));
      return true;
    },
    move(e: PointerEvent) {
      // A finger holding the Prism chord (silently, or playing it).
      if (chordFingers.some(c => c.pointerId === e.pointerId)) {
        const sy = screenY(e);
        if (!heldSilently(e.pointerId, sy)) moveChord(sy);
        return;
      }
      const f = fingers.get(e.pointerId);
      if (!f) return;
      f.sy = screenY(e);
      composeEngine.markActivity(performance.now());
      updateFinger(f);
    },
    up(e: PointerEvent) {
      if (chordFingers.some(c => c.pointerId === e.pointerId)) {
        if (!liftChordFinger(e.pointerId)) releasePress();
        return;
      }
      const f = fingers.get(e.pointerId);
      if (f) releaseFinger(e.pointerId, f, isCapturing(store.getState().transport));
    },
  };

  /** The planchette the pitch HUD shows: the newest finger down (13.33), else
   *  the primary. */
  function hudPlanchette(state: AppState): PlanchetteState | undefined {
    const planchettes = state.performance.planchettes;
    for (let i = fingerOrder.length - 1; i >= 0; i--) {
      const v = fingerOrder[i]!;
      if (v === 'primary' && !composeEngine.isLmbDown()) continue;
      const p = planchettes.find(pl => pl.voiceId === v);
      if (p) return p;
    }
    return planchettes[0];
  }

  /** End every extra finger (a session ending): close its take, committing
   *  it when `commit`. They play again once lifted and put back. */
  function releaseAllFingers(commit: boolean) {
    for (const [pointerId, f] of [...fingers]) releaseFinger(pointerId, f, commit);
    // The session released the chord too: fingers still holding it play nothing.
    chordFingers = [];
  }

  return {
    engine: composeEngine,
    // Input
    performInput,
    fingerInput,
    /** Extra fingers down now. */
    fingerCount: () => fingers.size,
    releaseAllFingers,
    sealFingerTakes,
    // Sounding
    stopComposePerformSounding,
    startPrismDrawPreview,
    updatePrismDrawPreview,
    syncHarmonyPlanchettes,
    applyDynamicsToSoundingVoices,
    // Capture
    captureComposeRecordingSample,
    closeLmbPhrases,
    finalizeComposeRecordedCurves,
    finalizeMidiVoice,
    finalizeAllInFlightMidiVoices,
    keepLastPhrase: capture.keepLastPhrase,
    dropLastPass: capture.dropLastPass,
    passLog: capture.passLog,
    resetLayerSession: capture.resetLayerSession,
    forgetTrack: capture.forgetTrack,
    // Per frame
    tickComposePerform,
    tickComposePitchMode,
    tickPerformYAutoScroll,
    // Drawing and the HUD
    planchettesAsSounding,
    planchetteDynamicsOf,
    hudPlanchette,
  };
}

export type Performer = ReturnType<typeof createPerformer>;
