# Backlog

Rolling list of planned work, grouped by phase and roughly sequenced. Check items off as they land. Sizes: S / M / L / XL.

Items marked **own planning session** need a dedicated design pass before any code.

---

## Phase 1 — Quick bug fixes & curve actions

- [x] **1.1 Point-select overrides handle-select when overlapping** *(S, bug)*
  Reorder hit-test in `handleSelectClick()` ([src/canvas/interaction.ts:545-639](src/canvas/interaction.ts)) so the anchor point wins the tie when both are within the 8px radius.

- [x] **1.2 Dual-planchette cleanup** *(S–M, bug)*
  Exactly one planchette at any time, at the position where a tone would play / a point would be placed. Investigate `renderPlanchettes` + `renderFreePlanchette` in [src/canvas/planchette.ts](src/canvas/planchette.ts) and their callers.

- [x] **1.3 Sharpen Curve (Alt+S)** *(S, feature)*
  New action: clear `handleIn`/`handleOut` on all points of selected curve(s). Helper in [src/model/curve.ts](src/model/curve.ts); wire into keybinding dispatch.

- [x] **1.4 Smooth Curve (Shift+S) + shared auto-smooth setting** *(S–M, feature + refactor)*
  Refactor `applyAutoSmoothHandles()` ([src/model/curve.ts:123-139](src/model/curve.ts)) to read `AUTO_SMOOTH_X_RATIO` from [src/constants.ts](src/constants.ts). Set to `0.25`. Add Shift+S action re-applying `applyAutoSmoothHandles` across selected curve(s). Draw auto-smoothing and Smooth Curve must share the same constant.

---

## Phase 2 — UI reorganization

- [x] **2.1 Dedicated tool panel** *(M, refactor)*
  Extract tool buttons from [src/ui/toolbar.ts](src/ui/toolbar.ts) into a new left-side tool panel, inside `#track-panel` between Transport and Tracks ([src/main.ts:40-107](src/main.ts)). Toolbar keeps Snap, Scale Root, Scale Type.

- [x] **2.2 Right-click context menu** *(M, feature)*
  New context-menu component. Initial items: Join, Smooth Curve, Sharpen Curve. Remove Join from toolbar once it lives in the menu. Sequence after 1.3 + 1.4.

---

## Phase 3 — Transport & musicianship

- [x] **3.1 Metronome** *(M, feature)*
  Audible clicks in playback only (not recorded). Measure-one louder, derived from `beatsPerMeasure`. Visual blink on planchette/playhead. Hook into playback scheduler in [src/audio/playback.ts](src/audio/playback.ts).

- [x] **3.2 Time signature UI — standard presets** *(S, feature)*
  Dropdown in transport for 2/4, 3/4, 4/4, 5/4, 6/8, 7/8. `beatsPerMeasure` already exists on Composition ([src/types.ts:66](src/types.ts)).

- [ ] **3.2b Custom rhythm patterns** *(M, own planning session)*
  Define what "pattern" means (accent map? mixed meter?) before coding.

---

## Phase 4 — Input expansion

- [x] **4.1 MIDI input (live)** *(M, feature)*
  Web MIDI API. New module for `navigator.requestMIDIAccess()`, noteOn/noteOff → performance engine. Device selection UI. Distinct from existing MIDI file import at [src/export/midi-import.ts](src/export/midi-import.ts).

---

## Phase 5 — New snap modes

- [x] **5.1 Snap Duration / Glissando Snap** *(L, own planning session — superseded by 7.1)*
  Glide time in beats, 0–16 (0 = current instant). Affects performance engine and recording output (produces diagonal connecting segments). Slider UI TBD.

- [x] **5.2 Magnetic Snap** *(L, own planning session)*
  New snap *mode*: elastic cursor coupling + proximity-based attraction to snap lines. Enables on-pitch tremolo. Recording semantics need discussion. Strength slider.

---

## Phase 6 — Harmonic Prism

Dynamic chords at selectable harmonic frequencies. Three sub-phases shipped.

- [x] **6.1 Projection mode** *(L, PR #36)*
  Pure-math chord engine (`src/utils/harmonics.ts`) with prescribed JI ratio chains. Selecting a curve and pressing `Ctrl+H` projects dashed echoes up/down the canvas at chord intervals; snap pulls Y exclusively to echo pitches while active. Source curve gets a rainbow gradient highlight.

- [x] **6.2 Draw mode + freehand grouping** *(L, PR #37)*
  `H` toggles draw-mode chord placement: drawing places N grouped sibling curves at chord-spec offsets, all editable as a unit. Generalised the chord-group concept to a plain `groupId` on `BezierCurve`; `Ctrl+G` / `Ctrl+Shift+G` group/ungroup any selection. Group expansion threaded through delete, cut, copy, paste, duplicate, continue, alt-drag, transform-box, scissors split, and join (cross-group join refused with toast).

- [x] **6.3 Perform mode** *(L, PR #39)*
  Holding LMB during Scroll-Canvas Playback sounds the whole chord cluster simultaneously; recording captures every voice and commits N grouped sibling curves on release. Rail planchettes use rainbow voice colours (gradient primary + solid harmonies); idle Spacebar preview plays the full chord. Planchette lifecycle synced to `(drawMode && (playback || record-armed))`; synths tied to LMB. Chord-spec changes during a held LMB retune voices live.

---

## Phase 7 — Post-Phase-5 polish & small features

- [x] **7.1 Remove Duration Snap Glide** *(S–M, cleanup)*
  The time-based Glide (Phase 5.1) didn't land as hoped — useful range is too narrow to justify the UI. Delete [src/utils/snap-glide.ts](src/utils/snap-glide.ts), `snapGlideBeats` state + mutator + localStorage key, the Glide slider row in Transport, the glide branch in `computeComposeCursorPitch`, and the grey-out logic (no mutual exclusion needed once Glide is gone). When Magnetic is off, snap is the original instantaneous behavior. Update help.html.

- [x] **7.2 Auto-smooth handle-length slider** *(S, feature)*
  Expose `AUTO_SMOOTH_X_RATIO` from [src/constants.ts](src/constants.ts) as a user-adjustable slider in the Draw Tool Properties panel. Slider drives the same constant used by both Draw auto-smoothing and the Smooth Curve action. Persist to localStorage.

- [x] **7.3 Pitch HUD layout stability** *(S, bug)*
  Pitch HUD numbers jump horizontally when a component changes width (e.g. cents goes from "0" to "+12¢"). Give each field (note name, cents, raw pitch, etc.) its own fixed-width slot so adjacent fields don't shift. Touch [src/main.ts](src/main.ts) `updatePitchHudDom` + HUD styles in [styles/main.css](styles/main.css).

- [x] **7.4 Page Up / Page Down — jump to first/last point** *(S, feature)*
  New keybindings: Page Up scrolls viewport to the first control point in the composition; Page Down scrolls to the last. Reuse existing viewport scroll helpers. Wire into the keydown handler in [src/main.ts](src/main.ts).

- [x] **7.5 Rename Transport "MIDI" → "MIDI Input"** *(XS, rename)*
  Label change on the MIDI device row in the Transport panel. Trivial string edit in [src/main.ts](src/main.ts).

- [x] **7.6 MIDI unsupported tooltip wording** *(XS, polish)*
  When Web MIDI is unavailable, the device dropdown should show the tooltip `"MIDI Input Not Supported By Browser."` (current wording is "Web MIDI not supported in this browser"). Confirm the existing disabled-state logic fires correctly and update the string.

---

## Phase 8 — Captured during Harmonic Prism work (unsequenced)

Items that came up while building Phase 6 but are independent features. Each becomes its own planning pass when picked up.

### Bug fixes / small UX
- [x] **8.1 Hotkeys fire while editing the composition name** *(S, PR #41)*
  When `#comp-name` is focused, suppress global hotkeys (D / V / X / C / S / H / Space / etc.). Enter should commit the edit and blur the input. Verify the existing `e.target instanceof HTMLInputElement` guard in [src/main.ts](src/main.ts) — bug may be specifically Enter behaviour or some hotkey path that bypasses the check.

- [x] **8.2 Move curve to a different track** *(M, PR #47)*

- [x] **8.18 Live recording trail visualization** *(S–M, PR #50)*

- [x] **8.20 Record AFK timer should respect loop / future content** *(S, PR #45)*
  The perform-engine AFK timeout (`afkTimeoutMs` in [src/canvas/performance-engine.ts](src/canvas/performance-engine.ts)) currently fires whenever record is armed and there's no input activity, even when the session has a meaningful reason to keep waiting. Suppress the auto-stop when (a) Loop is enabled (the user is intentionally recording over loops), or (b) the playhead hasn't yet reached the rightmost control point in the composition (there's still future content to record over). Update `tickComposePerform`'s `onAfkTimeout` gate or thread the new conditions through `TickArgs`.

### Selection & editing
- [x] **8.3 Multi-select points: shift-click + drag-marquee** *(M, PR #51)*
  Shift+click on anchor toggles individual point in `selectedPointKeys: Set<string>` (`<curveId>:<idx>` keys); shift+click on segment still toggles whole curve. Drag-marquee on empty canvas selects anchor points inside rect (active track only). Group-drag translates all selected points together via the existing Transform Box (with `pointIndicesPerCurve` filter). Delete removes selected points (drops curves below 2 points). Transform Box scale + octave shift act on the subset. Alt-drag duplicate, copy/paste, scissors/join on subsets deferred to follow-up.

- [x] **8.23 Cross-track curve selection (Select tool)** *(S, PR #48)*
  Plain click on any visible non-muted curve switches the active track to that curve's track and selects it. Shift-click stays locked to the active track so multi-select can't be torpedoed by a stray cross-track click. Non-active-track curves render dimmed so the active track stays visually distinct.

### Volume editing
- [ ] **8.4 Per-curve volume timeline lane** *(L, own planning session)*
  Volume currently lives as a per-control-point property; complex curves make volume editing unwieldy. Concept: a separate panel below the main canvas, sharing the X zoom and ruler, hosting secondary animatable curves per track or per source curve. First inhabitant is volume; future inhabitants could include per-tone-layer mixes, filter cutoff, etc. Needs a dedicated design session covering interaction, data model, and rendering.

### Snap
- [x] **8.5 Persist snap settings to the composition file** *(S, PR #42)*
  Currently snap config is global / localStorage; should be per-composition so projects with bespoke snap setups round-trip cleanly. Add to `Composition` schema with a version bump.

- [x] **8.6 Snap presets** *(S, PR #42)*
  Built-in presets covering common combos of (subdivisions, magnetic strength, spring, damping). User can save current config as a named preset and load presets from a dropdown. Stored in localStorage (user presets) and in code (built-ins).

- [x] **8.7 User-definable snap guides** *(M, PR #42)*
  New first-class entity — X-oriented and Y-oriented guides placed like loop markers (drag on the appropriate ruler). Guides are *additive* to other snap targets (don't replace them like projection echoes do). Selected guide gets a label field in Object Properties; label renders along the guide. A "Guides" toggle controls visibility for all guides. Persisted in the composition file. Also shipped: a Lock toggle that gates selection / drag / delete (PR #42 review feedback).

- [x] **8.19 Rename Key "None" to "Chromatic" + new "None" mode (no pitch lines)** *(S, PR #46)*
  Today the Key dropdown's default "None" actually means "all semitones shown" (chromatic display). Rename it to **Chromatic** so the label matches the behavior, and add a *new* **None** option that hides every pitch line on the staff. Useful for users who've set up custom pitch guides (8.7) and want a clean canvas without the default snap lines. Touch [src/ui/toolbar.ts](src/ui/toolbar.ts) for the dropdown wording, [src/canvas/staff-renderer.ts](src/canvas/staff-renderer.ts) for the no-lines render branch, and the snap path in [src/utils/snap.ts](src/utils/snap.ts) so Y-snap also disengages in true-None mode (cursor becomes free Y; guides still pull if placed).

### Tone generator
- [ ] **8.8 FM synthesis with waveform visualizer** *(XL, own planning session)*
  Major upgrade beyond the current additive layer model: frequency modulation, waveform visualizer, multiple waveform options, noise options, keyframe-animatable mixes (with keyframes tied to curve or track — TBD). Needs its own design pass covering synth architecture, the keyframe model (overlaps with 8.4), and the UI for editing FM operator graphs.

### Viewport navigation
- [x] **8.9 Home key takes the view to the playhead** *(S, PR #41)*
  Centers the viewport on the current playhead beat (or rail beat in Scroll Canvas mode) regardless of where the user has panned. Useful when scrolled far away from the active position.

- [x] **8.10 PageUp on an empty canvas returns to X=0** *(XS, PR #41)*
  When no control points exist, `PageUp` (currently "scroll to first control point") has nothing to target — fall back to scrolling the viewport back to beat 0 so the user has a reliable home position on a fresh canvas.

### MIDI
- [x] **8.11 MIDI input recording (no snap)** *(M, PR #43)*
  Phase 4.1 added live MIDI input as a perform source; extend it to record incoming MIDI directly to curves the same way LMB-held perform records. Don't snap the captured pitch — MIDI input is already discrete. May need per-track "MIDI input" arming separate from the LMB record-arm flow, plus clear visual feedback during MIDI recording.

- [x] **8.21 MIDI sustained note doesn't continue past loop wrap** *(S, PR #54)*
  When a MIDI note is held across a loop wrap during recording, the wrap finalizes the note's curve (correct — `finalizeAllInFlightMidiVoices` in `tickComposePerform`'s `onLoopWrap` callback in [src/main.ts](src/main.ts)) but the synth and recording don't restart on the other side, so the held note goes silent and stops capturing. Should: keep the synth voice alive across the wrap, and start a fresh recording for that voice from the loop start beat so the held note becomes two contiguous curves (one ending at loop-out, one starting at loop-in). Match LMB-held perform behavior on loop wrap.

- [x] **8.24 MIDI file import: read pitch bend** *(M, PR #55)*
  Parse 0xE0 (pitchBend) events from imported `.mid` files and fold them into the resulting BezierCurves as additional control points (Y = `noteNumber + bend * range / 8192`). Build a per-channel bend timeline across **all** tracks (Type-1 SMFs put bend on a different track than the notes). Sniff RPN 0/0 (Pitch Bend Sensitivity) for non-standard ranges (e.g. ±12 for guitar files); default ±2. Reuse `curveFromRecording` for RDP simplification + auto-smooth handles. Cap at 256 points per curve to keep dense vibrato from blowing up the audio scheduler. Live-record pitch bend (8.25) is the follow-up. See [.claude/plans/8.24-pitch-bend-input.md](.claude/plans/8.24-pitch-bend-input.md).

- [x] **8.25 Live MIDI record: pitch bend wheel** *(M, PR #55)*
  Decode 0xE0 in [src/audio/midi-input.ts](src/audio/midi-input.ts); track current bend in [src/main.ts](src/main.ts) MIDI wiring (single global value — typical user plays one device on one channel). On every bend event: re-tune all active MIDI preview synths and update every `midi-*` planchette's cursor + snapped Y via `store.setMidiPitchBendOffset`. The recording capture loop already reads `snappedWorldY`, so bent samples flow through to `curveFromRecording` automatically. Hardcoded ±2 semitone range. Bend state persists across loop wraps (extends 8.21) and across noteOn/noteOff because it lives outside the planchette + recording buffer. See [.claude/plans/8.24-pitch-bend-input.md](.claude/plans/8.24-pitch-bend-input.md).

- [x] **8.26 Add 24-TET to Microtonal scale options** *(XS, PR #56)*
  Quarter-tone scale with 24 equal divisions of the octave (intervals at 0.5-semitone spacing). Single entry added to `SCALE_CATALOG` in [src/utils/scales.ts](src/utils/scales.ts) — fractional intervals were already supported by `getScaleNotes` and the snap path.

- [x] **8.27 Tune A4 — global staff tuning** *(M, PR #56)*
  Per-composition reference frequency for A4 (default 440 Hz). New "Tune A4" spinbutton in Transport accepts 380–500 Hz; stored as a cents offset (`tuningOffsetCents`) on the Composition so projects round-trip cleanly. A small label beside the input shows the cents offset (e.g. "-31.8¢" for A=432). Audio path retunes via a module-level `currentReferenceAHz` in [src/constants.ts](src/constants.ts) read by `noteToFrequency` — every synth voice, curve sampler, and preview path picks up new tuning automatically. Existing v1/v2 saves load with default A=440 (migration backfill in [src/export/json-export.ts](src/export/json-export.ts)).

- [x] **8.28 Hz readout on Pitch HUD** *(XS, PR #56)*
  New `hud-hz` slot beside the cents readout shows the snapped pitch as a frequency (2 decimals below 100 Hz, 1 decimal above). Uses the live `noteToFrequency`, so it reflects the 8.27 Tune A4 setting in lockstep. Builds on the fixed-width slot pattern from 7.3.

- [x] **8.22 Verify 8.20 AFK gating with MIDI input (hardware required)** *(XS, PR #52)*
  8.20 added MIDI noteOn/noteOff activity marks and AFK suppression while the playhead is before the rightmost point or Loop is on. Non-MIDI cases were verified at ship time; MIDI cases require hardware. To test once a MIDI keyboard is available:
  - **MIDI-only armed, playing keys** — MIDI-arm a track, no LMB, press MIDI keys every 30–60s for several minutes. Must NOT auto-stop.
  - **MIDI-only armed, idle keys past rightmost** — MIDI-arm, playhead past rightmost, loop off, no MIDI input for > 2 min. SHOULD auto-stop.
  - **Sustained MIDI note past rightmost** — MIDI-arm, playhead past rightmost, loop off, hold a single MIDI note for > 2 min. Must NOT auto-stop (relies on `captureSample` activity marks during MIDI recording).

### Harmonic Prism nice-to-haves
- [ ] **8.12 Chord-spec hotkeys / number-key favorites** *(M, feature)*
  Phase 6.3's state plumbing already retunes voices live whenever the chord spec changes — the missing piece is a non-LMB way to trigger the change so the user can shape-shift mid-perform. Concept: user-definable chord-shape favorites bound to number keys.

- [x] **8.13 Inversion controls** *(S, PR #49)*
  Per-voice octave offsets in the Harmonic Prism panel (new VOICING subsection). Each voice gets a ±2 octave stepper; offsets apply to projection echoes, future placements, and live perform retune. Inversions emerge as a special case (1st inversion = `[+1, 0, 0]`).

- [ ] **8.14 Chord-label readout on selected groups** *(S, feature)*
  Honest about microtonal bases ("C(+17¢) major"). Shown in Object Properties when a chord cluster is selected.

- [ ] **8.15 "Lite harmonies" audio mode** *(S, feature)*
  Sine-only for harmony voices, for CPU relief when running 5×multi-layer voices.

- [ ] **8.16 Secondal stacking** *(S, feature)*
  Cluster chords. Listed as low priority in the original Harmonic Prism design doc.

- [x] **8.17 CPU monitoring under heavy loads** *(M, PR #53)*
  Verify multi-voice perform + multi-layer tones + playback CPU on target hardware. Measure before optimising.

---

## Phase 9 — Performance & architecture (from full-codebase review)

Surfaced during a full-repo architecture/performance review done alongside the cents + lanes refactor (PR #60). These are the items that refactor unblocked but didn't itself implement — mostly prep work for the jam/looper direction in [performance-jam-looper-plan.md](performance-jam-looper-plan.md).

- [x] **9.1 Voice-pool playback engine + loop restart reuse** *(L, perf, PR #61)*
  *(Shipped — the text below describes the pre-refactor design; `createTrackSynths` is now `reconcileTrackPools` in [src/audio/playback.ts](src/audio/playback.ts), pools sized via `computeVoiceAssignment`, loop restarts reuse the pool.)*
  `createTrackSynths` in [src/audio/playback.ts](src/audio/playback.ts) allocates one always-running oscillator+gain `ToneSynth` per curve at play start — a composition with hundreds of short notes runs hundreds of concurrent (mostly silent) voice chains. Every loop wrap tears the whole pool down and rebuilds it (`stop(); play(...)` in `scheduleAhead`), which is an allocation spike at exactly the moment a live looper can least afford one. Needs a voice pool sized to max simultaneous overlap (derivable from curve time ranges), with curves checked in/out as the playhead reaches them and loop restarts that reuse the pool instead of rebuilding it. This is the looper's foundation — sequence before jam/loop UI work.

- [ ] **9.2 fgDirty flag + Path2D curve caching** *(M, perf)*
  `render()` in [src/main.ts](src/main.ts) clears and repaints the entire foreground canvas (every curve, every frame) even when nothing changed — the background layer already has a `bgDirty` flag, the foreground has nothing. Add a mirrored `fgDirty` set by store notifications / interaction / playback so idle CPU drops to near zero. During active playback almost everything *is* dirty every frame regardless, so also cache each curve's tessellated shape as a `Path2D` keyed by curve identity (invalidated on edit) so steady-state cost is a transform instead of re-evaluating every cubic segment.

- [ ] **9.3 History: externalize raw-take blobs before raw-take retention lands** *(M, perf — coordinate with raw-take-retention design)*
  `cloneComposition` in [src/state/history.ts](src/state/history.ts) deep-clones the whole composition via `JSON.parse(JSON.stringify(...))` on every snapshot, keeping up to 50. Fine today (compositions are small); not fine once the plan's raw-take retention (~1 MB/voice at 100–200 Hz) lands — 50 multi-MB clones is GC-visible garbage churned mid-jam, which is the worst possible time for a pause. Settle this *before* raw-take retention is built, not after: keep raw-take blobs outside the snapshotted composition (referenced by id in a separate immutable pool) or move history to structural-sharing / patch-based snapshots. The plan's open "undo last layer vs. edit-undo" question is **decided (2026-07-19): one stack, semantic key** — each kept loop pass is exactly one undo entry, and "undo last layer" (10.4) is a targeted undo of the most recent kept pass; the design session inherits this.

- [ ] **9.4 MIDI velocity: live input → recorded volume, then MIDI export** *(M–L, feature)*
  MIDI file import already threads velocity into the volume lane ([src/export/midi-import.ts](src/export/midi-import.ts)); live MIDI input still discards it (`void velocity;` at [src/main.ts:1082](src/main.ts)) — wiring it into the recording's volume lane is the small first step and stands up the plan's "dynamics bus: MIDI" item. No MIDI export exists yet ([src/export](src/export) has only JSON and WAV); now that pitch is canonical in cents (¢÷100 = MIDI note + bend fraction), export is mechanical: sample each curve, emit note-on at the nearest semitone plus a pitch-bend stream for the continuous deviation (one channel per simultaneous curve ≈ MPE), volume-lane value at note-on → velocity, continuous volume → CC11/channel pressure. [src/export/midi-import.test.ts](src/export/midi-import.test.ts) gives a round-trip test harness for free (export → import → compare). *Note: the live-velocity first step is sequenced as 11.2 (rides the dynamics bus); MIDI/MPE export stays here.*

---

## Phase 10 — Jam mode & live looper

First slice of [performance-jam-looper-plan.md](performance-jam-looper-plan.md) (decisions recorded there, 2026-07-19). Sequenced: 10.1 is the foundation; 10.2–10.6 build on it. Jam-mode defaults: time-axis beat-snap **off** (toggle available), clock tempo = composition BPM.

- [ ] **10.1 Free-running jam clock** *(M–L)*
  Formalize jam/perform mode: the clock free-runs with nothing armed — canvas scrolls, sound on, no fixed composition length. Replace the `endBeat = compLength + 10_000` hack in `startComposePerformPlayback` ([src/main.ts](src/main.ts)) with a real open-ended play range. Give magnetic snap a time base independent of active perform (today the physics ticks off `playback.getPositionBeats()` and only runs during LMB perform in `computeComposeCursorPitch` — use wall-clock dt when the transport is idle) so pitch gravity is live at rest. X beat-snap defaults off in jam mode. Decisions settled + build spec in [.claude/plans/10.1-free-running-jam-clock.md](.claude/plans/10.1-free-running-jam-clock.md): dedicated Jam toggle + `J` hotkey, no countdown, 10-min un-armed idle timeout, magnetic in all perform contexts, `OPEN_END_BEAT = MAX_CANVAS_EXTENT` ceiling.

- [ ] **10.2 Rolling buffer + "keep that" retrospective capture** *(L)*
  30s rolling gesture buffer in musical time, running continuously during jam. A "keep that" key commits the just-played phrase into a curve after the fact. Phrases crossing the loop seam reuse the 8.21 loop-wrap split (two contiguous curves). Planning session done — decisions + build spec in [.claude/plans/10.2-retrospective-capture.md](.claude/plans/10.2-retrospective-capture.md): phrase-span buffer replacing the flat per-voice arrays (`finalizeCurve`'s take-the-whole-buffer assumption breaks once capture is continuous), keep = newest uncommitted phrase (open or closed) so repeat presses walk backward, no quantize, loop region untouched, buffer survives Stop with a lit `btn-keep` indicator, `K` hotkey, capture in every perform context. Keeping an in-progress phrase splits it so a held line — notably one crossing the loop seam — keeps without breaking the note.

- [ ] **10.3 Layer-per-pass looping** *(M)*
  Each kept/recorded pass becomes its own track (inheriting tone + volume; mute/solo per layer via the existing track panel — layers = tracks per the plan doc). Planning session done — decisions + build spec in [.claude/plans/10.3-layer-per-pass-looping.md](.claude/plans/10.3-layer-per-pass-looping.md): a `Layer` transport toggle (default off, so today's routing is untouched), loop wrap as the layer boundary with layers created lazily on commit, active track stays on the source, 16-track cap, routing hooked into the shared `commitFinalizedCurves` choke point. Visual distinguishability is dimming-only for now; optional per-track `color` (additive, no migration) is the flagged follow-up if a stack of same-colored layers reads poorly.

- [ ] **10.4 Undo last layer** *(S–M, after 10.3)*
  Semantic key on the single existing undo stack ([src/state/history.ts](src/state/history.ts)): each kept pass = exactly one snapshot. No separate layer history, no mode-dependent undo (decided 2026-07-19). Planning session done — decisions + build spec in [.claude/plans/10.4-drop-last-pass.md](.claude/plans/10.4-drop-last-pass.md). Key refinement: history is a linear snapshot stack with no way to excise a middle entry, so the key is a **forward delete that is itself undoable** rather than a rewind — it works regardless of edits made since, and `Ctrl+Z` restoring a dropped layer doubles as the looper's "redo layer". `U` key, any performed pass (keeps + armed), walks back through the whole session, removes the layer track when that pass created it and it's left empty. Introduces the app's first `removeTrack` mutator. Pass log is append-only with droppability *derived* from whether the curves still exist, so undo/redo interplay and manual deletions need no bookkeeping.

- [x] **10.5 Deliberate "record next full pass"** *(M)*
  Arm to record exactly one loop-length pass, auto-committing at the wrap — the structured-material capture style (drones, harmony beds), complementing 10.2's serendipitous leads. `Shift+R` / `Shift`+click Record; a queued arm shows an amber Record button and starts at the next loop point; from idle it starts the loop and records the first pass; Loop is auto-enabled with a `Record next Pass: Loop On` toast; plain `R` takes over a queued arm. Decisions + spec in [.claude/plans/10.5-record-next-pass.md](.claude/plans/10.5-record-next-pass.md). Also fixed a 10.3 ordering bug found here: the layer boundary reset *before* wrap-time commits, so a gesture held across the seam landed in the **next** pass's layer.

- [ ] **10.6 Live loop in/out taps, bar-quantized** *(S–M, DEFERRED)*
  **Deferred 2026-07-30 at the user's request — not sure it's wanted.** Revisit only if setting loop points mid-jam proves necessary in practice; dragging the ruler markers covers it for now.
  Set loop points mid-jam by key; quantize taps to the nearest bar (absorbs reaction delay). Optional classic-looper behavior: a late tap reads as the previous boundary and snaps the playhead back. Dragged ruler markers keep today's fine-grid snapping (`snapBeatForMarker` in [src/canvas/interaction.ts](src/canvas/interaction.ts)) — bar-quantize applies to taps only (decided 2026-07-19).

---

## Phase 11 — Dynamics bus

The plan doc's dynamics-axis direction: one shared normalized channel that drives live synth amplitude and records into the currently-recording voice's volume lane; every input device is then a thin adapter. Build order per the plan: swell → MIDI → pen → gamepad.

- [ ] **11.1 Dynamics bus + key-held swell** *(M)*
  Stand up the bus: keydown ramps up, keyup decays. Replaces the hardcoded `volume: 0.8` in `captureComposeRecordingSample` ([src/main.ts](src/main.ts)) / flat 2-point volume lane in `curveFromRecording` ([src/model/curve.ts](src/model/curve.ts)) with continuous bus samples. Per-voice on capture, not global.

- [ ] **11.2 MIDI velocity + CC/expression + MIDI-learn** *(M)*
  Stop discarding live velocity (`void velocity;` at [src/main.ts:1082](src/main.ts)) — the first half of 9.4. Add CC + channel-pressure decode in [src/audio/midi-input.ts](src/audio/midi-input.ts) (currently note-on/off + pitch bend only) feeding the bus, plus MIDI-learn so any controller/pedal maps. Optional, never a prerequisite.

- [ ] **11.3 Pointer Events migration + pen pressure/tilt** *(M)*
  Migrate [src/canvas/interaction.ts](src/canvas/interaction.ts) from legacy mouse events to Pointer Events; pen pressure feeds the bus; capture tilt now even though its use (vibrato/timbre) is decided later. Pen-vs-mouse detection + adjustable sensitivity curve.

- [ ] **11.4 Gamepad analog input** *(S–M)*
  Poll the Gamepad API in the existing frame loop; analog trigger/stick feeds the bus; "pick your control" mapping step for hardware variance.

---

## Phase 12 — Harmony & format guardrails

Unification and portability items from the plan doc. 12.1 is sequenced after Phase 10 (needs real beds to snap to); 12.2–12.3 can land any time; 12.4 waits on 9.3.

- [ ] **12.1 Snap-target composition + snap-to-sounding-harmony** *(L, own planning session, after Phase 10)*
  First define how gravity sources combine into one target set — today Prism projection targets *replace* scale/chromatic/guides while active, guides are additive, scale vs. chromatic are exclusive ([src/utils/snap.ts](src/utils/snap.ts)). Then let the currently sounding bed (drone or Prism chord) become the magnetic target so the lead snaps to the live harmony. Session also owns: dense-bed resolution (nearest/weighted/limited targets), current-temperament vs. pure-JI against the drone.

- [ ] **12.2 `.glisskit` + Import-settings verb** *(M)*
  Per the settled two-extensions/two-verbs design in the plan doc: same envelope schema; extension picks the default verb (`.gliss` → Open, `.glisskit` → Import settings); a **File ▸ Import settings…** action reads only `tuning`/`snap` from any conforming file. `kind` becomes advisory. Touch [src/export/json-export.ts](src/export/json-export.ts) + file-open wiring in [src/main.ts](src/main.ts).

- [ ] **12.3 Round-trip preservation of unknown top-level envelope sections** *(S)*
  `serializeComposition` ([src/export/json-export.ts](src/export/json-export.ts)) rebuilds the envelope from a fixed key set, so unknown top-level sections (e.g. a future `hostSettings`) are dropped on load→save; unknown keys nested in `composition` already survive. Carry unknown envelope keys through verbatim — this is the cross-runtime round-trip rule the plan doc depends on.

- [ ] **12.4 Raw-take retention** *(L, own planning session, after 9.3)*
  Keep the high-res capture stream alongside the fitted Bezier (RAW vs. JPEG framing in the plan doc). Session inputs: authority policy (raw = immutable original, edited Bezier wins playback), kept-takes-only retention, persist rate (100–200 Hz) + encoding (delta + fixed-point + gzip), inline arrays vs. zip-style container, pre- vs. post-snap capture. Must follow 9.3 (history externalization) so multi-MB blobs never enter the undo clone path.

---

## Housekeeping reminders

- Update [help.html](help.html) in the same PR as each feature.
- User testing pass in the dev server before PRing each item (ship-after-review).
- Dev server for this worktree: `npm run dev` → port 5187.
- Extract pieces of [src/main.ts](src/main.ts) (3,700+ lines) opportunistically as Phase 9 items touch its regions — the render loop, the compose/perform/record state machine, and transport + MIDI-input wiring are the natural first cuts. Not a standalone backlog item and not a big-bang rewrite: peel off a module each time surrounding work already has you in that code.
