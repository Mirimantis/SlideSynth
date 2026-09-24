# Roadmap & Backlog

**The single place for planned work.** Design rationale lives in [DESIGN.md](DESIGN.md); nothing in DESIGN.md is a schedule. Item numbers are stable — code comments cite them as `BACKLOG x.y` — so shipped numbers are never reused.

Sizes: XS / S / M / L / XL. Items marked **own planning session** need a design pass before any code.

---

## Current direction (2026-09-24)

A full-project review (findings in [DESIGN.md › Current architecture](DESIGN.md#current-architecture-as-of-2026-09-24)) concluded:

- The vision and data model are sound, and TypeScript + the web stay.
- The code is fractured: a ~4,400-line `main.ts`, an implicit perform state machine, and a notify-everything store with hand-synced UI.
- The interface has too many overlapping modes.

**New feature work is paused.** Work proceeds in this order:

1. **Phase 14 — Stabilize.** Confirmed bugs and repo hygiene. Small and immediate.
2. **Phase 15 — Consolidate the architecture.** Moves the code to the [target architecture](DESIGN.md#target-architecture).
3. **Phase 16 — Simplify the interface.** Starts with its own design session.
4. **Phase 17 — Portable core.** Can interleave with 15–16. Must be done before any port begins.

The [queued features](#queued-features-paused) resume after Phase 16. Several of them will be reshaped or absorbed by Phases 15–16; each entry notes where.

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
  - **Still to migrate:** Prism panel, drawers' contents, toolbar, tone builder/picker and dialogs. Most of these are reshaped by Phase 16, so they move with it (16.2–16.5).
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
- [ ] **15.8 Kernel test coverage** *(M)*
  - Unit tests for snap (`snap.ts`), magnetic physics (`snap-magnetic.ts`), `bezier-math`, `curve-sampler` and the scheduler's timing math, plus 15.2's state machine.
  - These become the cross-runtime conformance suite in Phase 17.

---

## Phase 16 — Simplify the interface

- [x] **16.1 Interface design session** *(L, own planning session)*
  - Produce a UI spec in [DESIGN.md › Interface principles](DESIGN.md#interface-principles) before any code.
  - **Done (2026-09-24):** the spec is [DESIGN.md › Interface spec](DESIGN.md#interface-spec-phase-16-decided-2026-09-24). Decisions:
    - **Perform is a tool** (P). The left button always does what the selected tool does. Lock Rail is retired as a mode: Perform always uses the rail view, and scrolling during playback is a View option for the edit tools. Perform while stopped auditions.
    - **Jam folds into Play.** Play with the Perform tool is open-ended; with an edit tool it stops at the end of the content unless Loop is on. J is unbound.
    - **Record is a split button** whose menu holds Record one pass, Drop last pass, New track per pass (was Layer) and Count-in.
    - **Space is Play/Pause only.** Holding A auditions, and scrubbing is audible by default.
    - **MIDI arm stays per track**, as an icon.
    - **Scrubbing in the rail view scrolls the content live**, so the playhead is always the rail beat.
    - **The drawers are replaced:**
      - a tool strip;
      - a Gravity panel (Snap + Tuning drawers);
      - the Prism panel;
      - Edit and View menus;
      - a Settings dialog;
      - Loop, tempo and metronome in the top bar.
    - **Names:**
      - Prism's "Tuning" becomes Intonation;
      - Tool / Object Properties become Tool / Selection;
      - track-row letters become icons plus a ⋯ menu.
  - **Inputs from the review** (kept for the record):
    - **One capture model.** The rolling buffer always runs while the transport rolls, so Jam folds into Play, Keep is always available, and Record = keep everything. Record-next-pass, Layer and MIDI-arm become options of one capture control. Revisit 10.1–10.5's separate controls accordingly.
    - **Visible perform state.** If the left mouse button performs instead of edits, that is an explicit, visible Perform state, not something implied by Lock Rail + transport.
    - **A Gravity panel.** Key, scale, Tune A4, snap on/off, magnetic Force/Spring/Damping, presets and guides in one place. This takes the UI half of 13.8.
    - **Tools always visible** as a strip, not in a drawer.
    - **A View menu** next to File: Pitch HUD, Perf HUD, guide visibility, user manual. *(Guide visibility went to the Gravity panel instead, because hiding guides also stops them pulling.)*
    - **A Settings dialog:** MIDI device, dynamics source, metronome volume, other preferences. *(Dynamics source went to the Perform tool's settings instead.)*
    - **Each control exists once.** Loop is currently in both the top bar and the Transport drawer.
    - **Clear names.** Fix the "Tuning" collision: the drawer vs. the Prism JI/ET field. Replace the single-letter M S I T X track buttons.
    - **Space key.** Reconsider tap-vs-hold (250 ms) for transport vs. preview.
    - **Scrubbing with Lock Rail on** (found in 15.2 testing). Scrubbing the top ruler moved only the stored playhead, which the Lock Rail view never shows, and Play started from the rail beat anyway.
    - **Group visibility** — see 13.12.

Implementation, in suggested order. Each item moves the chrome it touches onto Preact components (finishing 15.4's "still to migrate") and updates [help.html](help.html) in the same PR.

- [ ] **16.2 Perform tool + one capture model** *(L)*
  - **Perform tool:**
    - Add the Perform tool (P).
    - The input router asks the tool, not Lock Rail + transport, whether a press performs.
    - Perform always uses the rail view.
    - Perform while stopped auditions.
    - R selects Perform.
  - **Transport (`state/transport.ts`):**
    - Fold the jam clock into Play. The clock is open-ended while the Perform tool is active.
    - Remove J and the Jam button.
    - Pause works during a Perform play.
  - **Lock Rail:** retire the switch. Add *Scroll canvas during playback* as a workspace preference (a temporary toggle until 16.3 adds the View menu).
  - **Scrubbing:** in the rail view, the ruler drag scrolls the content live under the rail.
  - Migrate the saved `scrollCanvasEnabled` preference to the new view option.
- [ ] **16.3 Top bar, menus and Settings** *(M–L)*
  - **Top bar:** transport with the Record split button and its menu, Keep, Loop, BPM / time signature / metronome, the Snap switch.
  - **Menus, generated from the command catalog:** Edit (new) and View.
  - **Settings dialog:** MIDI device, metronome volume, audible scrub.
  - The Transport drawer goes away.
- [ ] **16.4 Tool strip, Gravity panel, Prism names** *(L)*
  - **Tool strip:** the always-visible strip replaces the Tools drawer. It carries the Prism chord badge on Draw and Perform.
  - **Gravity panel:** replaces the Snap and Tuning drawers.
    - "Pull: Hard / Magnetic" replaces the Magnetic switch.
    - The Key / Scale controls stay as they are until 13.8.
  - **Prism panel:** "Tuning" becomes Intonation.
- [ ] **16.5 Right panel, track rows, groups** *(M)*
  - **Right panel:** the sections become Tool and Selection. The dynamics source moves into Perform's Tool section.
  - **Track rows:** Mute, Solo and MIDI-arm become icons; Edit tone and Delete move to a ⋯ menu.
  - **Groups:** 13.12's UI half — the group line and Ungroup button in Selection, Ungroup on the transform box, and the shared outline on the canvas.
- [ ] **16.6 Space and audition** *(S)*
  - Space becomes Play/Pause only.
  - Holding A auditions: the Draw preview, and the guide pitch while dragging (absorbs 13.6).
  - Scrubbing is audible by default; *Settings › Audible scrub* turns it off.
  - Can go before or after 16.2–16.5.

---

## Phase 17 — Portable core

Required before any VST, VCV or hardware work starts (see [Horizon](#horizon-thinking--not-ready-to-build)).

- [ ] **17.1 Isolate `src/core/`** *(M)*
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

## Queued features (paused)

Resume after Phase 16. Grouped by area; roughly easiest-first within a group.

### Editing & canvas
- [ ] **13.4 Pitch ruler down the left edge** *(M)*
  - Note names and octaves with adaptive label density, mirroring `getAdaptiveBeatStep`.
  - Respects Key, including true-None mode, and the Tune A4 setting (`centsToNoteName`).
  - The ruler costs canvas width, so every hit-test that assumes X starts at 0 needs the same treatment `RULER_HEIGHT` gets on the Y side.
  - Prerequisite for the Y half of 13.5.
- [ ] **13.5 Create guides by dragging out of the rulers** *(M)*
  - Drag down from the top ruler to create an X guide; drag out of the pitch ruler (13.4) to create a Y guide. Release back over the ruler to cancel.
  - Reuse the existing guide-drag path, including self-excluding snap.
  - A click without a drag still scrubs the playhead. The Add buttons stay as the keyboard-reachable path.
- [ ] **13.6 Audition a Y guide's pitch while dragging** *(S)*
  - Sounds the snapped pitch on the current track's tone. Sequence after 13.5.
  - **Absorbed by 16.6** (2026-09-24): the key is hold A, not Space. Y guides can already be dragged, so this doesn't need to wait for 13.5.
- [ ] **13.9 Octave highlight follows the key root** *(S)*
  - The staff highlights C lines to show octaves. In a key without C (e.g. G♯ harmonic minor) there's no octave marker at all.
  - Highlight the key's root instead.
- [ ] **13.10 Curves as gravity** *(M, own planning session)*
  - Convert a curve into a snappable guide.
  - Option for muted tracks to render dimmed but stay snappable.
  - A per-track hide button, distinct from mute.
  - Related to 12.1: a curve is another gravity source.
- [ ] **13.11 Recording simplification density** *(S–M)*
  - A setting to keep all recorded points, or 1/2, 1/4, 1/8, instead of today's fixed RDP fit.
  - Option to run simplification later on a kept curve (relates to 12.4 raw takes).
- [ ] **8.4 Parameter lanes UI — remaining** *(M, own planning session)*
  - The Parameters Graph below the canvas shipped in PR #58, showing the selected curve's volume lane.
  - Remaining: more lane types (pan, cutoff, per-layer mix), show/hide/solo per lane, and a lane picker.
  - Inherits the "functional curve, lane-agnostic gravity" framing from the lanes model.

### Groups

Curves group by a shared `groupId` (Harmonic Prism chord clusters, and freehand `Ctrl+G` groups). There is no group object: a group is just the curves that carry the same id. 13.13 and 13.14 would likely need one — a first-class group entity with an id, and room for its own lanes — which is a data-model change with a composition-version bump and migration.

- [ ] **13.12 Make grouping visible, and ungrouping easy** *(S–M — UI half is 16.5)*
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
    - copy / paste / duplicate / join semantics.
- [ ] **13.14 Group isolation mode** *(M–L, own planning session)*
  - Explore an Adobe Illustrator-style isolation mode: enter a group (double-click it, or a button) to edit its members individually without ungrouping. Everything outside the group fades and ignores input; Esc or clicking outside exits.
  - **Session inputs:**
    - entry and exit gestures, and how the canvas shows you're inside;
    - which tools work inside (point edits, adding a member, removing one);
    - how it interacts with transform-box group expansion (today selecting one member selects the whole group);
    - fits the input router (15.2) as an input-scope filter: hit-tests limited to the isolated group;
    - reuses 8.23's non-active dimming for the fade.

### Snap, harmony & tuning
- [ ] **13.8 Tuning / key / scale model rework** *(L, own planning session)*
  - The Key + Scale dropdowns mix two orthogonal axes: the **tuning** (which pitch classes exist) and the **subset/mode**. `24tet` and `thai-7tet` are tunings sitting in a mode list, and the maqams fuse both.
  - **Direction (settled 2026-08-10):** no strict cascade.
    - Group like with like into overlapping sections.
    - Parameterize the generative families: EDO by N and equave, possibly MOS, JI by limit.
    - Allow `.scl` import.
    - Keep reference pitch as a separate, always-visible control.
    - Recommended core: **Tuning / Root / Scale** as three controls.
  - **Load-bearing data change:** `scaleRoot` is quantized to 12-EDO (0–11). Generalize it to a cents offset or degree index, with a migration and golden-format shim.
  - **Open question:** does the staff keep the 12-EDO substrate under non-12 tunings? This decides whether the app is a 12-EDO tool with microtonal decoration or genuinely tuning-agnostic.
  - The UI half is now part of Phase 16's Gravity panel. This item owns the model.
  - The full research report, with sources and ten open questions, is in [.claude/plans/13.8-tuning-taxonomy-research.md](.claude/plans/13.8-tuning-taxonomy-research.md).
- [ ] **12.1 Snap-target composition + snap-to-sounding-harmony** *(L, own planning session — after 15.6 and 13.8)*
  - First define how gravity sources combine into one target set. Today Prism projection targets *replace* the others while active, guides are additive, and scale vs. chromatic are exclusive.
  - Then let the sounding bed (a drone or Prism chord) become the magnetic target: "you snap to the harmony you're actually in."
  - **Session also owns:**
    - dense-bed resolution: nearest, weighted, or limited targets;
    - whether snapping to a drone uses the current temperament or pure JI.
- [ ] **8.12 Chord-spec favorites on number keys** *(M)*
  - Retune voices mid-perform without the mouse. The live-retune plumbing already exists.
  - Bind through 15.3's command registry.
- [ ] **8.14 Chord-label readout on selected groups** *(S)*
  - Honest about microtonal bases, e.g. "C(+17¢) major".
- [ ] **8.15 "Lite harmonies" audio mode** *(S)*
  - Sine-only harmony voices for CPU relief.
- [ ] **8.16 Secondal stacking** *(S)*
  - Cluster chords. Low priority.

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
  - **Session inputs:**
    - mapping (magnitude only, or does direction matter?);
    - smoothing vs. latency;
    - rest behaviour when the cursor is still;
    - sharing one sensitivity curve with 11.3.

### Transport & looping
- [ ] **3.2b Custom rhythm patterns** *(M, own planning session)*
  - Define what a "pattern" is (accent map? mixed meter?) before any code.
- [ ] **13.7 Monophonic MIDI input with auto-glissando** *(M, own planning session)*
  - A mono mode ends the previous note on each noteOn, so curves never overlap; consecutive notes join with a glissando.
  - **Session inputs:**
    - glide shape and duration — avoid reviving 7.1's too-narrow Glide slider;
    - one merged curve vs. per-note curves plus joins;
    - legato vs. detached playing;
    - interaction with loop wrap (8.21) and pitch bend (8.25);
    - the session boundary.
- [ ] **10.6 Live loop in/out taps, bar-quantized** *(S–M, DEFERRED 2026-07-30)*
  - Revisit only if setting loop points mid-jam proves necessary; dragging the ruler markers covers it for now.

### Files & formats
- [ ] **12.3 Round-trip unknown top-level envelope sections** *(S)*
  - `serializeComposition` rebuilds the envelope from a fixed key set, so a future `hostSettings` section would be dropped on load→save. Carry unknown keys through verbatim.
  - Cheap, and core to the round-trip guardrail. It can be pulled forward into Phase 17 at any time.
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

### Sound
- [ ] **8.8 FM synthesis + waveform visualizer** *(XL, own planning session)*
  - FM operators, noise, a waveform visualizer, and keyframe-animatable mixes (overlaps with 8.4's lane model).
  - Build on 15.7's AudioWorklet voice.

---

## Horizon (THINKING — not ready to build)

Architecture notes for these are in [DESIGN.md › Ports & hardware](DESIGN.md#ports--hardware-thinking). None starts before Phase 17. Each needs its own planning session.

- **H.1 VST plugin** — MPE / note-expression generator, player/performer scope.
- **H.2 VCV Rack module** — CV source (pitch → 1 V/oct, lanes → CV, per-track gates, clock/reset), player/performer scope.
- **H.3 Motorized-fader hardware** — gravity wells rendered as force. The first step is prototyping the detent feel on the RP2040.

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
- Test hands-on in the dev server before opening a PR. The dev server is `npm run dev`, on port 5187.
- Tick items off here in the PR that ships them, with the PR number.
- Build plans for items with a planning session go in `.claude/plans/<id>-<slug>.md` while the item is in flight. Delete them once the item ships; the PR and this file are the record.
