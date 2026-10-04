# Roadmap & Backlog

**The single place for planned work.** Design rationale lives in [DESIGN.md](DESIGN.md); nothing in DESIGN.md is a schedule. Item numbers are stable — code comments cite them as `BACKLOG x.y` — so shipped numbers are never reused.

Sizes: XS / S / M / L / XL. Items marked **own planning session** need a design pass before any code.

---

## Current direction (updated 2026-09-27)

A full-project review on 2026-09-24 (findings in [DESIGN.md › Current architecture](DESIGN.md#current-architecture-as-of-2026-09-24)) paused feature work for three phases: stabilize, consolidate the architecture, simplify the interface. Where that stands:

- **Phase 14 — Stabilize:** done.
- **Phase 15 — Consolidate the architecture:** the big pieces are done (signals store, transport state machine, input router, command catalog, one snap-config builder, read-only render loop, AudioWorklet voice). Left, as background work: **15.3** break up `main.ts` (3,400 lines; the target is a few hundred), **15.4** the last panels and dialogs onto Preact, **15.8** kernel tests. They make every feature cheaper and are needed before Phase 17.
- **Phase 16 — Simplify the interface:** the build is done (16.1–16.7). Left: the **16.8 Perform**, **16.9 Visual theme** and **16.10 Small-screen layout** design sessions.
- **Phase 17 — Portable core:** not started. Needed only before a port (VST, VCV, hardware).

**[Queued features](#queued-features) resumed on 2026-09-26**, starting with the tuning rework (13.8) and frets (13.16–13.22). Suggested next:

1. **Done since:** 13.24 Transform by interval (PR #98), 12.3 unknown file sections round-trip (PR #99), 13.10 Curves as pitch guides (PR #100), 13.26 Area Nudge with 13.25's first step (PR #101), 13.11 recording fit and Simplify (PR #102), 13.28 test builds at gliss.mirimantis.com (PR #103), the touch round: 13.32 phone layout, 13.35 haptic clicks, 13.36 Gravity Speed, 13.37 defaults (PR #104), 13.33 multitouch with gesture guards and Full screen (PR #105), 15.8 kernel tests (PR #106), 15.3 parts A (PR #107) and B (PR #108).
2. **Planning sessions, roughly by payoff:** 16.8 Perform (it shapes 13.23's hot bar and 11.x dynamics; decide on 13.11's Old fit switch first); 13.23 Key guides, then 12.1. 13.25 step 2 (Projection's back end) when decided.
3. **Background, now (decided 2026-10-04: finish before piling more on):** 15.8 done; 15.3 in four PRs (A render loop, HUDs, zoom; B perform and capture; C transport, commands, MIDI, Tune A4, track panel; D the layout template with 15.4), then the rest of 15.4.

---

## Phase 14 — Stabilize

- [x] **14.1 Jam / pass-record click edits the canvas when Lock Rail is off** *(S, bug — confirmed, PR #72)*
  - **Repro:** turn Lock Rail off, start Jam, and click the canvas with the Draw tool. The click sounds a perform note *and* creates a stray one-point curve.
  - **Cause:** the two canvas mousedown handlers disagree about perform mode. `isComposePerformActive` ([src/main.ts](src/main.ts)) includes jam and pass-record; `isComposePerformLocked` ([src/canvas/interaction.ts](src/canvas/interaction.ts)) doesn't.
  - **Fix now:** make both call one shared predicate. The structural fix is 15.2.
- [x] **14.2 Tool panel shows the wrong tool after clicking a track** *(S, bug — confirmed, PR #72)*
  - **Repro:** in Draw, click a track in the track list to select its curves, then press Delete. The panel still shows Draw, but Draw doesn't work until you click it again.
  - **Cause:** the track-click handler calls `store.setTool('select')` without updating the tool panel. The Ctrl-hold switch in `interaction.ts` has the same gap.
  - **Fix now:** make the tool panel subscribe to the store. Hand-syncing in general goes away in 15.1 / 15.4.
  - **Decided (2026-09-24): a track click no longer switches tools.** It selects the track's curves and leaves the tool alone, so in Draw you can Delete and keep drawing. The transform box is built when you enter Select (button or `V`).
- [x] **14.3 Live pitch is stepped** *(S, audio, PR #72)*
  - `ToneSynth.setFrequency` uses `setValueAtTime` at mouse/frame rate, so live glides and magnetic vibrato are a ~60 Hz staircase.
  - **Interim fix:** use `setTargetAtTime` or a short linear ramp to the next expected update. Verify by ear on a bright saw tone.
  - The full fix is the AudioWorklet voice (15.7), now done; this glide remains as its fallback.
- [x] **14.4 Space-hold preview snaps differently from drawing** *(XS, bug, PR #72)*
  - The free-planchette preview builds its own snap config without guides or projection targets.
  - **Fix now:** use `buildSnapConfig`. The structural fix is 15.6.
- [x] **14.5 Repo hygiene** *(XS, PR #72)*
  - Exclude `.claude/worktrees/**` from Vitest: 11 of 23 test files currently run from stale worktrees.
  - Prune the 9 stale worktrees.
  - Remove the stale "glissandograph mode" / "gliss mode" comments in [src/main.ts](src/main.ts).
- [x] **14.6 Pick one product name** *(XS decision + S rename, PR #72)*
  - **Decided (2026-09-24): Glissandograph.** The page title, package name, docs and file format already used it; the remaining "SlideSynth" mentions in help.html and docs are renamed.
  - Left as-is on purpose: the GitHub repo and folder name, and the internal `slidesynth.*` localStorage keys and CSS class prefix. None of these are user-facing, and renaming the keys would need a migration for no visible benefit.
  - The envelope marker `app: "glissandograph"` is a file-format contract and never changes.
- [x] **14.7 Un-looped Jam stops at the end of existing content** *(S, bug — found during 14.5, PR #72)*
  - **Repro:** with Loop off, start Jam on a composition with curves. The transport stops when the playhead passes the last curve, and the Jam button stays lit.
  - **Cause:** the store subscription clamps the play range to the composition length on every store change unless Record is armed, which overrode Jam's open-ended range.
  - **Fix:** skip the clamp while jamming. The loop-marker sync still applies when Loop is on.

---

## Phase 15 — Consolidate the architecture

The target is written up in [DESIGN.md › Target architecture](DESIGN.md#target-architecture). Suggested order: 15.1 → 15.2 → 15.3 / 15.4 (incremental, one panel or region at a time). 15.5–15.8 can interleave. This replaces the old "extract pieces of main.ts opportunistically" housekeeping note.

- [x] **15.1 Signals-based store** *(L, PR #73)*
  - Fine-grained subscriptions replace the single `notify()`. Today that notify rebuilds the track list and both property panels via `innerHTML` on every change, including every mousemove of a drag.
  - Split state into three kinds:
    - **document:** the composition, which is undoable and saved;
    - **workspace preferences:** localStorage;
    - **runtime:** transport, selection, planchettes.
  - Remove the `AppState` mirrors of `composition.snap`, and move loop-enabled out of the playback engine into state.
  - *Shipped:*
    - `@preact/signals-core` backs every `AppState` field with a version signal behind the unchanged `getState()` API. `watch` / `effect` in `src/state/reactive.ts` replace every `store.subscribe` caller, and the catch-all subscribe is gone.
    - Panels render only when their markup changes (`setHtmlIfChanged`). Their listeners look state up by id at event time, so they stay correct after undo.
    - Measured: 60 no-op edits went from 240 DOM mutations (~53 ms) to 0 (~9 ms).
  - *Fixed along the way:*
    - The track-volume and Handle-length sliders stopped mid-drag because each input rebuilt the panel under the pointer.
    - The snap drawer and preset dropdown didn't follow undo or file open.
    - Turning Loop off mid-Jam stopped the transport at the end of existing content.
  - *Deferred to 15.2:* replacing the stringly `curveId:idx` point keys with a structured selection type. That code lives in the interaction handlers 15.2 rewrites.
- [x] **15.2 Transport / perform state machine** *(L, PRs #74 + #75)*
  - One module with a single mode value and named transitions, replacing the ~8 flags spread across the store, the playback engine and `main.ts`: `phase`, `recordArmed`, `jamActive`, `passRecordState`, `lmbSounding`, `midiArmedTrackId`, loop-enabled and Lock Rail.
  - `composeToggleArmed`, `jamToggle`, `toggleRecordNextPass`, `composePerformStop` and the loop-wrap handler become transitions, with unit tests covering every transition.
  - The canvas gets **one input router** that asks the state machine whether a press performs or edits. This replaces today's capture-phase listener in `main.ts` racing the bubbling handlers in `interaction.ts`.
  - Do the Pointer Events migration here; it is the first half of 11.3.
  - Replace the stringly `curveId:idx` point-selection keys with a structured type (deferred from 15.1).
  - Phase 16 may simplify the mode set, so keep the transitions easy to reshape.
  - *Shipping in two parts.*
    - **Part 1 — state machine (done, PR #74):**
      - `src/state/transport.ts` is a pure `transition(state, event)` over one `TransportState` (mode × clock × capture), with the whole transition table under test.
      - One `transport(event)` controller in `main.ts` runs each change's side effects. It replaces `composeToggleArmed`, `jamToggle`, `toggleRecordNextPass`, `startComposePerformPlayback`, `composePerformStop` and `startPlayback`.
      - Buttons, hotkeys, the count-in, loop wraps, the AFK timer and the engine running out all dispatch events.
    - **Part 2 — input router (done, PR #75):**
      - `src/canvas/input-router.ts` holds one set of Pointer Events listeners per canvas (staff and Parameters Graph). It decides once per press whether perform, pan or the edit tools own the gesture; `routePress` is pure and tested.
      - Pointer capture keeps a press with its owner on or off the canvas, replacing the window-level mouse listeners.
      - Selected points are a typed `PointSelection` (curve id → indices) instead of `"curveId:idx"` strings. Multi-point delete moved into `deleteSelectedPoints` in `model/curve.ts`.
      - Both canvases get `touch-action: none` so pen and touch drags reach the router.
  - *Fixed in part 1:*
    - Plain Play never entered the perform phase, so a phrase held across the loop seam wasn't sealed there, and an armed MIDI track captured nothing during plain Play (help already said it would).
    - Pause or Space during a queued pass left the pass queued on a paused transport.
    - Opening a file or importing MIDI mid-session left Jam / Record flags set.
    - Scrubbing the ruler during looped playback resumed without the loop.
  - *Behaviour change:* Shift+R during an open-ended recording used to queue a pass that later disarmed the recording. It now does nothing, with a toast; R still takes over a queued pass.
  - *Fixed in part 2 (both confirmed on the old code):*
    - Alt-dragging a transform box both duplicated the curves and panned the view.
    - Releasing a tool drag outside the canvas left it stuck; later hovering with no button held kept moving the point.
  - *Behaviour changes in part 2:*
    - Alt+left while performing pans, instead of panning and sounding a note at once.
    - Alt+left on the Parameters Graph now pans too, like the staff.
- [ ] **15.3 Break up `main.ts`** *(L; keyboard map done in PR #77)*
  - **Layout:** move the HTML template into components (15.4).
  - **Keyboard map:** turn it into a **command registry**, one table of named commands with their bindings. Buttons, menus, the context menu and the help.html shortcut table all read from it.
    - **Done (PR #77):**
      - `src/commands/catalog.ts` is the one table: id, label, key chords, description. It's pure data.
      - `keys.ts` parses and matches chords; it's pure and tested.
      - `registry.ts` binds what each command does. It requires a handler for every catalog entry, and runs one keyboard listener with the typing guard, hold/release, and auto-repeat rules.
      - `edit-commands.ts` holds the Edit commands that used to be inline in `main.ts`: undo/redo, clipboard, join, group, smooth/sharpen, and the Delete cascade that was split between `main.ts` and `interaction.ts`.
      - What reads the catalog: the tool buttons, toolbar and transport buttons, File menu, context menu and all their tooltips. The help page's shortcut table is generated from it (`src/help/shortcut-table.ts`), and `help.html` is now part of the production build (it wasn't before).
    - *Behaviour changes:*
      - The D / V / X / C tool keys now do exactly what the tool buttons do: switching away from Draw ends the curve in progress and stops a Space preview. Like the buttons, they're off while the left button performs.
      - Escape backs out one level. When it stops a count-in, recording or jam, it no longer also closes the transform box.
      - Bindings match modifiers exactly (Shift+J no longer toggles Jam; Shift+Delete no longer deletes). Letters follow the keyboard layout's printed letter.
      - A disabled command's Ctrl chord still stays away from the browser (Ctrl+J with nothing selected no longer risks opening Downloads).
      - The Prism drawer tooltip wrongly said H projects; it now names both H and Ctrl+H.
  - **Render loop:** move it to a canvas module.
  - **Model edits:** inline edits in handlers (e.g. multi-point delete in the key handler) move into `model/`.
  - **Target:** `main.ts` is a bootstrap of a few hundred lines.
  - **Plan (approved 2026-10-04):** four PRs, each changing no behaviour and tested hands-on before it opens: **A** the render loop's drawing, HUDs, zoom sliders, Parameters Graph resize; **B** perform and capture (the sounding voice, Gravity clock, edge scrolling, multitouch, Keep, layers) into a `perform/` folder; **C** the transport controller, the command handlers, MIDI input, Tune A4, the track panel; **D** the layout template as Preact components, with the rest of 15.4.
  - **PR A (PR #107):** `main.ts` 3,692 → 3,077 lines.
    - `canvas/scene.ts`: `draw()` moved as it was (`createScene(deps)`: the canvases, viewport, interaction, engines, and getters for what changes), read-only.
    - `app/redraw.ts`: the redraw flags as functions (`markBgDirty`, `requestRedraw`, `redrawPending`, `takeBgDirty`), replacing `main.ts`'s `bgDirty` / `fgDirty` variables, so pieces outside `main.ts` can ask for a redraw.
    - `ui/pitch-hud.ts` (and its formatting), `ui/session-overlays.ts` (count-in number, idle warning), `ui/frame-times.ts` (Perf HUD's frame window), `ui/zoom-sliders.ts`, `ui/param-graph-resize.ts`.
    - The frame loop itself (`runFrame`, `tickFrame`, `isAnimating`) stays in `main.ts` until PR B moves the perform ticks it calls.
  - **PR B (PR #108):** `main.ts` 3,077 → 2,052 lines. Perform and capture move to `src/perform/`, as they were:
    - `performer.ts` (`createPerformer(deps)`): the sounding voice under the button or a finger, Prism harmonies, extra fingers (13.33), MIDI note voices' commits, capture each frame, edge scrolling, the perform tick (count-in, loop wrap, idle stop), and the HUD's planchette. Its ten dependencies (viewport, canvas, preview, dynamics bus, playback, held MIDI notes, rail beat, pan bound, the perform predicate, the transport controller) are explicit; `main.ts` destructures the same names it used before.
    - `gravity.ts`: cursor → pitch under Snap and Gravity, the magnetic clock, haptic steps. `capture.ts`: layers, the pass log, committing, Keep and Drop last pass. `voices.ts`: the Prism voice ids (pure).
    - Three references that reached into the moved state became calls: `fingerCount()`, `releaseAllFingers(commit)`, `forgetTrack(trackId)`. Keep and Drop in the command table are wrapped (`() => keepLastPhrase()`), since the performer is made after the table.
    - The frame loop stays in `main.ts`: what it calls is now the performer's ticks.
- [ ] **15.4 Reactive UI chrome** *(L; part 1 in PR #78)*
  - Move panels, drawers, dialogs and menus onto a small reactive component layer. The recommended default is Preact + `@preact/signals`; confirm the choice at the start of this item.
  - The canvas stays imperative.
  - Migrate one panel at a time, starting with the track list and property panels, which currently rebuild on every store change.
  - Sequence this with Phase 16 so panels aren't rebuilt twice. Migrate the panels whose shape Phase 16 won't change first.
  - **Part 1 (PR #78):**
    - Preact + `@preact/signals` confirmed (both MIT). Components read the store while rendering and re-render when those fields change, because the store's version signals are the ones `@preact/signals` tracks.
    - Migrated the track list (`ui/track-list.tsx`), Object Properties (`ui/property-panel.tsx`) and Tool Properties (`ui/tool-property-panel.tsx`). The 15.1 stopgap (`setHtmlIfChanged` plus slider values synced by hand) is gone: sliders are controlled inputs, and Preact keeps the node under the pointer.
    - Render tests use `preact-render-to-string` (dev only).
    - Also in this PR, a user request: each drawer is sized to its own controls instead of full height and a shared 240px width. Height is capped at the canvas (then it scrolls); width runs from 200px up to the canvas width.
      - The Prism label column widened so "Voice 1 (root)" no longer runs into its input.
      - The Prism toggles' tooltips come from the command catalog.
  - **Still to migrate (2026-09-27):** the tone builder and tone picker (`ui/tone-builder.ts`, `ui/tone-picker.ts`), the context menu (`ui/context-menu.ts`), the MIDI-arm and preset-save dialogs, and the Perf HUD, which still build DOM by hand or with `innerHTML`. *(16.3 moved the top bar, menus, Settings and the Tempo drawer; 16.4 the tool strip, Snap drawer and Prism panel; 13.8 the Tuning drawer.)*
- [x] **15.5 Read-only render loop + foreground dirty flag** *(M — absorbs 9.2, PR #76)*
  - The render loop currently attaches volume lanes, pins the trailing volume point during drawing, and clears a deleted Prism projection source. Move all of that into the mutation paths.
  - Add an `fgDirty` flag mirroring `bgDirty`, and cache each curve's tessellation as a `Path2D` keyed by curve identity. Idle CPU should then drop to near zero.
  - **Done (PR #76):**
    - Each frame runs `tickFrame()` (scroll-follow, perform, dynamics, magnetic, capture). The canvases redraw only when something changed or is animating, and `draw()` only reads.
    - "Changed" means a store notification, pointer or key input, or `bgDirty`. The frame-rate canvas values (planchette pitch, crossing pulse, stored playhead) notify a `canvas` channel that only the renderer reads. "Animating" means rolling, armed, a held note, or a pulse or flash still fading.
    - Idle draws nothing (`__debug.drawCount()` stays flat).
    - The store drops a Prism projection source whose curve is gone on any composition change.
    - The Parameters Graph shows a curve's default volume lane without attaching it (`displayedLane`). A press on the graph attaches it, and Draw keeps the lane end on the curve's end as it grows (`pinLaneEndToPitch`).
    - Curve paths are cached as world-space `Path2D`s, keyed by curve object and composition version, and placed with the viewport transform, so panning and scrolling playback reuse them.
    - Adding a point to an existing curve in Draw went around `store.mutate`, and so did finishing a draw. Both now go through it.
- [x] **15.6 One snap-config builder** *(S–M, PR #76)*
  - Snap config is currently built in three places that disagree: `buildSnapConfig`, `computeComposeCursorPitch`, and the free-planchette preview.
  - Make one builder used by drawing, dragging, preview, perform and guide drag.
  - Prerequisite for 12.1, which defines how gravity sources combine.
  - **Done (PR #76):** `snapConfigFor(state, { zoomX, atBeat, excludeGuideId })` in `src/state/snap-config.ts` (pure, tested), with `currentSnapConfig` over the live store. Every caller uses it.
  - *Behaviour change:* with Prism projection on, performing snaps to the echo pitches at the rail's beat, as drawing does. Before, perform ignored projection.
- [x] **15.7 AudioWorklet live voice** *(L, PR #79)*
  - The live perform voice becomes an AudioWorklet that receives pitch and gain targets and smooths them at audio rate.
  - Later, the magnetic integrator can move there too, decoupling physics from `requestAnimationFrame`.
  - Measure against the Perf HUD before and after.
  - **Done (PR #79):**
    - The worklet is a *control-signal* source, not a synth. It smooths pitch (one-pole in log-frequency, so glides are even in cents) and gain (linear ramps) per sample. Its two outputs drive the tone's native oscillators' `frequency` and the output gain. So live notes keep exactly the timbre of playback and WAV export, and the automation timeline no longer fills with an event per mouse move.
    - Files:
      - `audio/live-voice-dsp.ts`: pure, tested.
      - `live-voice.worklet.ts`: the processor, bundled via `?worker&url`.
      - `live-voice.ts`: builds voices, with a fallback to the 14.3 main-thread glide if AudioWorklet is unavailable or not loaded yet on the very first note.
      - `tone-synth.ts`: its graph is split out as `createToneGraph`, shared by both.
    - Every live voice goes through it: perform, Space preview, Prism harmonies, MIDI notes. Scheduled playback and the scrub preview stay on AudioParam automation.
    - The Perf HUD's Audio row shows the path: `live: audio thread` (or `main thread` / `loading`).
    - *Measured:* main-thread cost per pitch update is a few µs either way (≈3.5 µs for a worklet message vs. ≈1–6 µs per oscillator for `setTargetAtTime`). Frame times are unchanged, so the win is in the audio, not the frame budget. Measured pitch on the real path matches the planchette exactly (C4 261.63 Hz, A4 440.00 Hz, a performed 622.2 Hz).
    - *Not done here:* moving the magnetic integrator onto the audio thread. It still runs per frame on the main thread; the worklet is the place for it.
- [x] **15.8 Kernel test coverage** *(M; PR #106)*
  - Unit tests for snap (`snap.ts`), magnetic physics (`snap-magnetic.ts`), `bezier-math`, `curve-sampler` and the scheduler's timing math, plus 15.2's state machine.
  - **Status (2026-09-27):** the state machine (`transport.test.ts`) and snap-config are covered, and snap is partly covered through `tuning.test.ts`. Magnetic physics, `bezier-math`, `curve-sampler` and the scheduler still have no tests of their own; only the golden-format test reaches them.
  - These become the cross-runtime conformance suite in Phase 17.
  - **Done (PR #106):** 48 new tests, each file headed as kernel tests.
    - `utils/snap.test.ts`: `snapToGrid` (X grid and beat guides, the pitch grid, range clamp, pitch-line guides, pitch lines hidden, projection exclusive, pitch-guide priority), Gravity's wells (`findAdaptiveSnap`: half-gap reach on the cursor's side, the 300 ¢ cap, capture), `nearestSnapLine`, the zoom-adaptive steps.
    - `utils/snap-magnetic.test.ts` (beside 13.36's Speed tests): starts at the cursor, spring-only follow, settling between line and cursor, exactly on the line with no spring, nothing outside the well, frame-rate behaviour, the catch-up cap, the velocity cap, reset.
    - `utils/bezier-math.test.ts`: evaluation, subdivision, nearest point (world and screen-scaled), `findTForX`.
    - `audio/curve-sampler.test.ts`: `evaluateCurveAtBeat`, `sampleCurve` (rate, tempo, range, frequency), `getCurveTimeRange`, and the scheduler's timing.
    - **Scheduler:** its timing math moved out of `playback.ts` into `audio/schedule-math.ts`, pure (`PlayClock`, `beatToAudioTime` / `audioTimeToBeat`, `curveEventsInWindow`: a curve's samples and edge fades in one look-ahead window, open at its start). Same arithmetic as before; `scheduleAhead`, the position and the metronome hook use it. Tested: back-to-back windows schedule every event once, and nothing already past is rescheduled.
    - **Found:** Gravity isn't frame-rate independent to the cent, as its comments claimed. A frame's time is split into equal sub-steps of *at most* 0.02 beats, so the step size follows the frame rate: an underdamped 250 ¢ glide differs mid-way by up to ~14 ¢ between 60 and 480 fps (it settles in the same place). Frames longer than the 0.1-beat catch-up cap (slower than 20 fps at 120 bpm) also lose time. Comments corrected; both behaviours are pinned by tests. A truly fixed step (carrying the remainder to the next frame) or moving the integrator onto the audio thread (15.7's note) would make it exact. **Decided (2026-10-04): noted only.** Nobody would notice mid-glide, and below 20 fps there are bigger problems; fix it only as part of a change that makes the architecture more efficient or stable.

---

## Phase 16 — Simplify the interface

- [x] **16.1 Interface structure session** *(L, own planning session, PR #80)*
  - Produce a UI spec in [DESIGN.md › Interface principles](DESIGN.md#interface-principles) before any code.
  - **Done (2026-09-24, PR #80):** the spec is [DESIGN.md › Interface spec](DESIGN.md#interface-spec-phase-16-decided-2026-09-24). It blocks out every control as a working one. Perform's feel, the Tuning drawer and the visual theme each get their own session afterwards.
  - **Decisions:**
    - **Perform is an explicit mode that looks different.**
      - It's entered from the tool strip or with P, for now. The Perform session (16.8) may change how you enter it.
      - Perform uses the rail view, and auditions while the transport is stopped.
      - Lock Rail is retired as a mode. Scrolling during playback becomes a View option for compose mode.
    - **Jam folds into Play.** In Perform, Play is open-ended; in compose mode it stops at the end of the content unless Loop is on. J is unbound.
    - **Record is a split button.** Its menu has Record one pass, Drop last pass, New track per pass (was Layer) and Count-in.
    - **Space is Play/Pause only.** Holding A auditions, and scrubbing is audible by default.
    - **MIDI arm stays on each track**, as an icon.
    - **Scrubbing in the rail view scrolls the content live**, so the playhead is always the rail beat.
    - **Top bar:** menus, small Undo/Redo icons, the transport, and Snap and Loop side by side. Tempo and the metronome move to a new Tempo drawer.
    - **New menus and dialog:** an Edit menu (new), a View menu (the HUDs and scroll option), and a Settings dialog (MIDI device, audible scrub).
    - **Drawers:**
      - Snap and Tuning **stay separate**.
      - The Tools drawer becomes an always-visible strip.
      - The Transport drawer is split up.
      - Magnetic is renamed **Gravity**.
      - Prism's "Tuning" field becomes Intonation.
    - **Right panel:** Tool / Object Properties become Tool / Selection, track-row letters become icons plus a ⋯ menu, and groups become visible (13.12).
    - **Every colour moves to named theme tokens** before the theme session.
  - **Inputs from the review** (kept for the record; the decisions above supersede them where they differ):
    - **One capture model.** The rolling buffer always runs while the transport rolls, so Jam folds into Play, Keep is always available, and Record = keep everything. Record-next-pass, Layer and MIDI-arm become options of one capture control.
    - **Visible perform state.** If the left mouse button performs instead of edits, that is an explicit, visible Perform state, not something implied by Lock Rail + transport.
    - **A Gravity panel** merging snap and tuning. *(Rejected: they're used at different times.)*
    - **Tools always visible** as a strip, not in a drawer.
    - **A View menu** next to File: Pitch HUD, Perf HUD, guide visibility, user manual. *(Guide visibility stays in the Snap drawer, because hiding guides also stops them pulling.)*
    - **A Settings dialog:** MIDI device, dynamics source, metronome volume, other preferences. *(Dynamics went to Perform's tool settings; metronome volume to the Tempo drawer.)*
    - **Each control exists once.** Loop was in both the top bar and the Transport drawer.
    - **Clear names.** The "Tuning" collision; the single-letter M S I T X track buttons.
    - **Space key.** Tap-vs-hold (250 ms) for transport vs. preview.
    - **Scrubbing with Lock Rail on** (found in 15.2 testing): scrubbing moved only a stored playhead that the Lock Rail view never shows, and Play started from the rail beat anyway.
    - **Group visibility** — see 13.12.

Implementation comes first: block out every control so it works, then hold the design sessions. Each implementation item moves the chrome it touches onto Preact components (finishing 15.4's "still to migrate") and updates [help.html](help.html) in the same PR. Suggested order: 16.2 → 16.3 → 16.4 → 16.5, with 16.6 and 16.7 at any point.

- [x] **16.2 Perform mode + one capture model** *(L, PR #81)*
  - **Perform mode:**
    - An explicit Perform mode, entered from a Perform button in the tool strip or with P, for now.
    - The input router asks the mode, not Lock Rail plus the transport, whether a press performs.
    - Perform uses the rail view; entering it snaps the rail onto the playhead.
    - Perform while stopped auditions.
    - Record enters Perform.
  - **Transport (`state/transport.ts`):**
    - Fold the jam clock into Play: open-ended while in Perform.
    - Remove J and the Jam button.
    - Make Pause a real pause in Perform.
  - **Retire the Lock Rail switch.** *Scroll canvas during playback* becomes a workspace preference, with a temporary toggle until 16.3's View menu. Migrate the saved `scrollCanvasEnabled` value to it.
  - **Scrubbing in the rail view** scrolls the content live under the rail.
  - **Done (PR #81):**
    - `AppState.performMode` is the one answer to "does the left button play?" (`isPerformInputActive`). The rail view shows in Perform, with *Scroll during playback* on, or while a recording runs.
    - The transport's jam clock is now the `open` clock. Play in Perform is open-ended; entering Perform mid-play sends `open-clock`. Pause is a real pause for any playback; only capture ends instead. J, the Jam button and `toggle-jam` are gone.
    - While stopped, Perform auditions: the planchette and Prism harmonies sound with magnetic feel, but capture needs a rolling transport, so nothing lands in the Keep buffer.
    - Record and Record-one-pass enter Perform first.
    - *Where the button went:* the Perform button (P) sits in the top bar where the Lock Rail switch was, because the tool strip doesn't exist until 16.4. The tool buttons light none while in Perform, and picking a tool leaves Perform.
    - *Visible state:* the Perform button lights up and the canvas gets a violet frame. That's a first cue only; 16.8 designs the real one.
    - *Scrubbing:* a ruler press brings the clicked beat under the rail, and dragging then scrubs from there (right is forward). The ruler maps the cursor as it was at the press, so the scrolling doesn't feed back. The rulers now scrub in Perform too, but are inert while a recording runs.
    - *Decided while building:*
      - Escape backs out one level: it stops a count-in or recording, and otherwise leaves Perform.
      - Leaving Perform is refused while a recording runs (with a toast) and while a note is held.
      - When stopped, leaving Perform puts the stored playhead where the rail was.
    - *Not migrated:* the old Lock Rail preference (`slidesynth.scrollCanvas`) is dropped rather than carried over, because it also meant "perform while playing". *Scroll during playback* starts off.
    - *Fixed along the way (found in testing):*
      - **Prism chord voice 0 was ignored when performing.** Perform and the Space-hold preview put the primary voice at the cursor, assuming chord voice 0 has offset 0. That's false for a symmetric chord, which centres on the cursor, and for a root octave offset (8.13). So a symmetric triad sounded and recorded its middle voice twice and never its lowest. Draw was right all along. The primary planchette still tracks the cursor (magnetic, HUD); what it sounds, records and draws on the rail adds voice 0's offset (`primaryChordOffset`).
      - **Harmony planchettes froze on the rail** when the pointer left the canvas; only the primary was cleared.
      - **The Draw tool's hover overlays** (the chord preview dots, the preview line, the Slice marker) froze where Perform was entered.
- [x] **16.3 Top bar, menus, Settings, Tempo drawer** *(M–L, PR #82)*
  - **Top bar:**
    - the transport, with the Record split button and its menu, and Keep;
    - Snap and Loop side by side;
    - small Undo/Redo icons;
    - a Settings gear.
  - **Edit (new) and View menus**, generated from the command catalog.
  - **Settings dialog:** MIDI device, audible scrub.
  - **Tempo drawer:** BPM, time signature, metronome and its volume.
  - The Transport drawer goes away.
  - **Done (PR #82):**
    - **Top bar** (`ui/top-bar.tsx`): a Preact component made of small parts that each read only what they show. Left to right:
      - name and length;
      - File, Edit and View menus;
      - Undo and Redo arrows;
      - Perform;
      - Stop, Play/Pause (now one button), Record ▾, Keep;
      - Snap and Loop;
      - the Settings gear.
    - Every button runs its catalog command. The Keep button reads a polled `keepable` signal.
    - **Menus** (`ui/menu.tsx`) are lists of command ids.
      - Each item shows its label and shortcut, greys out when `enabled()` is false, and shows a check mark from the registry's new `checked()`.
      - Pointing across the bar switches between open menus.
      - Escape closes the menu and goes no further.
    - **Record ▾** holds Record one pass, Drop last pass, New track per pass and Count-in.
    - **New commands:** `transport.layerMode`, `transport.countIn`, `view.pitchHud`, `view.scrollDuringPlayback`, `app.settings`. They have no keys; the settings among them are checkable.
    - **Count-in** is a preference, on by default. With it off, R from a stop records straight away; the transport's `toggle-record` event carries it.
    - **Settings** (`ui/settings-dialog.tsx`): MIDI input device and Audible scrub (on by default). The scrub half of 16.6 is done here.
    - **Tempo drawer** (`ui/tempo-panel.tsx`): BPM (clamped, one undo step), time signature and the metronome. It replaces the Transport drawer, whose other contents moved as specified.
    - **Dynamics** moved to Tool Properties, shown while in Perform (the 16.5 placement, pulled forward because its drawer went away).
    - *Also:*
      - Copy, Cut, Paste, Duplicate, Continue and Delete now say when they can act, so the Edit menu greys them out.
      - Loop (L) is refused while a recording runs, matching its button.
      - Loop-marker dragging reads Loop from the store, not from the old drawer checkbox.
      - Below ~1150 px wide, the Perform button joins the top-bar row instead of centring over the canvas, where it would cover the menus.
- [x] **16.4 Tool strip, Snap / Prism renames** *(M, PR #83)*
  - **Tool strip:**
    - It replaces the Tools drawer.
    - It can take over the Perform entry (a top-bar button since 16.2), unless 16.8 decides otherwise.
    - It shows the Prism chord badge on Draw and Perform.
  - **Snap drawer:** Magnetic becomes Gravity.
  - **Prism drawer:** "Tuning" becomes Intonation.
  - The Tuning drawer is untouched until 13.8.
  - **Done (PR #83):**
    - **Tool strip** (`ui/tool-strip.tsx`) in the left rail, *below* the drawer icons and a divider (the user's call; the spec had it above):
      - Draw, Select, Delete and Slice as icons, plus the Perform entry, which moves here from the top bar. Each runs its catalog command.
      - The lit tool follows the store. In Perform, Perform is lit (violet) and no tool is. A recording keeps Perform lit but unclickable.
      - Every button greys out while the left button is sounding (a per-frame `toolsLocked` signal).
      - While Prism Draw is on, Draw and Perform carry a rainbow **chord badge** with the voice count; its tooltip names the chord.
      - The Tools drawer, its icon and the old `tool-panel.ts` are gone. The top bar's centre zone (and its narrow-window fallback) went with the Perform pill.
    - **Snap drawer** (`ui/snap-panel.tsx`, now Preact): Magnetic is **Gravity** in the switch, tooltips, the preset toast and the help. The store and file fields keep their `magnetic*` names. Preset matching takes just the three feel values (`SnapFeel`).
    - **Prism drawer** (`ui/prism-panel.tsx`, now Preact): the chord's "Tuning" is **Intonation**, with options Equal (12-TET) and Just.
    - `CommandButton` moved to its own module so the top bar and the strip share it.
- [x] **16.5 Right panel, track rows, groups** *(M, PR #84)*
  - **Right panel:** the sections become Tool and Selection. The dynamics choice moves to Perform's Tool section.
  - **Track rows:** Mute, Solo and MIDI arm become icons; Edit tone and Delete move to a ⋯ menu.
  - **Groups:** 13.12's UI half:
    - the group line and Ungroup button in Selection;
    - Ungroup on the transform box;
    - the shared outline on the canvas.
  - **Done (PR #84):**
    - **Right panel:** the sections are **Tool** and **Selection**. (Dynamics already moved to Perform's Tool section in 16.3.)
    - **Selection** names what's selected above the track: *Group of n curves*, *Curve*, or *n curves* (", some grouped" when mixed), with an **Ungroup** button whenever a selected curve is grouped. Move to track stays for one movable unit.
    - **Track rows:** Mute (speaker), Solo (headphones) and MIDI arm (MIDI socket) are icon toggles with `aria-pressed`; Edit tone… and Delete track sit in a ⋯ menu (`ActionMenuButton` in `ui/menu.tsx`, fixed to the viewport so the panel doesn't clip it). The letters M S I T X are gone.
    - **Transform box:** an Ungroup pill beside its top-right corner when it holds a group (not for a point selection). It runs `edit.ungroup`.
    - **Group outline** (`canvas/group-outline.ts`): a dashed amber outline around every group with a hovered or selected member, on the active track. A hovered, unselected group is labelled *Group · n*. Hover is hit-tested against grouped curves only, in Select.
- [x] **16.6 Space and audition** *(S, PR #85)*
  - Space becomes Play/Pause only.
  - Holding A auditions: the Draw preview, and a Y guide's pitch while dragging it (absorbs 13.6).
  - ~~Scrubbing is audible by default; *Settings › Audible scrub* turns it off.~~ Done in 16.3.
  - **Done (PR #85):**
    - **Space** (`transport.playPause`) acts on the press: play, pause, stop a recording, or cancel a count-in. No hold, no 250 ms timer; auto-repeat is ignored.
    - **A** (`preview.audition`, a hold command) auditions:
      - in Draw (not Perform), the cursor's pitch — both Draw Preview modes, Prism chords included;
      - while dragging a Y guide, the guide's pitch on the active track's tone, retuned as it moves (13.6).
    - The audition re-syncs every frame while A is held, so it picks up a guide drag that starts mid-hold and the cursor coming back onto the canvas. Nothing sounds while a recording is armed. Losing window focus stops it (the keyup would never arrive).
    - The old Space-hold ruler scrub preview is gone; audible scrubbing (16.3) covers it.
- [x] **16.7 Theme tokens** *(M, PR #86)*
  - Move every colour onto one set of named tokens. Today there are ~130 literal colours across `styles/*.css` and ~60 in the canvas renderers and `constants.ts`. The canvas should read the same tokens as the CSS, not a parallel list.
  - No visual change; it's the groundwork that lets 16.9 restyle the app without touching layout or logic.
  - **Done (PR #86):**
    - **`styles/theme.css`**, linked first by index.html and help.html, defines every colour as a token.
      - Channels: `--accent-rgb` and the like, for alpha variants.
      - Chrome: surfaces, text, borders, states (record, solo, danger, gold, perform, …).
      - Canvas: staff, rulers, points, transform box, group outline, marquee, guides, loop, playhead, planchette, metronome flash, the Prism spectrum, the Parameters Graph.
    - **CSS:** main / panels / dialogs use only `var()`. The colour variables left main.css's `:root`; its layout variables stayed. help.html dropped its own copy of the palette, keeping a lighter dim text as `--help-text-dim`.
    - **Canvas:** `src/theme/theme.ts` lists the canvas tokens (`CANVAS_TOKENS`) and resolves them once at startup (`loadTheme()`, through a probe element, so `rgba(var(--x-rgb), a)` works). Renderers call `themeColor(token)`; `prismSpectrum()` replaces `PRISM_RAINBOW_STOPS`. The module-level colour constants (guide, loop, planchette, echo) are gone.
    - **Components:** the tone fallback, the toast and the scissors dot use tokens too.
    - **Guard** (`theme.test.ts`): no colour literal outside theme.css, except the preset tones' colours, a new tone's default and the missing-token magenta; no `var()` without a definition; every canvas token defined. Vitest now loads `styles/*.css` (`test.css.include`) so the test can read them.
    - Values are unchanged, so nothing looks different.
- [ ] **16.8 Perform experience** *(L, own planning session — after 16.2)*
  - **Before starting, decide on 13.11's Old fit switch** (reminder, 2026-09-28): this session redesigns Perform's settings, where the switch lives. Removing it first (`recordFitLegacy`, `legacyCurveFromRecording`) keeps it out of the redesign.
  - Make Perform feel like picking up an instrument, not sitting down in an airplane cockpit: a musical instrument with a recording studio attached, visually distinct from the compose DAW.
  - **Session inputs:**
    - how you enter and leave it: a strip button, a top-bar switch, a key, a transition;
    - a "stage" view that clears the edit chrome and brings the capture controls forward;
    - the rail drawn as the instrument itself, e.g. a string or slide with snap targets as detents. Keep H.3 in mind: what the haptic slide lets you feel should be what you see;
    - a clear user-facing name for the dynamics source (today's "Dynamics: Fixed / Key swell").
- [ ] **16.9 Visual theme** *(L, own planning session — after 16.2–16.7)*
  - Replaces the default dark-blue theme, which was never designed.
  - **Direction to explore:** a fusion of Tron-style neon and the Italian Renaissance (synthwave + glissando).
  - **Ornaments:** hand-designed vector scrollwork or arabesques, to give GUI elements a unique look.
  - **Start with mockups:** two or three directions on one screen (top bar, rail, a drawer), compared side by side.
  - Builds on 16.7's tokens. The ornaments are SVG assets through the icon pipeline (PR #59).
- [ ] **16.10 Small-screen layout** *(M–L, own planning session — added 2026-10-04; with or after 16.8 and 16.9)*
  - A layout for phones (and other small screens) that gives the canvas as much length as it can and simplifies the panels.
  - From testing multitouch (13.33) on a phone: the screen only has room for 3 or 4 fingers, so every pixel of canvas counts.
  - **Wanted:**
    - **maximize the canvas's length** (pitch travel; portrait is the phone's performing orientation);
    - **consolidate the top bar with the left** tool strip and rail icons, into one strip;
    - **hide the volume and parameter panes** (the Parameters Graph below the canvas);
    - **simplify the panels**: the right panel and drawers.
  - **Session inputs:**
    - when it applies: screen size (`max-width` / `pointer: coarse` media queries), a manual switch, or both;
    - what stays reachable and where: transport, Keep, Record, Snap / Gravity, the track and tone, tuning;
    - how the hidden panes come back when wanted (a drawer, an overlay, a tab);
    - Perform only, or editing too (13.27 decides how far editing goes on touch);
    - fits with 16.8's "stage" view (they may be the same thing on a phone), 16.9's theme, and 13.34's piano-roll orientation.

---

## Phase 17 — Portable core

Required before any VST, VCV or hardware work starts (see [Horizon](#horizon-thinking--not-ready-to-build)).

- [ ] **17.1 Isolate `src/core/`** *(M)*
  - **Before starting, decide on 13.11's Old fit switch** (reminder, 2026-09-28): the recording fit is curve math bound for the core; removing the old RDP path (`legacyCurveFromRecording`) first keeps it out of the core, 17.2's conformance suite and any port.
  - Holds cents/music math, curve evaluation + sampling, snap + magnetic physics, the gravity-map types and the `.gliss` codec.
  - No DOM, store, audio or canvas imports. Enforce this with a lint rule or a tsconfig project reference.
- [ ] **17.2 Conformance suite** *(M)*
  - The golden-format fixtures plus 15.8's kernel tests become the spec every runtime must pass.
  - Include 12.3's round-trip preservation test.
- [ ] **17.3 Shared-codec decision** *(S, own planning session — when the first port begins)*
  - Choose one of:
    - a shared C++ core, used natively by the plugins and via WASM in the browser;
    - Rust with a C ABI, plus WASM;
    - a language-neutral spec that each runtime implements independently.
  - "One spec, ideally one codec — not three parsers."

---

## Queued features

Resumed 2026-09-26 (see [Current direction](#current-direction-updated-2026-09-27)). Grouped by area; roughly easiest-first within a group.

### Editing & canvas
- [ ] **13.4 Pitch ruler down the left edge** *(M — may be obsolete, 2026-09-27)*
  - **Revisit before building:** its main reasons are gone. 13.5 was covered by 13.17's corner handle, and since 13.8 (b) the staff labels its own lines with the tuning's note names, thinned by zoom. Build it only if a separate strip still earns the canvas width it costs; otherwise close it.
  - Note names and octaves with adaptive label density, mirroring `getAdaptiveBeatStep`.
  - Respects Key, including true-None mode, and the Tune A4 setting (`centsToNoteName`).
  - The ruler costs canvas width, so every hit-test that assumes X starts at 0 needs the same treatment `RULER_HEIGHT` gets on the Y side.
  - Prerequisite for the Y half of 13.5.
- [x] **13.5 Create guides by dragging out of the rulers** *(M — done by 13.17's handle, PR #93)*
  - Drag down from the top ruler to create an X guide; drag out of the pitch ruler (13.4) to create a Y guide. Release back over the ruler to cancel.
  - Reuse the existing guide-drag path, including self-excluding snap.
  - A click without a drag still scrubs the playhead. The Add buttons stay as the keyboard-reachable path.
  - **Revisit (2026-09-26):** the ruler is now also the scrub strip (audible by default, 16.3), so a drag out of it is ambiguous. Frets (Y guides) get a dedicated handle instead (13.17). The X half can use the same kind of handle, if a ruler drag still conflicts when this is built.
  - **Covered (2026-09-27):** 13.17's one handle gives both: drag down for a fret, right for a beat guide.
- [x] **13.6 Audition a Y guide's pitch while dragging** *(S — done in 16.6, PR #85)*
  - Sounds the snapped pitch on the current track's tone. Sequence after 13.5.
  - **Absorbed by 16.6** (2026-09-24): the key is hold A, not Space. Y guides can already be dragged, so this doesn't need to wait for 13.5.
- [x] **13.9 Octave highlight follows the key root** *(S — done in 13.8 (b), PR #89)*
  - The staff highlights C lines to show octaves. In a key without C (e.g. G♯ harmonic minor) there's no octave marker at all.
  - Highlight the key's root instead.
- [x] **13.11 Recording simplification density** *(M–L — planning session held 2026-09-28; PR #102)*
  - A setting to keep all recorded points, or 1/2, 1/4, 1/8, instead of today's fixed RDP fit.
  - Option to run simplification later on a kept curve (relates to 12.4 raw takes).
  - **Spec:** [DESIGN.md › Recording fit spec](DESIGN.md#recording-fit-spec-1311-decided-2026-09-28) (planning session 2026-09-28). Decided: a least-squares fitter with sloped handles replaces RDP with flat handles; one **Accuracy** slider (2–40 ¢) instead of 1/2, 1/4, 1/8 fractions; a **Simplify** command refits existing curves (whole, or the selected span). The earlier attempt was never committed: denser RDP looked worse because every point had flat handles.
  - **Done (PR #102):**
    - **`model/fit.ts`** (pure, tested): `fitSamples` (least-squares cubic Hermite fit, handles at ⅓ of each segment so time is linear; greedy point insertion at the worst sample, a knot's own sample counting too; an overshoot guard (Fritsch–Carlson on segments whose samples only rise, fall or hold) with a refit of values after it; a pruning pass that removes points whose neighbourhood refits within tolerance; banded Cholesky solve), `knotsToLanePoints`, `simplifyLane` / `simplifyCurve` (refit from the lane's own shape at 64 samples a beat, whole or a span with its end values and slopes held; never adds points).
    - **Shape pass** (added in testing: the user found sloped points at random places on a vibrato hard to edit, and held notes slightly bent): `findHolds` (band capped at 10 ¢ for pitch, no drift, ≥ ¼ beat) and `findTurns` (reversal > 2 × Accuracy) place points with level handles first; they're never pruned; pinned values and slopes come out exact. Sloped points added after go at least ⅓ into their gap and ≥ 1/16 beat from neighbours (they had clustered on the sample beside a level point).
    - Measured on synthetic takes (old → new at 8 ¢): straight octave glide 133 ¢ → 0 ¢ off with 2 points; wobbly glide 78 ¢ → 8.6 ¢; leap into a hold 43 ¢ → 4.9 ¢, holds exactly flat, no overshoot; vibrato 5.4 ¢ with 22 points → 0.4 ¢ with 22, its 20 inner points on the peaks and troughs with level handles. A minute-long take fits in well under 0.2 s.
    - **`curveFromRecording(samples, { accuracyCents, legacy })`**: the fitter for pitch (at the Accuracy) and volume (0.04); the performance engine reads the fit from the store when a take is kept; MIDI import uses the default.
    - **Accuracy** (`recordAccuracy`, workspace pref, default 8 ¢): a slider in Perform's settings and Select's.
    - **Simplify Curve** (`edit.simplify`, Alt+Shift+S): Edit menu, right-click menu, Selection panel. Selected points: the span between the first and last on each curve. One undo step; a toast when nothing can be thinned.
    - **Kept for now (decided 2026-09-28):** "Old fit (testing)" in Perform's settings (`recordFitLegacy`, the old RDP path `legacyCurveFromRecording` in `curve.ts`), in case something else turns up. The new fit is meant to be permanent. **Reminder:** decide whether to remove it before starting 16.8 or 17.1 (both entries carry the reminder).
  - **Revisit the simplifier itself (2026-09-27):** find an algorithm that's adjustable and fits the recorded motion more accurately than today's fixed RDP fit (for example, curve fitting that places Bezier handles, rather than keeping a subset of points). An earlier attempt, with a less capable agent, was abandoned because it didn't work well; look at why before starting. Pairs with 13.26: fewer, better-placed points leave less wobble to nudge.
- [x] **13.24 Transform by interval** *(S, PR #98)*
  - The transform box moves a selection up or down an octave. Offer other intervals too: a third, fourth, fifth, and the Prism chord's own intervals, in the current tuning's steps (as the Prism counts them, 13.8 (b)).
  - With Alt+drag duplicate, that makes a harmony copy you can hear and edit, the explicit version of a projection echo (13.25).
  - **Decide when building:** where the choices live (a menu on the octave buttons, or a stepper beside them), and whether an interval move of several curves counts from each curve's own note (Per note, 13.21) or moves them all by the same cents.
  - **Done (PR #98):**
    - **Move by** (Tool panel, while Select is active): One step, Minor 2nd … Major 7th, Octave (the period in non-octave tunings, "Period (3/1)"). A workspace pref (`moveInterval`), octave by default. The transform box's arrows move by it, with its short name beside them ("P5") when it isn't the octave.
    - **Each curve counts from its own note** (`moveIntervalCents` in `tuning.ts`): the interval from the tuning's note nearest the curve's first point (first selected point for a point selection), as the Prism counts: a 12-note octave table by its notes, other tunings the nearest step. So curves on the tuning's notes land on them; one between notes keeps its offset.
    - **Alt+click an arrow** moves a copy (`duplicateCurves({ inPlace })`) and selects it, so the next click stacks another voice. One undo step either way. Point selections just move.
    - **Commands:** Move up / down by interval (Shift+↑ / ↓) and Copy up / down by interval (Alt+Shift+↑ / ↓), in the Edit menu. `moveSelectionByInterval` in `interaction.ts` serves the arrows and the commands.
    - *Behaviour change:* the octave arrows used 1200¢ in every tuning and could push a curve past the pitch range; they now use the tuning's period and clamp to the range.
    - Not done: a "copy to each chord voice" action (13.25 lists it as what removal of Projection would miss).
- [x] **13.26 Area Nudge tool** *(M — planning session held 2026-09-27; PR #101)*
  - **Spec:** [DESIGN.md › Area Nudge spec](DESIGN.md#area-nudge-spec-1326-decided-2026-09-27). Decided: a **Nudge** tool (N); the brush reaches **along time on the one curve you press**; raised-cosine falloff; **never snaps**; **Moves: Pitch / Time / Both**, with points never passing each other in time; **Push** and **Smooth** modes, both built now. The mouse wheel stays on zoom (considered for brush size, and dropped).
  - **Done (PR #101):**
    - **`model/nudge.ts`** (pure, tested): `nudgeWeight` (raised cosine), `pushCurve` (absolute from the stroke's starting points, so a drag can go back and forth; handle tips move by the field at their own place; in time, a sweep from the side the drag heads stops each point just short of the next, so nothing passes and points out of reach never move; nothing before beat 0), `smoothCurve` (one step toward the neighbours' average in pitch or midpoint in time, ends fixed, then Catmull-Rom-style handles along the new slope at the shared handle length; flat auto-smooth handles would put a ripple in a sloped glide), `pointsInReach`.
    - **Tool:** `nudge` in the strip after Select (new `nudge.svg`), `tool.nudge` (N), and `nudge.smaller` / `nudge.larger` ([ / ], ×1.2, only while Nudge is the tool). Switching to Nudge drops the transform box.
    - **Stroke** (`interaction.ts`): a press picks the curve under it on any shown track (the active track follows; the curve is selected); Push works from the press point and reach fixed at the press, Smooth from the cursor, by how far it rubbed. Shift locks Both to its main axis. One undo step per stroke; a press that moves nothing leaves none.
    - **Brush on the canvas** (`canvas/nudge-brush.ts`): a band over the reach, brightest at the centre, and the points in reach lit by weight. Tokens `nudge-band`, `nudge-band-edge`, `nudge-point`.
    - **Tool panel:** Mode (Push / Smooth), Moves (Pitch / Time / Both), Size (8–600 px), Strength (Smooth only). Workspace prefs.
    - **After testing:** defaults Push, Both, 100 px, 0.50. The band and lit points follow the brush during a stroke (the stroke now tracks the cursor; Push lights the points it's moving, by their starting weight), and a thin ring round the cursor shows the size (`nudge-ring`). Nudge's cursor is the raw one, so the ring sits on the pointer and the HUD reads the unsnapped pitch.
  - A transform tool that moves only the points of a curve near the cursor, with an adjustable **falloff**: points at the cursor move fully, farther ones less, out to a radius, like a soft-brush nudge or proportional editing.
  - For adjusting part of a complex curve smoothly. A curve recorded with gravity snapping carries the spring's wobble as many points, and moving a few of them by hand leaves jagged edges. The nudge moves an area and keeps a smooth glissando on either side.
  - **Session inputs:**
    - the falloff: its shape (smooth, linear, sharp), its radius (in beats, pixels or both), and how it's adjusted (a slider, the scroll wheel while nudging, a ring drawn round the cursor);
    - which axes: pitch only by default, time too (with Shift constraining, as elsewhere), and keeping points in time order;
    - handles: whether Bezier handles move with their points, or are recomputed (auto-smooth) after the nudge;
    - scope: the selected curves only, or any curve under the brush; and what a nudge does to other lanes (volume stays time-locked, as with the transform box);
    - one undo step per drag;
    - relation to 13.11 (fewer recorded points to start with) and to 12.4 raw takes.
- [ ] **8.4 Parameter lanes UI — remaining** *(M, own planning session)*
  - The Parameters Graph below the canvas shipped in PR #58, showing the selected curve's volume lane.
  - Remaining: more lane types (pan, cutoff, per-layer mix), show/hide/solo per lane, and a lane picker.
  - Inherits the "functional curve, lane-agnostic gravity" framing from the lanes model.
- [ ] **13.27 Mobile and touch support** *(L, own planning session — added 2026-10-03; DEFERRED until after the UI redesign, 16.8 and 16.9)*
  - Play and edit on a phone or tablet with fingers.
  - **Deferred (2026-10-03):** it amounts to a whole second interface, so it waits for the redesign. Until then, keep it in mind so it doesn't get harder: see the touch note in [Housekeeping](#housekeeping).
  - **Already in place:** the canvases run on Pointer Events with `touch-action: none` (15.2), so a one-finger drag already reaches the input router.
  - **Tested on touch (2026-10-04, an Android phone and a large Wacom Intuos, on the 13.28 test build):** far more works than expected.
    - **Navigation mostly works:** the zoom sliders, dragging in the ruler, and playing a note to the canvas edge to scroll, with a few bugs.
    - **Performing works.** The Tuning and Snap panels are easy to use.
    - **Portrait is better for performing on a phone:** it gives the most travel across pitch. Zoomed to about 1.5 octaves there was plenty of room to hit notes and to scroll up and down at the edges; one finger moves easily up and down with the rail snapped to the middle, and there's room for the left and right panels.
    - **Bugs found:** in portrait on a phone, most transport buttons disappear; the pitch zoom slider ends up near the middle of the screen (both 13.32). On the large touchscreen the sliders were well out of the way.
    - **The biggest want: multitouch** (13.33). Also wanted: a rotated piano-roll canvas (13.34), haptic clicks on snap lines (13.35), faster gravity without vibrato (13.36).
    - **Drawing and editing don't work well.**
    - **No pinch to zoom** (decided): the zoom sliders are the way to zoom; they need a better layout instead, since they get in the way of performing on a small phone screen (13.32).
  - **Session inputs:**
    - scope: tablets first, or phones too; Perform only, or editing as well (Perform already works);
    - gestures: two-finger pan, long-press for the right-click menu (not pinch to zoom: decided against);
    - no hover: what replaces hover previews (Nudge's band, tool highlights, the cursor ring);
    - keyboard-only actions need on-screen controls: audition (A), swell (F), Keep (K), Shift and Alt modifiers, `[` / `]`;
    - layout at phone width: the right panel and drawers, the tool strip, the top bar (now 16.10, Small-screen layout); ties to 16.9's visual theme;
    - hit targets: larger points and handles for a coarse pointer (`pointer: coarse`);
    - Perform: a finger per voice (multitouch polyphony; the engine already keys phrases by voice), and touch as the instrument in 16.8's "stage" view;
    - platform limits: iOS needs a user gesture to start audio, AudioWorklet support and latency on mobile, and no Web MIDI in iOS Safari;
    - relation to 11.3 (pen pressure and tilt share the Pointer Events path).
- [x] **13.32 Phone layout fixes: zoom sliders, transport** *(S — added 2026-10-04; PR #104)*
  - Found testing on a phone (13.27). Pulled forward from 13.27: small, and it helps the touch use that already works.
  - **Zoom sliders on the canvas's edges** (decided): they float over the canvas's bottom-right corner and get in the way of performing on a small screen; in portrait the pitch slider lands near the middle of the screen. Move them to the edges, like scrollbars: time along the bottom, pitch down the right side, never over the canvas. Zoom stays on the sliders (no pinch to zoom).
  - **Transport in portrait:** on a phone in portrait most of the transport buttons disappear. They need to stay reachable (wrap, shrink, or move).
  - **Done (PR #104):**
    - The zoom sliders moved out of the canvas into strips along its edges (`#zoom-y-gutter` down the right side, `#zoom-x-gutter` along the bottom, inside a new `#canvas-row`), each slider running the strip's whole length, so they're longer (finer) as well as out of the way. `#canvas-container` is still exactly the canvas, so nothing that measures it changed. The strips are 18 px, 28 px on a touch screen (`pointer: coarse`).
    - The transport was hidden, not gone: the top bar's right zone never wrapped, so on a narrow screen it slid under the menus. The bar now wraps, and the right zone drops to its own line when there's no room (all 13 buttons reachable at 375 px wide).
- [x] **13.37 Touch-friendly defaults** *(S — added and done 2026-10-04; PR #104)*
  - From touch testing, fine without touch too: the app **opens in Perform**; **Scroll canvas during playback** is on by default (an explicit saved choice is kept); a **new composition starts in 12-EDO, root C, Major** (`NEW_COMPOSITION_SCALE`). A file or MIDI import with no snap settings still gets All notes, as before.
- [x] **13.33 Multitouch: play several notes at once** *(M–L — added 2026-10-04, planned 2026-10-04; the user's biggest touch want; PR #105)*
  - Each finger on the canvas plays its own voice in Perform. Doesn't need the rest of 13.27 first.
  - **Decided (2026-10-04), a first version to refine in testing:**
    - **Touch only, Perform only.** The mouse and pen work as today: the first finger (or the mouse) is the `primary` voice, with everything it has now (Prism, pitch HUD, hover). Each further finger is its own voice (`touch-1`…), with its own Gravity, haptic clicks and rail marker; fingers start and stop independently. Editing (the Draw tool and the rest) ignores extra fingers.
    - **Limit: 10 fingers** (to see how a phone copes; each is its own audio-thread voice). An eleventh is ignored.
    - **The Prism applies only to the first finger, and Prism Draw mode ignores extra fingers.** The Prism may turn out not to suit multitouch.
    - **Recording:** each finger's take is its own ungrouped curve, finalized when that finger lifts, like a MIDI note. Fingers can't be told apart (a lifted finger's slot is reused), so nothing is grouped by finger.
    - **Keep** takes the last "hand": every take that overlapped in time with the newest one (all the fingers that were down together), each as its own ungrouped curve, in one undo step; pressing again steps back a hand. A Prism chord still keeps as one group. Keep may need to work more like MIDI recording; see in testing.
    - **Edge scrolling:** any finger near the top or bottom edge scrolls, the one nearest the edge sets the speed, and fingers at both edges cancel out. Every held note glides with the view.
    - **Pitch HUD:** the newest finger's note.
    - **No pressure** for now (most devices don't report it); the dynamics bus (Swell) applies to every finger.
  - **Done (PR #105):**
    - **Router** (`input-router.ts`): while a performing press is in progress, a touch that would perform joins as an extra finger (`joinsAsFinger`), with its own pointer capture, moves and release; it never moves the primary's planchette. Mouse, pen and the rulers are unchanged.
    - **Fingers** (`canvas/fingers.ts`, `main.ts`): each extra finger gets the lowest free voice `touch-1`…`touch-9` (`allocateFingerVoice`; the primary is the tenth), a planchette, a live voice, its own Gravity state (`computeComposeCursorPitch` takes the finger's), haptic hysteresis (`hapticFollow`) and cross flash. Gravity ticks every finger each frame. Fingers can't leave Perform mode while held. Releasing the primary now stops only its own voices (it used to stop every planchette's, which also cut held MIDI notes on an armed track).
    - **Recording:** a finger's take is closed on lift and, while capturing, committed as its own curve (`commitFingerTake`), as its own pass in the pass log. Loop wraps and a cancelled pass seal held fingers' takes (`sealFingerTakes`); ending a session releases them.
    - **Keep:** the engine's phrases record when they opened (`openedAtMs`), and `keepHand` keeps the newest take plus every take overlapping it, directly or through another. `commitFinalizedCurves` groups only a Prism chord (`isPrismChord`), never fingers.
    - **Edge scrolling:** `edgeScrollStep` combines every held finger; the HUD follows the newest finger (`hudPlanchette`).
    - Rail markers for extra fingers use the ordinary planchette colour: a voice isn't a finger, so a colour per voice would suggest an identity the fingers don't have.
  - **Tested on a phone (2026-10-04): works very well.** The screen only fits 3 or 4 fingers, hence 16.10 (Small-screen layout).
  - **Gestures (added after testing):** the user ran into system gestures on Android, Windows and a Wacom tablet. A page can't turn those off (they're device settings; the user turned most off there). What the app can do, done:
    - **browser gestures off everywhere**, not only on the canvases: `overscroll-behavior: none` (pull to refresh, swipe back), `touch-action: pan-x pan-y` on the body (no pinch or double-tap zoom; panels still scroll), no text selection or long-press callout outside text fields, and no browser long-press menu (`ui/touch-guard.ts`; a mouse's right-click is untouched);
    - **Full screen** (`view.fullscreen`, a top-bar button and View menu entry; `ui/fullscreen.ts`): hides the browser and, on a phone, the system bars, so an edge swipe shows the bars instead of leaving. Hidden where the Fullscreen API is missing (iPhone);
    - the body's height is `100dvh`, so on a phone the app no longer runs under the browser's bars.
  - **Already in place:** the performance engine keys phrases by voice, MIDI already plays a voice per note (`midi-<note>`), and the state holds a list of planchettes (used today for the Prism's harmony voices; the mouse and touch drive only the primary one).
  - **Session inputs:**
    - a voice per pointer id: start, follow and release per finger; a voice limit;
    - gravity per finger: each needs its own magnetic state and planchette;
    - recording: each finger's take becomes its own curve (a chord recorded at once), grouped or not;
    - dynamics per finger (pressure where the device reports it, 11.3);
    - the Prism: each finger a chord, or the Prism off while multitouch;
    - edge scrolling with several fingers down; the pitch HUD with several notes;
    - a mouse can't do it, so it's touch- (and pen-) only.
- [ ] **13.34 Piano-roll orientation: the canvas turned 90°** *(L, own planning session — added 2026-10-04)*
  - An option to rotate the canvas so time runs vertically (beat 0 at the bottom, the canvas scrolling down as it plays) and pitch runs horizontally (low on the left, high on the right): a glissando piano roll, suited to portrait screens and multitouch (13.33).
  - **Session inputs:**
    - the viewport's mapping is the place to swap axes; every renderer and hit-test goes through it, but rulers, the rail, the staff labels, edge scrolling and the zoom sliders (13.32) all assume today's layout;
    - Perform only, or editing too;
    - which way it scrolls, and where the rail sits (a horizontal line, like a keyboard's edge).
- [x] **13.35 Haptic click on snap lines** *(S — added 2026-10-04; PR #104)*
  - On devices that can vibrate, a tiny haptic click when the **finger** (the cursor, not the planchette) crosses a snap line while performing.
  - **Notes:** the browser's Vibration API works in Chrome on Android; iOS Safari and desktops don't support it, so it's an extra where available. Very short pulses (a few ms) may be rounded up or ignored by some phones; test the shortest that's felt. A setting to turn it off. A first taste of H.3's felt detents.
  - **Done (PR #104):**
    - **When it clicks** (reworked in testing: clicking on *crossing* a line missed notes the finger reached without quite crossing, and clicked over and over on a line it wavered across): a click when the finger comes within **10 px** of a line, and none again for that line until it has gone **15 px** away (`hapticStep`). Touching down on a line clicks too. The lines are the ones Y would snap to (scale notes, frets, pitch guides), **with Snap on or off** (`nearestSnapLine` in `snap.ts`). The raw cursor, not the planchette. Hovering never clicks.
    - `ui/haptics.ts`: `hapticClick(ms, now)` calls `navigator.vibrate`, at most once per 30 ms so a fast sweep is a train of clicks, not a buzz; nothing where the API is missing.
    - **Settings › Touch:** "Haptic clicks on snap lines" (on by default) and **Click length** (20–40 ms, default 25: nothing shorter could be felt; letting go of the slider gives a sample click). Workspace prefs. The hint names the devices rather than detecting them: desktop Chrome has `navigator.vibrate` too, without a motor.
    - Note: where lines are closer than 20 px (chromatic at the default zoom is 17 px a semitone), every spot is within reach of one, so each line passed clicks.

### Frets (pitch guides)

Y guides become **frets**: a music word for "a pitch you can land on", instead of the maths word. X guides are unchanged. The data model keeps `GuideDefinition` and its `orientation`, so files don't change; this is naming and UI first.

- [x] **13.16 Rename Y guides to Frets** *(S, PR #92)*
  - Everywhere the user reads it: the Snap drawer (**+ Y** becomes **+ Fret**), the Selection panel ("Snap Guide" → "Fret"), tooltips, toasts.
  - The help describes them as **frets (pitch guides)**, so the music term leads and the plain description follows.
  - Consider "beat guides" for X guides in the same pass, so neither is called by an axis letter.
  - **Done (PR #92):**
    - **Snap drawer:** **+ Fret** and **+ Beat** (fret first), with new tooltips. The Guides and Lock switches say they cover both. X guides are **beat guides** everywhere the user reads it.
    - **Selection panel:** "Fret" or "Beat guide" with a one-line meaning. A fret's pitch is named by the tuning with its cents offset ("Db4 +12¢ (6112.0 ¢)"). Delete Fret / Delete Beat guide.
    - **Canvas:** an unlabelled fret shows the same tuning-aware name (`pitchLabel` in `tuning.ts`), not the nearest 12-EDO name.
    - **+ Fret** places the new fret on the tuning's nearest note, not the nearest 12-EDO line.
    - Command descriptions (hold A, Delete) and the help ("Frets and beat guides") updated. There were no toasts about guides.
    - Code keeps `GuideDefinition` and its `orientation`, and the element ids, so files and tests don't change.
- [x] **13.17 Drag a fret out of a corner handle** *(S–M, PR #93)*
  - A small handle where the rulers meet the staff's left edge (top-left corner of the canvas). Drag from it onto the canvas to place a new fret at the pitch you drop it on; release back over the handle to cancel.
  - Dragging out of the ruler itself would fight the playhead scrub (see 13.5), so the handle is separate.
  - Reuse the guide-drag path: self-excluding snap, the audition while A is held (16.6), and select-on-drop.
  - **+ Fret** in the Snap drawer stays as the non-drag path.
  - **Beat guides too (decided 2026-09-27):** the same handle gives a beat guide when dragged right. That covers 13.5.
  - **Done (PR #93):**
    - **The handle:** a 14 px tab over the ruler's left end (`GUIDE_HANDLE_WIDTH`, `overGuideHandle` in `canvas/interaction.ts`). It shows a beat guide's vertical line over a fret's horizontal one, is dimmed while guides are locked, and has a grab cursor and tooltip. It's drawn on the foreground layer, under the playhead. The rulers' first labels start clear of it.
    - **The drag:** nothing happens until the pointer has moved 25 px in one direction, at least 1.5× the other. (8 px picked the wrong one too often in testing.) Then down makes a fret and right a beat guide, with a row- or col-resize cursor. From there the existing guide drag moves it: self-excluding snap, hold A to hear a fret, selected at once, guides shown if hidden.
    - **Cancel:** released back over the handle, the guide is removed and the snapshot dropped (`history.dropLastSnapshot()`), so it leaves no undo step. Otherwise it's one undo step.
    - Locked guides: the handle does nothing, as + Fret / + Beat are disabled.
    - Tests drive the real interaction with a stub canvas (`canvas/guide-handle.test.ts`).
- [x] **13.18 Octave frets** *(M, PR #94)*
  - A **Single / Octaves** toggle in the fret's Selection panel. With Octaves, the fret repeats in every octave across the canvas.
  - Every instance is the same fret: selecting any instance selects it, and dragging any instance moves them all by the same interval.
  - Toggling back to Single keeps only the originally placed fret; the other instances disappear.
  - **Data:** an optional field on the guide (e.g. `repeat: 'octave'`) that round-trips; the stored `position` stays the originally placed one. Dragging an instance moves that position by the drag's delta.
  - **Snap:** the one snap-config builder (15.6) expands a repeating fret into its octave targets, so snapping, Gravity and rendering all agree.
  - **Non-octave tunings** (13.8): "Octaves" repeats every period of the tuning, which is the octave except in tunings like Bohlen–Pierce.
  - Octave frets are what 13.8 (f) converts to and from a scale.
  - **Done (PR #94):**
    - **`model/frets.ts`:** `fretLines()` gives a fret's lines across the pitch range (one per period for `repeat: 'octave'`, each with `k` periods from the placed pitch). `moveFretLine()` moves line `k` and the rest with it. Snapping (`snap-config`), drawing and hit-testing (`canvas/guides.ts`) all read it.
    - **Selection panel:** an **Octaves** switch on frets (**Every period** in non-octave tunings), with "and every octave (or 3/1) above and below" under the pitch. Each toggle is one undo step. Single keeps only the placed pitch.
    - **Canvas:** every line is drawn, labelled with its own pitch (or the fret's label), and highlighted together when selected. Grabbing any line selects the fret and drags them all; holding A plays the line you're dragging.
    - **Edge case:** if dragging a line would take the placed pitch off the pitch range, it's folded back in by whole periods, so the fret stays whole.
    - **Data:** `GuideDefinition.repeat?: 'octave'`, frets only; older files and apps ignore it (no format bump).
    - **Dashes move with the canvas:** an unselected fret's (and beat guide's) dashes, and the 12-EDO reference lines', are pinned to the world (`canvas/dash.ts`), so with Scroll canvas during playback they travel with everything else instead of standing still.
    - **Fixed along the way:** the Selection panel didn't follow a fret or point being dragged. Guides and points are edited in place, so the child panel's props looked unchanged and `@preact/signals` skipped it; both now subscribe to composition edits.
- [x] **13.22 Hide / show all frets** *(S, PR #96)*
  - One switch that hides every fret at once and brings them back, without touching beat guides.
  - Today the Snap drawer's guide visibility covers both kinds, and hiding also stops them pulling (why 16.3 kept it out of the View menu).
  - **Decide when building:**
    - Where it lives. The Tuning drawer, beside Pitch lines, if hidden frets also stop pulling (the same meaning as Pitch lines: hidden = no lines, no pull). The View menu if it's display only and hidden frets still pull.
    - A command-catalog entry either way, so it can take a shortcut and appear in the menus.
  - **Done (PR #96):**
    - **Hidden frets stop pulling**, the same meaning as Pitch lines and the Guides switch. `shownGuides` (`model/frets.ts`) is the one list that drawing, snapping and canvas picking all read: nothing with Guides off, no frets with Frets off.
    - **Where:** a **Frets** switch in the Tuning drawer under Pitch lines (greyed out while Guides is off), and a **View › Frets** command (`view.frets`, no default key yet). It says in its description that hidden frets don't pull.
    - A view setting, like Guides: kept in localStorage, not the file, and not an undo step.
    - Hiding frets (or all guides) lets go of a selected hidden guide, so Delete can't remove something you can't see.
    - Adding a fret (+ Fret, the handle, Scale → frets) turns Frets back on, as adding any guide already turned Guides on.
- [ ] **13.19 Per-fret gravity** *(M–L, own planning session)*
  - Feasibility of letting a fret carry its own snap parameters. New frets follow the universal Snap settings; a per-fret toggle enables custom settings: Gravity on/off, Force, Spring, Damping and an **effect distance** (reach).
  - Within its reach, a custom fret takes precedence over the canvas's scale lines.
  - **Session inputs:**
    - the physics: today `snap-magnetic` has one global spring and force, with proximity-weighted attraction. Per-target force and reach fit a potential-field model; per-target spring and damping don't obviously (they describe the planchette, not the well). Decide which parameters are really per-fret;
    - the precedence rule: inside a custom fret's reach, are scale targets suppressed, or just outweighed?;
    - how it combines with octave frets (13.18) and curve pitch guides (13.10);
    - UI in the Selection panel, and whether presets (13.2) can hold per-fret feel;
    - the snap-target composition work (12.1) and the device protocol's target map (Horizon), which would carry per-target feel to hardware.
- [x] **13.10 Curves as pitch guides** *(M — planning session held 2026-09-27; PR #100)*
  - Turn any pitch curve into a **pitch guide**: it keeps its shape, snaps like a fret (a target that moves over time), and makes no sound.
  - **Not a fret** (2026-09-26): a fret is one pitch, and a curve guide isn't, so it's called a pitch guide. For the same reason it can't join a scale or the staff (13.8 (f) converts octave frets only).
  - **Spec:** [DESIGN.md › Guide tracks spec](DESIGN.md#guide-tracks-spec-1310-decided-2026-09-27). Decided: a **track role** (a Guide switch per track), guides pull **alongside the scale** like frets, and Mute is split from a new **Hide**.
  - **Build in this order:**
    - [x] **(a) Guide tracks** *(M)*: the Guide switch; guide tracks silent (one shared "does this track sound" rule for playback, WAV, previews and Solo); drawn as guides; pitch-guide snap targets at each beat, with no self-pull and under the Guides switch; **Send to guide track**; the file fields, with `muted: true` written for older apps.
      - **Done (PR #100):**
        - **Track row:** a **Guide** toggle (new `guide.svg`, a dashed glide), lit in the fret colour; Mute and Solo grey out on a guide track. The row's buttons moved to a second line under the name and tone: with five (six after (b)) the name had about 20 px.
        - **Silent:** `trackSounds()` / `soloActive()` in `model/track.ts` are the one rule for playback, WAV export and the scrub / Composition + tone previews. A guide track can't be soloed and doesn't count toward Solo.
        - **Drawn** thin (1.25 px), dashed, in the `guide` colour, dimmed; hidden with the Snap drawer's Guides switch, and not pickable then.
        - **Snapping:** `snapConfigFor` adds each guide curve's pitch at the query's beat (`evaluateCurveAtBeat`) to the fret targets, so it pulls alongside the scale within 50 ¢, and Gravity sees it. `excludeCurveIds` (from `editingCurveIds()` in `interaction.ts`: the curve being drawn, dragged, transformed or point-dragged) keeps a curve from pulling on itself.
        - **Send to guide track / Copy to guide track** (`store.sendCurvesToGuideTrack`; Edit menu, and a Send button in Selection): moves or copies whole groups to the first guide track, making "Guides" if there's none; you stay on your track. One undo step.
        - **Store:** `setTrackGuide` unmutes the track either way and drops its solo.
        - **File:** `Track.guide?: true`, saved with `muted: true` for older apps; loaded as a guide, unmuted. Any value but `true` is dropped. No version bump.
    - [x] **(b) Mute / Hide split** *(S–M)*: Mute becomes silent only (curves drawn dimmed, still pickable); a Hide (eye) button hides a track and stops a guide track pulling.
      - **Done (PR #100):**
        - **Mute** is silent only: a muted track's curves are drawn at half strength and can be picked and edited. *(Behaviour change: before, muted tracks were also hidden and unpickable.)*
        - **Hide** (eye / eye-off icons, new): `Track.hidden?: true`, one undo step, saved in the file. A hidden track still plays, isn't drawn or pickable, and a hidden guide track doesn't pull. Hiding the active track lets go of its selected curves and the transform box. A Draw click on a hidden track shows it again (and turns Guides on for a guide track), as adding a fret shows frets.
        - `trackShown()` in `model/track.ts` is the one rule for drawing, canvas picking and pitch-guide pull, beside (a)'s `trackSounds()` for sound.
    - **Found in testing:** gliding along a guide, the planchette dropped onto staff lines where they crossed: Gravity pulls to the target nearest the cursor, and a line a few cents nearer won. **Pitch guides now take priority within 100 ¢** (`PITCH_GUIDE_PRIORITY_CENTS`, `SnapConfig.priorityYTargets`): inside it they're the only Y targets for `snapToGrid` and `findAdaptiveSnap`; beyond it they're additive as before. Frets are unchanged. A per-guide reach is 13.19's.
  - Related to 12.1 (a curve is another gravity source), 13.19 (per-guide gravity) and 13.25 (with 13.24, this is what could replace Projection).

### Groups

Curves group by a shared `groupId` (Harmonic Prism chord clusters, and freehand `Ctrl+G` groups). There is no group object: a group is just the curves that carry the same id. 13.13 and 13.14 would likely need one — a first-class group entity with an id, and room for its own lanes — which is a data-model change with a composition-version bump and migration.

- [x] **13.12 Make grouping visible, and ungrouping easy** *(S–M — done in 16.5, PR #84)*
  - **Closed (2026-09-27):** 16.5 built every part below: the shared outline on the canvas, "Group of n curves" in Selection, and Ungroup there and on the transform box. The group *entity* is 13.13's concern.
  - Found in 15.2 testing: Prism draw correctly places two offset curves as a group, but nothing on screen says they're grouped, so it read as a bug.
  - Show grouped status on the canvas, for example a shared outline or bracket when any member is hovered or selected, or a group badge on the selection. Show it in Object Properties too ("Group (3 curves)" exists only for the Move-to-track picker today).
  - Put Ungroup somewhere easier to reach than `Ctrl+Shift+G` and the right-click menu: a button in Object Properties when a group is selected, and on the transform box.
- [ ] **13.13 Group volume envelope** *(M, own planning session)*
  - Explore giving a group its own volume lane that scales the group's *summed* output equally: one fade or swell across a whole chord cluster, on top of each member's own volume lane.
  - **Session inputs:**
    - where it lives: needs the first-class group entity above;
    - audio: a per-group gain node between the member voices and the track, or multiplying the envelope into each member's sampled volume. The first is truer to "summed output"; the second needs no graph change;
    - how it's edited: the Parameters Graph showing the group lane when the group is selected (ties into 8.4's lane picker);
    - what Ungroup does to it: bake it into the members, or discard it;
    - copy / paste / duplicate / join semantics;
    - how it relates to a track envelope: settled in 13.31's session.
- [ ] **13.31 Track-level dynamics, and how volume layers relate** *(M–L, own planning session — added 2026-10-03)*
  - Give a track its own volume envelope over time, on top of its curves' volume lanes. 11.7's looping shape would most likely live here.
  - **First, sort out how the layers relate** (the user had assumed 13.13 and 8.4 covered it): a curve's volume lane, a group's envelope (13.13), a track's envelope (this), the track's volume slider, and the live dynamics bus (11.x). Likely they multiply, but decide which are the same mechanism (a lane owned by a curve, a group or a track) and which are separate.
  - **Session inputs:**
    - one "lane owned by a container" model for groups and tracks, or two features;
    - audio: a gain node per track (and per group) driven by the envelope, or multiplied into each voice's sampled volume;
    - editing: the Parameters Graph showing the track's lane when no curve is selected, or a lane picker (8.4);
    - looping: a track lane that repeats over a set span (11.7) rather than running along the timeline;
    - recording: whether live dynamics can be written to the track lane instead of the curve's;
    - the `.gliss` file: where a track's lane is saved.
- [ ] **13.14 Group isolation mode** *(M–L, own planning session)*
  - Explore an Adobe Illustrator-style isolation mode: enter a group (double-click it, or a button) to edit its members individually without ungrouping. Everything outside the group fades and ignores input; Esc or clicking outside exits.
  - **Session inputs:**
    - entry and exit gestures, and how the canvas shows you're inside;
    - which tools work inside (point edits, adding a member, removing one);
    - how it interacts with transform-box group expansion (today selecting one member selects the whole group);
    - fits the input router (15.2) as an input-scope filter: hit-tests limited to the isolated group;
    - reuses 8.23's non-active dimming for the fade.

### Snap, harmony & tuning
- [x] **13.8 Tuning / key / scale model rework** *(L — planning session held 2026-09-26; (a)–(d) and (f) done, (e) deferred)*
  - **Spec:** [DESIGN.md › Tuning spec](DESIGN.md#tuning-spec-138-decided-2026-09-26). In short:
    - **Tuning / Root / Scale** replace Key + Scale; Tune A4 stays separate; "None" becomes a Pitch lines switch.
    - The staff follows the tuning.
    - The drawer is a **pitch circle** over the controls.
    - Frets and scales convert both ways.
    - `.scl` import and export.
  - Research, with sources: [.claude/plans/13.8-tuning-taxonomy-research.md](.claude/plans/13.8-tuning-taxonomy-research.md).
  - **Build in this order:**
    - [x] **(a) Tuning model + migration** *(M, PR #88)*
      - Tuning, Root (a degree index), Scale, Pitch lines, and "Tuned from" for historical temperaments.
      - The built-in tunings: 12-EDO, equal divisions (N, octave or 3:1), a curated just-intonation list, the historical tables, Slendro and Pelog.
      - The composition version goes up, with the migration table in the spec and a golden-format shim.
      - The Tuning drawer's controls switch to the three new dropdowns. The circle comes in (c).
      - **Done (PR #88):**
        - **`src/tuning/tuning.ts`:**
          - the tuning catalog (equal divisions, the just, historical and traditional tables) and the scales, now counted in degrees;
          - degree names: letters for 12-note tunings and 19/31-EDO, ratios for just intonation, numbers otherwise;
          - `pitchSetFor()`, which turns Tuning / Root / Scale / Tuned from / Pitch lines into the notes the staff draws and snapping aims at.
        - **Snap** (`utils/snap.ts`) aims at that list (`pitchTargets`, null with pitch lines hidden) instead of the old root + scale + chromatic fallback. The staff reads it too, still drawing on the 12-EDO lines until (b).
        - **Store:** `SnapSettings` holds `tuning`, `root` (a degree index), `scaleId` ('all' or a scale), `tunedFrom` and `hidePitchLines`. `setTuning` and `setTunedFrom` keep the root on the nearest pitch; a scale that doesn't fit the new tuning falls back to All notes. Each drawer edit is one undo step (the old Key menu wasn't undoable).
        - **Files:**
          - composition v5, `.gliss` formatVersion 2 (older apps refuse the file instead of misreading it);
          - `migrateSnapSettings` maps every old Key + Scale setting to the same notes. A test checks every old scale on several roots;
          - the golden audio snapshots are unchanged.
        - **Drawer:** a Preact `TuningPanel` (Tuning with Divisions and "of the octave / of 3:1", Root, Scale, Tuned from, Tune A4, Pitch lines) replaces `ui/toolbar.ts`. `utils/scales.ts` is gone.
        - **Beyond the spec:**
          - **Tuned from** shows for every tuning except 12-EDO, not only historical ones. The migration needs it (Thai 7-TET or Pelog on D becomes that tuning tuned from D), and for any tuning but 12-EDO it decides where the tuning sits.
          - An old "C + Chromatic scale" file now shows the plain chromatic staff instead of every line highlighted: it's All notes, the same pitches.
    - [x] **(b) Staff, labels and snap per tuning** *(M, PR #89)*
      - The staff draws the tuning's degrees, named by the naming rule, with the optional 12-EDO reference layer.
      - Snapping without a scale falls back to the tuning's degrees.
      - The octave highlight follows the root (absorbs 13.9).
      - Prism "Equal" intonation uses the tuning's steps.
      - **Done (PR #89):**
        - **Staff** (`canvas/staff-renderer.ts`): draws `staffGridFor()`'s lines (`tuning/tuning.ts`), every note of the tuning flagged root / in scale / natural and labelled by the naming rule with the octave (Db4, E4 5/4) or a number; a numbered root line adds its nearest standard note (5 ≈D4).
          - The root's lines are the bold markers, so 12-EDO with root C looks as before.
          - Labels: the root always, naturals and the scale's notes once a twelfth of the period is 10 px, every note once the smallest step is 18 px (12-EDO's old thresholds), skipping any that would collide.
          - Zoomed out, lines outside the scale fade as neighbours close from 4 to 1.5 px.
        - **12-EDO reference layer:** a "12-EDO reference" switch in the Tuning drawer (tunings other than 12-EDO; greyed while pitch lines are hidden). `SnapSettings.referenceLines`, default on; older files take the default, so no version bump. Dashed lines on standard notes no tuning line is within 3 px of, and C's name at the right edge. The `staff-micro-*` theme tokens became `staff-ref-*`.
        - **Snap:** already the tuning's degrees since (a); unchanged.
        - **Pitch readout:** the draw HUD names the tuning's nearest note and the cents from it (`pitchName`).
        - **Prism:** `chordOffsets(spec, steps)` moves each Equal voice to the tuning's nearest step, keeping voices apart. The steps are the tuning's intervals counted from the root (`chordStepsFor`), so offsets stay constant along a curve. The Intonation option reads "Equal (19-EDO)" etc. outside 12-EDO. Echo renderers and snap targets take offsets instead of the chord spec.
        - **Decision:** for unequal tables (Werckmeister, just intonation) "the tuning's steps" is its intervals from the root: a chord on the root sits on the staff's lines; on other degrees it keeps the root's interval shapes.
    - [x] **(c) The pitch-circle drawer** *(M, PR #90)*
      - Rim ticks, scale dots, the root ring, and the 12-EDO inner ring.
      - Click to hear, double-click for root, Shift+click to toggle a degree (Custom scale).
      - The drawer's layout per the spec, on a Preact component.
      - **Done (PR #90):**
        - **`ui/pitch-circle.tsx`** (SVG, Preact) at the top of the Tuning drawer:
          - one period, C at the top for octave tunings (degree 0 for others);
          - a tick per degree; names on the rim up to 24 degrees, then only the root and the natural letters;
          - filled dots for the scale, a ring on the root, and the root and scale named in the middle;
          - the 12-note inner ring for octave tunings other than 12-EDO.
        - **Gestures:**
          - press and hold to hear (the current track's tone, `circle-audition` voice, octave 4; silent while a recording is armed);
          - double-click for the root;
          - Shift+click toggles a degree. Each is one undo step.
        - **Custom scale:** `scaleId: 'custom'` plus `SnapSettings.customScale` (`{size, steps}`, steps from the root).
          - It starts from the chosen scale (All notes: every degree). The root can't be taken out; a scale of every degree becomes All notes.
          - It's kept when another scale or tuning is chosen, and offered in the Scale menu ("Custom (n notes)") for tunings of its size.
          - Older files load with none, so no format bump; a pre-(c) app reads 'custom' as All notes.
          - `scaleSteps()` in `tuning.ts` now resolves any scale for snapping, the staff and the store.
        - **Decision:** double-click sets the root the way the Root menu does, so a scale moves with it (C major → D major), Custom scales included. The alternative, keeping the dots where they are and changing only which one is home (C major → D Dorian), is noted under Deferred.
        - Import / Export .scl buttons come with (d).
    - [x] **(d) `.scl` import and export** *(S–M, PR #91)*
      - Import into an Imported tuning, with the description line treated as untrusted text.
      - Export the notes you hear, from the root.
      - A performance check with a large file (e.g. 43 or 192 notes).
      - **Done (PR #91):**
        - **`tuning/scl.ts`:**
          - `parseScl` follows the Scala format: comments, the description line, the count, and cents or ratio pitches with trailing text ignored. It sorts, drops repeats, folds notes outside the period into it, and throws `SclError` with a message for the user.
          - `toScl` writes the notes you hear from the root, with the period last; ratios where the tuning has them for both notes (reduced, exact), cents otherwise.
        - **Tuning model:** `TuningRef` gains `{kind: 'imported', name, description, degrees, period, ratios, periodRatio}`. The composition holds the whole tuning. `importedTuningProblem()` checks it on import and again on every load, since files are untrusted; a bad one plays as 12-EDO.
        - **Limits:** at most 1,200 notes, and at most 1,200 to the octave; a period of 100–7,200 ¢; files up to 256 KB (refused before reading). The description is cut to 200 characters with control characters removed, and is only ever rendered as text.
        - **Store:** `SnapSettings.importedTuning` keeps the last import, so the Tuning menu's "Imported (.scl)" group offers it after switching away. `importTuning()` keeps the root's pitch, as any tuning change does, and is one undo step. Older files load with none, so no format bump.
        - **Drawer:** Import .scl… and Export .scl… buttons; the imported tuning's description under the Tuning menu; a toast for success or for why a file can't be used. `openTextFile()` returns the file's name.
        - **Performance** (browser, 560×740 staff):
          - 43 notes: 388 lines, 1.8 ms to build, under 1 ms to draw.
          - 192 notes: 1,729 lines, 2.6 ms, 1.5 ms.
          - The 1,200-note limit: 10,801 lines, 16 ms, 7 ms. The staff only redraws when it changes.
        - **Staff labels (found while checking):** a tuning named by numbers now shows labels other than the root's only once at least every other one fits, so a 192-note tuning zoomed out isn't a column of scattered numbers.
    - [x] **(f) Frets ↔ scale** *(M, PR #95)*
      - Scale → octave frets.
      - Octave frets → a Custom scale, or a Custom tuning if any fret is off the tuning's degrees. Single frets stay as they are.
      - **Done (PR #95):**
        - **`tuning/frets-scale.ts`:**
          - `scaleToFrets` puts an octave fret on each scale note (every note with All notes) in the octave from C4, skipping notes an octave fret already covers. It refuses scales over 72 notes.
          - `fretsToScale` reads the octave frets' pitch classes. If all are on the tuning's notes, the result is that scale: by name if it's one of the tuning's scales (a round trip gives D major back), else Custom, or All notes. If any fret is off the notes, the result is a tuning **"From frets"** (an imported-kind tuning) with the frets' exact pitches and All notes.
          - The root stays if a fret is on it, else moves to the nearest fret; a "From frets" tuning starts on the root fret.
        - **Store:**
          - `addScaleFrets` also turns pitch lines off, so the frets are the grid to nudge by ear.
          - `applyFretsAsScale` uses up the octave frets (single frets stay) and turns pitch lines back on.
          - Each is one undo step; a no-op drops its snapshot.
        - **Tuned from can sit between standard notes:** a "From frets" tuning's first note is the root fret's exact pitch, so `tunedFrom` may be fractional (D +17¢). The Tuned from menu shows that value as an extra option, and letter names use the nearest note.
        - **12-EDO reference off by default** (user feedback): too busy most of the time, though useful as a check. New compositions start with it off; files saved with it on keep it on.
        - **Drawer:** **Scale → frets** and **Frets → scale** buttons (the latter needs octave frets), with a toast saying what happened. The Tuning menu's group is now "Imported and from frets"; the last one made stays on offer, like an import.
  - **Deferred:**
    - **(e) Scale generator for other equal divisions** — MOS: large and small step counts plus mode rotation; the MIT `moment-of-symmetry` library covers the maths. A second editor, so its own item.
    - **Retuning on the circle** — dragging a degree around the pitch circle to make a Custom tuning directly. The frets route (f) covers it for now.
    - **"Make home" on the circle** — a gesture (e.g. Alt+double-click) that changes the root but keeps the same notes: C major's dots with A as home is A natural minor. Recognise a named scale when the rotation is one, else keep it Custom.
- [ ] **13.21 Prism chords per note in unequal tunings** *(M — first slice S done, PR #97)*
  - Since 13.8 (b), Equal intonation in an unequal tuning (Werckmeister, meantone, just intonation) builds every chord from the root's intervals. So a chord on any other note is the root chord moved, and every key sounds the same.
  - **Add a second option**, e.g. Intonation **Tuning (per note)** beside **Equal (from root)**: the chord uses the tuning's own notes above the base, as a keyboard in that temperament would. E major's third in Werckmeister is wider than C major's.
  - **The rule** (deterministic): find the tuning's note nearest the base, count up the chord's degrees from it (in a 12-note table the semitone counts; otherwise the step counts from 13.8 (b)), and shift the whole chord by the base's offset from that note.
  - **Expect:** well temperaments give each key its colour, as intended. Meantone, Pythagorean and 5-limit just intonation hit their wolf intervals on some chords (D minor in 5-limit has a fifth about 20¢ flat), historically honest but possibly surprising. Equal tunings give the same result either way.
  - **The cost is movement**, not the rule: today a chord's offsets are constant, so harmony voices are parallel copies of the curve. Per note, the shape changes as the base crosses between notes.
  - [x] **First slice (S, PR #97):** Prism Draw clicks and performing. The shape is taken at the note's start and held through the glide, so harmony voices never jump mid-note. Projection echoes keep the from-root shapes.
    - **Done (PR #97):**
      - Intonation **Per note (tuning name)** beside **Equal (from root)**; not offered in 12-EDO, where it's the same.
      - `noteRootAt` / `prismOffsetsAt` in `tuning.ts`; `prismOffsets` takes the note's degree. Draw clicks, the Draw cursor's chord dots and hold-A audition use the note under the cursor. A performed note holds the degree it started on (`heldNoteRoot` in main.ts) until the press ends, so a chord-spec change mid-note still applies.
      - A 12-note octave table now counts its notes by the semitones (for Equal too): a third is four notes up however far it's tempered (7-limit's 7/6 minor third), rather than whichever step is nearest.
      - Between presses while playing, the rail's harmony dots follow the cursor's note.
  - **Then (M):** projection echoes per note: sampled and drawn in steps instead of as shifted copies. Their snap targets are already computed at each beat, so those are easy.
    - **Parked (2026-09-27):** tried, and the jogs where an echo steps to the next note's chord looked wrong. Projection itself may be retired (13.25), so this waits on that decision.
  - **Later, if wanted:** live re-shaping during a glide, with hysteresis so a base sitting on a boundary doesn't flicker.
- [ ] **13.23 Key guides and a tuning hot bar** *(L, own planning session)*
  - Beat guides today only bookmark places. Let one carry a **key change**: place it, set its tuning, root and scale (**a key guide**), and from that beat on the staff, snapping and labels follow the new settings until the next key guide.
  - A composer lays out the key changes, then while performing, snapping follows them automatically.
  - **Tuning hot bar:** slots holding a tuning / root / scale each, on user-definable keys (1–0 on the keyboard; configurable notes or controls on a MIDI controller). Pressing one while performing places a key guide at the playhead and changes key from there on.
  - **Session inputs:**
    - **Data:** the composition's snap settings become the settings at beat 0, plus a list of changes at beats. Stored on beat guides (a payload on `GuideDefinition`) or as their own list shown as guides? A file-format version bump either way.
    - **What a change can set:** tuning, root, scale, Tuned from. Pitch lines and the 12-EDO reference probably stay global.
    - **Every consumer becomes "at this beat":** the staff draws in sections, snapping (the snap config builder already takes the beat), the draw HUD, the Prism's steps (13.8 (b)), the pitch circle (13.8 (c)), and gravity crossing a change mid-glide.
    - **Curves don't move:** pitches are absolute cents, so a key change changes the grid, not what you've drawn or recorded.
    - **The Tuning drawer:** does it edit the settings at the playhead, at the selected key guide, or at beat 0?
    - **Performing:** a hot-bar press while looping (does the guide land once, or every pass?), undo, and what happens with a press very near an existing key guide.
    - **Keys:** 1–0 are also wanted for chord-spec favourites (8.12), so the two need to share or split them. MIDI mapping belongs with the MIDI input work (9.x).
    - Naming alongside 13.16 (beat guides and frets).
- [ ] **13.25 Retire Prism Projection?** *(S — undecided, 2026-09-27)*
  - In practice Projection gets little use; Prism Draw is the part that's fun. An echo is a silent, snappable copy of a curve at a chord interval, which two planned tools give explicitly: **13.24** (move or duplicate by an interval) makes the copy, and **13.10** (curves as pitch guides, perhaps a track muted as a guide) makes it silent and snappable. You get only the echoes you want, and can hear one before committing.
  - **What removal loses:** echoes follow the source live as it's edited (copies don't); and one switch gives every chord voice over up to ±3 octaves (copies would need several moves, or a "copy to each chord voice" action).
  - **Removal touches:** the echo renderer in `projection-renderer.ts` (the Prism Draw preview dots stay), Projection's snap targets in `snap-config.ts`, `projectionSourceId` / `projectionOctaveRange` / `activeMode` in the store and types, the `prism.projection` command (Ctrl+H), the drawer switch and Octaves ± row, and help. Saved chord specs and workspace prefs that carry the fields load and ignore them.
  - Decide after 13.24 and 13.10 exist, so there's something to move to.
  - **Step 1, set aside (2026-09-27, PR #101):** the Projection switch and Octaves ± row are hidden (`SHOW_PROJECTION` in `ui/prism-panel.tsx`), Ctrl+H is unbound, and help describes the guide-track route instead. The back end stays, so it can come back with a one-line change. The user expects not to miss live following or the one-switch spread; if that holds after a while, step 2 removes the back end (the list above).
  - The per-note echoes tried for 13.21 (drawn in steps) were dropped: the jogs at note boundaries looked wrong, and the effort isn't worth it while Projection's future is open.
- [ ] **13.15 Gravity feel preview** *(M)*
  - A small animated waveform in the Snap drawer showing what Force, Spring and Damping do: its amplitude, frequency and falloff change as you move the sliders.
  - Drive it from the real `snap-magnetic` integrator (a step response into a well), so the preview is the feel, not an illustration of it.
- [x] **13.36 Faster gravity, and glides without vibrato** *(S as built — added 2026-10-04; PR #104)*
  - **Done (PR #104), solved by one setting:** testing at 240 bpm showed the physics running in beats was the slowness, so Gravity got a **Speed** multiplier (0.25×–4×, default 1×, a logarithmic slider in the Snap drawer under Damping) that scales the beat time the physics sees, and nothing else. **High Speed with high Damping gives the fast glide without overshoot** (the user's finding), so the approaches below aren't needed for now.
    - `updateMagnetic(..., speed)` multiplies the elapsed time (and the catch-up cap); the fixed sub-step keeps it stable at any speed. Speed 2× matches double tempo exactly (tested).
    - `SnapSettings.magneticSpeed`: saved with the composition (older files load at 1×) and in snap presets (built-ins at 1×; user presets saved before it read as 1×, and a preset matches only at its Speed).
    - **Steps** (from testing: two decimals made round values impossible to land on): 0.1 from 1× up and 0.05 below (`stepMagneticSpeed`). Detents on round values were tried and taken out: too much. The value labels of all four Gravity sliders have a fixed width, so a slider doesn't change length as its value grows a digit.
    - Still tempo-relative: a piece at 60 bpm with Speed 2× feels like 120. Making it tempo-independent was considered and left, since it would change every existing composition's feel.
  - From touch testing (13.27): with Gravity on, even at maximum Force the planchette can be slow to catch up with a finger. Keep today's range reachable, but allow faster.
  - **An option for no overshoot:** the overshoot that makes vibrato should be avoidable while keeping a fast glide between notes. Today Damping prevents the vibrato but slows everything else down.
  - **Approaches to weigh** (the user's idea first; open to others):
    - **damping by distance:** an adjustable range so damping acts only close to the snap line, leaving the glide fast;
    - a higher maximum Force (and Spring), maybe with a non-linear slider so the current range keeps its resolution;
    - critical damping: a "no overshoot" switch that sets damping from the stiffness, the fastest settle without overshoot;
    - separate controls for approach speed and settling.
  - **Check:** the physics runs in beats (`snap-magnetic.ts` integrates over beat time, with the velocity cap in cents per beat), so gravity is slower in real time at slower tempos. That may explain part of the "slow to catch up"; consider running it in seconds.
  - Related: 13.15 (feel preview), 13.19 (per-fret gravity), 12.1. Turning Gravity off on touch sounds "beepy" (13.20's envelopes should help).
- [ ] **12.1 Snap-target composition + snap-to-sounding-harmony** *(L, own planning session — after 15.6 and 13.8)*
  - First define how gravity sources combine into one target set. Today Prism projection targets *replace* the others while active, guides are additive, and scale vs. chromatic are exclusive.
  - Then let the sounding bed (a drone or Prism chord) become the magnetic target: "you snap to the harmony you're actually in."
  - **Session also owns:**
    - dense-bed resolution: nearest, weighted, or limited targets;
    - whether snapping to a drone uses the current temperament or pure JI.
- [ ] **13.30 Prism: build the chord voice by voice** *(M, own planning session — added 2026-10-03)*
  - Today one stacking (2nds, 3rds, 4ths, 5ths) and one quality shape every voice. Instead: set the number of voices, then for each voice its **interval**, **how many steps** of it, and its **direction** (up or down) from the root, so more complex shapes can be built (e.g. a fifth up and a major third down, or a fourth up stacked twice).
  - **Session inputs:**
    - the panel: a row per voice;
    - what happens to the stacking and quality pickers: presets that fill the rows (Tertian major → M3, P5…), or gone;
    - per-voice octave offsets (8.13) and the chord-wide direction: folded into each voice's interval and direction;
    - intervals counted in the tuning's steps, as the Prism counts them (13.8 (b)) and from each note (13.21); names shared with 13.24's Move by list;
    - saved chord specs and the `prismChordSpec` workspace pref: migrating today's specs to rows;
    - knock-on: 8.12 favorites, 8.14 chord labels.
- [ ] **8.12 Chord-spec favorites on number keys** *(M)*
  - Retune voices mid-perform without the mouse. The live-retune plumbing already exists.
  - Bind through 15.3's command registry.
  - The tuning hot bar (13.23) also wants 1–0: settle the split in its session.
- [ ] **8.14 Chord-label readout on selected groups** *(S)*
  - Honest about microtonal bases, e.g. "C(+17¢) major".
- [ ] **8.15 "Lite harmonies" audio mode** *(S)*
  - Sine-only harmony voices for CPU relief.
- [x] **8.16 Secondal stacking** *(S — already built)*
  - Cluster chords. Low priority.
  - **Closed (2026-09-27):** Secondal (2nds) stacking, major and minor, has been in the Prism since Projection mode was first built (April 2026); the entry was logged from the design doc without checking.

### Dynamics bus
The bus exists ([src/audio/dynamics-bus.ts](src/audio/dynamics-bus.ts), 11.1); each input is a thin adapter. Build order: MIDI → pen → gamepad.
- [ ] **11.2 MIDI velocity + CC / channel pressure + MIDI-learn** *(M)*
  - Stop discarding live velocity (`void velocity;` in the MIDI `onNoteOn` handler).
  - Decode CC and channel pressure as a new `DynamicsSource`, with MIDI-learn so any controller maps.
  - Optional; never a prerequisite for anything.
- [ ] **11.3 Pen pressure / tilt** *(M)*
  - The canvases already run on Pointer Events (15.2). What remains: pressure feeds the bus, tilt is captured for later use, plus pen-vs-mouse detection and a sensitivity curve. `PointerEvent.pressure` / `tiltX` / `tiltY` reach the perform handlers in `main.ts` via the input router.
- [ ] **11.4 Gamepad analog input** *(S–M)*
  - Poll the Gamepad API in the frame loop, with a "pick your control" mapping step.
- [ ] **11.5 Cursor Y-velocity as a dynamics source** *(M)*
  - The gesture's own vertical speed drives dynamics; no extra hardware.
  - **Critical:** read the raw pre-snap cursor, not the planchette. Under magnetic snap the planchette carries spring oscillation and would ring the volume at the vibrato rate.
- [ ] **11.6 Distance from snap target as a dynamics source** *(M — added 2026-10-03)*
  - Volume follows how close the pitch is to a snap target: on a target, **Max**; exactly halfway between two targets, **Min**. Max and Min are set as percentages.
  - **Decide when building:**
    - which targets: the same set Gravity pulls to (scale, frets, pitch guides), so it changes with the tuning and the Snap settings;
    - "halfway" between the two neighbouring targets, so uneven spacing (unequal tunings, sparse scales) scales with it;
    - the curve between Max and Min (linear, or eased near the target);
    - the planchette or the raw cursor: under magnetic snap the planchette's spring would make a tremolo at the vibrato rate (11.5's warning). **Build both and test (2026-10-03):** one may work better, or both may be worth keeping as a choice;
    - smoothing, so a fast glide doesn't zipper;
    - recorded into the volume lane like the other sources.
- [ ] **11.7 Looping drawn shape as a dynamics source** *(M–L, own planning session — added 2026-10-03)*
  - A drawn volume shape that **loops** (a custom tremolo) instead of following along in time. Loop boundaries are set where the source is chosen.
  - **Session inputs:**
    - where the shape is drawn (the Parameters Graph, or a small editor beside the source);
    - loop length in beats (tempo-synced) or seconds; free-running, or restarted on each note;
    - live (feeding the bus while performing, written into recorded volume lanes) or applied at playback;
    - **track-level:** it may only work once tracks have their own dynamics (13.31), so it likely comes after that session.
    - Volume undulation is tremolo, not vibrato.
  - **Session inputs:**
    - mapping (magnitude only, or does direction matter?);
    - smoothing vs. latency;
    - rest behaviour when the cursor is still;
    - sharing one sensitivity curve with 11.3.

### Transport & looping
- [ ] **3.2b Custom rhythm patterns** *(M, own planning session)*
  - Define what a "pattern" is (accent map? mixed meter?) before any code.
- [ ] **13.7 MIDI Gliss** *(M, own planning session)*
  - A MIDI input setting where the most recent note played becomes the **Y snap target**, ignoring the staff, the scale and any frets. The planchette moves to each new note under the current Snap / Gravity settings, so the glissando between notes comes from the physics rather than a separate glide control.
  - Monophonic: only the latest note counts. Consecutive notes draw one continuous curve.
  - **Direction (2026-09-26):** Gravity is the glide. That answers the old "glide shape and duration" question and avoids reviving 7.1's too-narrow Glide slider: Force, Spring and Damping are the glide's shape.
  - Uses the envelope (13.20) to decide when the curve ends: it continues through release at the last pitch, so short gaps between notes still glide, and stopping playing ends the curve after the release.
  - **Session inputs:**
    - how it's switched on: a MIDI setting, a per-track mode, or tied to MIDI arm;
    - legato vs. detached playing, and what a note-off does before the envelope ends;
    - interaction with loop wrap (8.21) and pitch bend (8.25);
    - velocity (11.2) feeding the envelope's level.
- [ ] **13.20 ADSR envelope** *(M–L, own planning session)*
  - **From touch testing (2026-10-04):** with Gravity off, tapping notes sounds "beepy"; an attack and release should soften it.
  - A basic Attack / Decay / Sustain / Release envelope, applied to every curve, not only MIDI. It shapes the volume lane at first, and is built so later parameters (8.4's lanes) can take one too.
  - In MIDI Gliss (13.7) the curve keeps drawing inside the envelope, through the release phase at the last pitch, until the envelope ends or a new note picks it up. With Gravity on, the new note pulls it into a glissando.
  - **Session inputs:**
    - where it lives: per tone, per track, or per curve (and whether a curve can override);
    - what gates it on a drawn curve: the curve's start and end, with the release sounding past the last point? That changes how long a curve sounds, and how it draws;
    - how it combines with the volume lane (multiply?) and the dynamics bus;
    - showing it: on the curve, or in the Parameters Graph;
    - relation to the group volume envelope (13.13) and to 8.8's synthesis work.
- [ ] **10.6 Live loop in/out taps, bar-quantized** *(S–M, DEFERRED 2026-07-30)*
  - Revisit only if setting loop points mid-jam proves necessary; dragging the ruler markers covers it for now.

### Files & formats
- [x] **12.3 Round-trip unknown top-level envelope sections** *(S, PR #99)*
  - `serializeComposition` rebuilds the envelope from a fixed key set, so a future `hostSettings` section would be dropped on load→save. Carry unknown keys through verbatim.
  - Cheap, and core to the round-trip guardrail. It can be pulled forward into Phase 17 at any time.
  - **Done (PR #99):**
    - On load, unknown top-level sections and unknown keys inside `meta`, `tuning` and `snap` go into `Composition.unknownEnvelope` (never read by the app). On save they go back out verbatim: unknown sections after the app's own, extra keys inside their sections. What the app writes wins on a clash (a stale `savedAt` is replaced). A `composition` section can't plant the field itself.
    - The rest already round-tripped by spreading: unknown keys in the composition section, snap settings, guides and lanes (tested since the envelope landed).
    - It lives on the composition, so it survives undo and redo (history clones compositions as JSON). A new composition or a MIDI import starts without one.
    - Tests: load → save with a `hostSettings` section, a top-level string, and extra keys in `meta`, `tuning`, `snap` and `composition`; clash and planting cases. These are the round-trip preservation tests 17.2 asks for.
- [ ] **12.2 `.glisskit` + Import-settings verb** *(M)*
  - Implements the two-extensions / two-verbs design in [DESIGN.md › File format](DESIGN.md#file-format--gliss).
- [ ] **9.3 History: externalize large blobs** *(M — before 12.4)*
  - Undo deep-clones the whole composition (up to 50 copies). That is fine today but not with raw takes.
  - Keep blobs in a separate immutable pool referenced by id, or move to structural-sharing snapshots.
  - Keeps the settled rule: one undo stack, one entry per kept pass.
  - May fold into 15.1 if the new store uses structural sharing.
- [ ] **12.4 Raw-take retention** *(L, own planning session — after 9.3)*
  - Keep the high-rate capture alongside the fitted Bezier; see [DESIGN.md › Raw takes](DESIGN.md#raw-takes-design-framing-for-backlog-124).
  - Earlier parked exploration of a separate, non-editable raw curve type that plays its samples directly (convert-to-Bezier on demand): [.claude/plans/12.4-raw-recording-curve-type.md](.claude/plans/12.4-raw-recording-curve-type.md).
  - **May shrink to nothing (2026-09-28, 13.11):** a tight fit (13.11's Accuracy at a few cents) plays what was played, stays editable, and can be simplified later from its own shape. An earlier, uncommitted try at keeping raw data found saves too big; its fallback was keeping every 4th sample (a quarter of the data, still too dense to hear the difference). Revisit only if the tight fit falls short.
  - **Session inputs:**
    - authority: raw is the immutable original, the edited Bezier wins playback;
    - retain kept takes only;
    - persist at 100–200 Hz with delta + fixed-point + gzip encoding;
    - inline arrays vs. a container file;
    - store raw takes pre-snap or post-snap.
- [ ] **9.4 MIDI / MPE export** *(M–L)*
  - Cents make it mechanical: note-on at the nearest semitone plus a pitch-bend stream, one channel per simultaneous curve (≈ MPE).
  - Volume lane → velocity at note-on, and CC11 / channel pressure after.
  - The MIDI import tests give a round-trip harness for free. The live-velocity half is 11.2.
  - **Gates (for Eurorack MIDI-to-CV modules and the like):** MIDI has no separate gate message. The module raises its gate on note-on and drops it on note-off, so a curve bracketed by one note-on and one note-off already gives one gate. What needs care is the glissando:
    - **bend range:** a glide wider than the receiver's pitch-bend range forces a new note, which retriggers the gate and envelope. Send the range with RPN 0 (MPE's default is ±48 semitones), so one note can cover most glides;
    - **legato:** where a new note is unavoidable, send its note-on before the old note-off. Most MIDI-to-CV modules treat that as legato and don't retrigger;
    - **clock:** tempo sync (MIDI clock / start / stop) is separate from gates. Export would write it only if a sequencer needs to follow the piece.
  - Direct CV output with an explicit gate per curve (1 V/oct pitch + gate + volume CV) is H.2's VCV Rack path, not MIDI.

### Sound
- [ ] **8.8 FM synthesis + waveform visualizer** *(XL, own planning session)*
  - FM operators, noise, a waveform visualizer, and keyframe-animatable mixes (overlaps with 8.4's lane model).
  - Build on 15.7's AudioWorklet voice.
- [ ] **13.29 Draw a waveform to make a tone** *(M, own planning session — added 2026-10-03)*
  - Draw one cycle of a wave to make a custom oscillator for a tone, alongside sine, square, sawtooth and triangle.
  - **Session inputs:**
    - the editor: freehand, or the app's own curve tools on a one-cycle canvas; where it lives in the tone builder;
    - playback: a Web Audio `PeriodicWave` from the drawing's harmonics (band-limited, so no aliasing up high), or a wavetable in 15.7's AudioWorklet voice;
    - how many harmonics to keep, and a preview of the spectrum;
    - the file: tones are saved in the composition's tone library, so the drawing (or its harmonics) goes in the `.gliss` file; WAV export renders it the same way;
    - relation to 8.8 (waveform visualizer, keyframed mixes) and 11.7 (another drawn shape).

### Builds & sharing
- [x] **13.28 Test builds on a subdomain** *(S–M — added 2026-10-03; PR #103)*
  - Publish a static build to a subdomain of the user's site (Namecheap Stellar Plus shared hosting), to share occasional builds with friends for testing.
  - **Steps:**
    - create the subdomain in cPanel, with its own folder; turn on HTTPS (AutoSSL). HTTPS is required: the AudioWorklet voice and Web MIDI only run in a secure context;
    - turn on SSH in cPanel and add a key (Namecheap's shared hosting uses a non-standard SSH port, 21098; check in cPanel);
    - `npm run build` makes `dist/` (`help.html` is already built alongside, in `vite.config.ts`); check the AudioWorklet file comes along, and that it all works from the subdomain's root;
    - an `npm run deploy` script that builds and copies `dist/` over SSH (rsync, or scp). Host, user and folder in an untracked local file, never in the repo;
    - show the build (version or commit, date) somewhere in the app, so testers can say which build they used;
    - an `.htaccess` that keeps `index.html` uncached (asset files are hashed), and optionally password-protects the folder (cPanel's Directory Privacy) to keep it to friends.
  - **Needs from the user:** the subdomain name, and SSH turned on.
  - **Server side, set up 2026-10-04** (walkthrough session): subdomain `gliss.mirimantis.com` (document root `/home/mirifzxt/gliss.mirimantis.com`, its own folder) with an A record in Namecheap's PremiumDNS (the domain doesn't use the hosting's DNS, so cPanel can't add it); shell access turned on (it was off by default); a key per computer; **no automatic SSL in this cPanel**, so **acme.sh** (Let's Encrypt, webroot) issues the certificate and its `cpanel_uapi` deploy hook installs it, renewing from a cron job every 6 hours. Found on the way: the main site's certificate expired Nov 2024; the same acme.sh commands (with `public_html`) could fix it.
  - **Done (PR #103):**
    - `npm run deploy` (`scripts/deploy.mjs`): builds, adds `deploy/.htaccess` (HTTPS only, pages never cached) and `deploy/assets.htaccess` (hashed assets cached for good) and a `build.txt` label, then streams `dist/` as one tar over SSH (one passphrase prompt). On the server it unpacks into a staging folder, then replaces the document root's contents, keeping `.well-known`. Guards: the target must be `/home/<user>/<folder>`, never `public_html`.
    - Settings in `deploy/deploy.env.local` (ignored by git via `*.local`); `deploy/deploy.env.example` documents them.
    - **Build label:** version · commit (+ if uncommitted changes) · date, from `vite.config.ts` (`__BUILD_INFO__`), shown at the bottom of Settings.
- [ ] **13.38 Installable web app** *(S–M — added 2026-10-04; DEFERRED until after the UI redesign, 16.8–16.10)*
  - Make the app installable from the browser (a PWA): added to a phone's home screen or a computer's app list, it opens in its own window with no browser bars, like an app.
  - From multitouch testing (13.33): a web page can't turn off the device's own gestures, and the browser's bars cost canvas on a phone. Installed, the app can open full screen (`display: fullscreen` or `standalone`) and choose its orientation (portrait, for performing on a phone).
  - **Needs:** a web app manifest (name, icons, colours, display mode, orientation), a set of app icons, and a service worker that caches the build so it opens offline. The test site (13.28) already serves it over HTTPS, which installing requires.
  - **Watch:** the deploy's cache rules (pages never cached, hashed assets kept for good) and a service worker's cache must agree, so a new build actually arrives; show the build label (13.28) so testers can tell.
  - The base for a store app later: the Play Store can take an installable web app as it is (Bubblewrap / PWABuilder), and a native wrapper (H.4) packages the same build.
  - **After the redesign** (decided 2026-10-04): the manifest's icons and colours come from 16.9's theme, and the full-screen layout from 16.10.

---

## Horizon (THINKING — not ready to build)

Architecture notes for these are in [DESIGN.md › Ports & hardware](DESIGN.md#ports--hardware-thinking). None starts before Phase 17, except H.4, which packages the web app as it is. Each needs its own planning session.

- **H.1 VST plugin** — MPE / note-expression generator, player/performer scope.
- **H.2 VCV Rack module** — CV source (pitch → 1 V/oct, lanes → CV, per-track gates, clock/reset), player/performer scope.
- **H.3 Motorized-fader hardware** — gravity wells rendered as force. The first step is prototyping the detent feel on the RP2040.
- **H.4 Native app wrapper (app stores)** — the web app inside a native shell (e.g. Capacitor) for the Play Store and App Store, for what a page can't do. Builds on 13.38. *(added 2026-10-04, from multitouch testing, 13.33)*
  - **Android:** immersive mode (the system bars stay hidden; a swipe shows them only briefly); excluding the back-swipe from parts of the side edges (capped at about 200 dp per edge; the home swipe can't be excluded, and a phone maker's three-finger screenshot can't be touched); crisper haptic ticks than the browser's vibrate (13.35).
  - **iPhone / iPad:** haptics at all (Safari has none, so 13.35's clicks would reach iPhones); asking iOS to defer edge gestures to a second swipe; but no Web MIDI in the app's web view, so MIDI input needs native code.
  - **Windows:** little gained for gestures (no app can turn off the system's; that's Settings or Group Policy). A standalone app does get its own per-program entry in the Wacom driver's settings.
  - The user can already lock a device to one app for a session: Android's screen pinning, iOS's Guided Access.
  - Open: worth it for haptics and gestures alone, or only with a reason to be in the stores; store accounts and review; keeping the web and store builds the same.

**Open questions:**

- [ ] **Device protocol spec.** Define the snap-target-map format and the position → pitch stream early. It is the through-line from mouse → RP2040 → custom PCB → plugins. The `Lane.gravity` field and the envelope's `tuning` / `snap` sections are the payload skeleton.
- [ ] **Dynamics on the hardware.** The fader is the pitch axis; what drives the swell? Cap pressure/aftertouch, a second fader, an expression pedal, or breath?
- [ ] **Fader resolution vs. range.** A 10–12-bit ADC over 9 octaves may be too coarse. Should the fader cover a shiftable 1–2 octave window with octave-shift controls?
- [ ] **Whole-composition portability to timeline-less hosts.** Portability is strongest at the preset/gesture layer. Playing a whole timed piece in a modular patch needs a clock/playback story.
- [ ] **Layer → voice mapping on export.** How stacked layers map to MPE channels, CV outputs or downstream voices, given the ~15/16-channel limits.
- [ ] **Software license.** Is the free app open source? The VCV ecosystem leans GPLv3, which affects the shared-codec plan (17.3).
- [ ] **Business model.** The software is free as the adoption funnel and the slide hardware is sold. Felt gravity is the value proposition, so detent fidelity is the central bet. Open: should the device protocol be open (invites community hardware) or closed (protects the hardware business)?

---

## Shipped

Condensed record, kept so `BACKLOG x.y` references in code comments still resolve. Details are in the PRs and git history.

**Phase 1 — Curve actions:**
- 1.1 anchor wins over handle hit-test
- 1.2 single planchette
- 1.3 Sharpen Curve (Alt+S)
- 1.4 Smooth Curve (Shift+S) + shared auto-smooth ratio

**Phase 2 — UI:**
- 2.1 dedicated tool panel
- 2.2 right-click context menu

**Phase 3 — Transport:**
- 3.1 metronome
- 3.2 time-signature presets

**Phase 4 — Input:**
- 4.1 live MIDI input

**Phase 5 — Snap:**
- 5.1 Glide snap (later removed in 7.1)
- 5.2 Magnetic snap

**Phase 6 — Harmonic Prism:**
- 6.1 projection mode (PR #36)
- 6.2 draw mode + groups (PR #37)
- 6.3 perform mode (PR #39)

**Phase 7 — Polish:**
- 7.1 Glide removed
- 7.2 auto-smooth handle-length slider
- 7.3 fixed-width Pitch HUD
- 7.4 PageUp/PageDown to first/last point
- 7.5 "MIDI Input" label
- 7.6 MIDI-unsupported tooltip

**Phase 8 — Captured during Prism work:**
- 8.1 hotkeys suppressed while editing the name (PR #41)
- 8.2 move curve to another track (PR #47)
- 8.3 multi-select points + marquee (PR #51)
- 8.5 snap settings saved in the composition (PR #42)
- 8.6 snap presets (PR #42)
- 8.7 user snap guides + lock (PR #42)
- 8.9 Home centres on the playhead (PR #41)
- 8.10 PageUp on an empty canvas goes to 0 (PR #41)
- 8.11 MIDI input recording (PR #43)
- 8.13 per-voice octave offsets (PR #49)
- 8.17 Perf HUD + stress fixture (PR #53)
- 8.18 live recording trail (PR #50)
- 8.19 Key "Chromatic" + true "None" (PR #46)
- 8.20 AFK timer respects loop / future content (PR #45)
- 8.21 held MIDI note survives the loop wrap (PR #54)
- 8.22 MIDI AFK hardware verification (PR #52)
- 8.23 cross-track curve selection (PR #48)
- 8.24 pitch bend in MIDI import (PR #55)
- 8.25 live pitch-bend wheel (PR #55)
- 8.26 24-TET (PR #56)
- 8.27 Tune A4 (PR #56)
- 8.28 Hz readout on the Pitch HUD (PR #56)

**Phase 9 — Performance & architecture:**
- 9.1 voice-pool playback + loop reuse (PR #61)
- 9.2 folded into 15.5

**Phase 10 — Jam & looper:**
- 10.1 free-running jam clock (PR #63)
- 10.2 rolling buffer + Keep (PR #64)
- 10.3 layer-per-pass looping (PR #65)
- 10.4 drop last pass (PR #65)
- 10.5 record next full pass (PR #66)

**Phase 11 — Dynamics:**
- 11.1 dynamics bus + key-held swell (PR #67)

**Phase 13 — Captured 2026-08-10:**
- 13.1 Force label (PR #69)
- 13.2 snap presets hold feel only (PR #69)
- 13.3 fresh canvas starts at 0:00 under the rail (PR #70)

**Unnumbered:**
- icon-rail UI + Parameters Graph (PR #58)
- SVG icon normalizer (PR #59)
- cents + lanes unified model, composition v4 (PR #60)
- transform box keeps non-pitch lanes time-locked (PR #62)

---

## Housekeeping

- Update [help.html](help.html) in the same PR as each user-visible change. It is the canonical user manual and shortcut reference.
- **Keep touch in mind (13.27, deferred):** when building, don't make a later touch interface harder than it needs to be. Avoid features that only work by hover or only by a key (give them a button or menu entry too), keep hit targets from shrinking, and route new input through the Pointer Events input router.
- Test hands-on in the dev server before opening a PR. The dev server is `npm run dev`, on port 5187.
- Share a test build with `npm run deploy` (`npm.cmd run deploy` in PowerShell) to https://gliss.mirimantis.com (13.28). Commit first, so the build label has no `+`.
- Tick items off here in the PR that ships them, with the PR number.
- Build plans for items with a planning session go in `.claude/plans/<id>-<slug>.md` while the item is in flight. Delete them once the item ships; the PR and this file are the record.
