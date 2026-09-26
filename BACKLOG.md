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
  - **Still to migrate:** the Tuning drawer's contents (Key/Scale toolbar, Tune A4), tone builder/picker and the older dialogs. The Tuning drawer moves with its redesign (13.8). *(16.3 moved the top bar, menus, Settings and the Tempo drawer; 16.4 the tool strip, Snap drawer and Prism panel.)*
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
  - **Revisit (2026-09-26):** the ruler is now also the scrub strip (audible by default, 16.3), so a drag out of it is ambiguous. Frets (Y guides) get a dedicated handle instead (13.17). The X half can use the same kind of handle, if a ruler drag still conflicts when this is built.
- [x] **13.6 Audition a Y guide's pitch while dragging** *(S — done in 16.6, PR #85)*
  - Sounds the snapped pitch on the current track's tone. Sequence after 13.5.
  - **Absorbed by 16.6** (2026-09-24): the key is hold A, not Space. Y guides can already be dragged, so this doesn't need to wait for 13.5.
- [x] **13.9 Octave highlight follows the key root** *(S — done in 13.8 (b), PR #89)*
  - The staff highlights C lines to show octaves. In a key without C (e.g. G♯ harmonic minor) there's no octave marker at all.
  - Highlight the key's root instead.
- [ ] **13.11 Recording simplification density** *(S–M)*
  - A setting to keep all recorded points, or 1/2, 1/4, 1/8, instead of today's fixed RDP fit.
  - Option to run simplification later on a kept curve (relates to 12.4 raw takes).
- [ ] **8.4 Parameter lanes UI — remaining** *(M, own planning session)*
  - The Parameters Graph below the canvas shipped in PR #58, showing the selected curve's volume lane.
  - Remaining: more lane types (pan, cutoff, per-layer mix), show/hide/solo per lane, and a lane picker.
  - Inherits the "functional curve, lane-agnostic gravity" framing from the lanes model.

### Frets (pitch guides)

Y guides become **frets**: a music word for "a pitch you can land on", instead of the maths word. X guides are unchanged. The data model keeps `GuideDefinition` and its `orientation`, so files don't change; this is naming and UI first.

- [ ] **13.16 Rename Y guides to Frets** *(S)*
  - Everywhere the user reads it: the Snap drawer (**+ Y** becomes **+ Fret**), the Selection panel ("Snap Guide" → "Fret"), tooltips, toasts.
  - The help describes them as **frets (pitch guides)**, so the music term leads and the plain description follows.
  - Consider "beat guides" for X guides in the same pass, so neither is called by an axis letter.
- [ ] **13.17 Drag a fret out of a corner handle** *(S–M)*
  - A small handle where the rulers meet the staff's left edge (top-left corner of the canvas). Drag from it onto the canvas to place a new fret at the pitch you drop it on; release back over the handle to cancel.
  - Dragging out of the ruler itself would fight the playhead scrub (see 13.5), so the handle is separate.
  - Reuse the guide-drag path: self-excluding snap, the audition while A is held (16.6), and select-on-drop.
  - **+ Fret** in the Snap drawer stays as the non-drag path.
- [ ] **13.18 Octave frets** *(M)*
  - A **Single / Octaves** toggle in the fret's Selection panel. With Octaves, the fret repeats in every octave across the canvas.
  - Every instance is the same fret: selecting any instance selects it, and dragging any instance moves them all by the same interval.
  - Toggling back to Single keeps only the originally placed fret; the other instances disappear.
  - **Data:** an optional field on the guide (e.g. `repeat: 'octave'`) that round-trips; the stored `position` stays the originally placed one. Dragging an instance moves that position by the drag's delta.
  - **Snap:** the one snap-config builder (15.6) expands a repeating fret into its octave targets, so snapping, Gravity and rendering all agree.
  - **Non-octave tunings** (13.8): "Octaves" repeats every period of the tuning, which is the octave except in tunings like Bohlen–Pierce.
  - Octave frets are what 13.8 (f) converts to and from a scale.
- [ ] **13.22 Hide / show all frets** *(S)*
  - One switch that hides every fret at once and brings them back, without touching beat guides.
  - Today the Snap drawer's guide visibility covers both kinds, and hiding also stops them pulling (why 16.3 kept it out of the View menu).
  - **Decide when building:**
    - Where it lives. The Tuning drawer, beside Pitch lines, if hidden frets also stop pulling (the same meaning as Pitch lines: hidden = no lines, no pull). The View menu if it's display only and hidden frets still pull.
    - A command-catalog entry either way, so it can take a shortcut and appear in the menus.
- [ ] **13.19 Per-fret gravity** *(M–L, own planning session)*
  - Feasibility of letting a fret carry its own snap parameters. New frets follow the universal Snap settings; a per-fret toggle enables custom settings: Gravity on/off, Force, Spring, Damping and an **effect distance** (reach).
  - Within its reach, a custom fret takes precedence over the canvas's scale lines.
  - **Session inputs:**
    - the physics: today `snap-magnetic` has one global spring and force, with proximity-weighted attraction. Per-target force and reach fit a potential-field model; per-target spring and damping don't obviously (they describe the planchette, not the well). Decide which parameters are really per-fret;
    - the precedence rule: inside a custom fret's reach, are scale targets suppressed, or just outweighed?;
    - how it combines with octave frets (13.18) and curve pitch guides (13.10);
    - UI in the Selection panel, and whether presets (13.2) can hold per-fret feel;
    - the snap-target composition work (12.1) and the device protocol's target map (Horizon), which would carry per-target feel to hardware.
- [ ] **13.10 Curves as pitch guides** *(M, own planning session)*
  - Turn any pitch curve into a **pitch guide**: it keeps its shape, snaps like a fret (a target that moves over time), and makes no sound.
  - **Not a fret** (2026-09-26): a fret is one pitch, and a curve guide isn't, so it's called a pitch guide. For the same reason it can't join a scale or the staff (13.8 (f) converts octave frets only).
  - **A mute mode, perhaps, rather than a conversion:** a muted track's curves could render dimmed and stay snappable, as pitch guides. Then "make this curve a guide" is "move it to a guide track", with no new kind of object, and unmuting brings it back as sound. The session decides whether that's a per-track choice (mute silent / mute as guide) or what every mute does.
  - A per-track hide button, distinct from mute.
  - Related to 12.1 (a curve is another gravity source) and 13.19 (whether a pitch guide can carry its own gravity).

### Groups

Curves group by a shared `groupId` (Harmonic Prism chord clusters, and freehand `Ctrl+G` groups). There is no group object: a group is just the curves that carry the same id. 13.13 and 13.14 would likely need one — a first-class group entity with an id, and room for its own lanes — which is a data-model change with a composition-version bump and migration.

- [ ] **13.12 Make grouping visible, and ungrouping easy** *(S–M — UI half done in 16.5, PR #84)*
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
- [ ] **13.8 Tuning / key / scale model rework** *(L — planning session held 2026-09-26)*
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
    - [ ] **(d) `.scl` import and export** *(S–M)*
      - Import into an Imported tuning, with the description line treated as untrusted text.
      - Export the notes you hear, from the root.
      - A performance check with a large file (e.g. 43 or 192 notes).
    - [ ] **(f) Frets ↔ scale** *(M — after 13.18 and (c))*
      - Scale → octave frets.
      - Octave frets → a Custom scale, or a Custom tuning if any fret is off the tuning's degrees. Single frets stay as they are.
  - **Deferred:**
    - **(e) Scale generator for other equal divisions** — MOS: large and small step counts plus mode rotation; the MIT `moment-of-symmetry` library covers the maths. A second editor, so its own item.
    - **Retuning on the circle** — dragging a degree around the pitch circle to make a Custom tuning directly. The frets route (f) covers it for now.
    - **"Make home" on the circle** — a gesture (e.g. Alt+double-click) that changes the root but keeps the same notes: C major's dots with A as home is A natural minor. Recognise a named scale when the rotation is one, else keep it Custom.
- [ ] **13.21 Prism chords per note in unequal tunings** *(M — first slice S)*
  - Since 13.8 (b), Equal intonation in an unequal tuning (Werckmeister, meantone, just intonation) builds every chord from the root's intervals. So a chord on any other note is the root chord moved, and every key sounds the same.
  - **Add a second option**, e.g. Intonation **Tuning (per note)** beside **Equal (from root)**: the chord uses the tuning's own notes above the base, as a keyboard in that temperament would. E major's third in Werckmeister is wider than C major's.
  - **The rule** (deterministic): find the tuning's note nearest the base, count up the chord's degrees from it (in a 12-note table the semitone counts; otherwise the step counts from 13.8 (b)), and shift the whole chord by the base's offset from that note.
  - **Expect:** well temperaments give each key its colour, as intended. Meantone, Pythagorean and 5-limit just intonation hit their wolf intervals on some chords (D minor in 5-limit has a fifth about 20¢ flat), historically honest but possibly surprising. Equal tunings give the same result either way.
  - **The cost is movement**, not the rule: today a chord's offsets are constant, so harmony voices are parallel copies of the curve. Per note, the shape changes as the base crosses between notes.
  - **First slice (S):** Prism Draw clicks and performing. The shape is taken at the note's start and held through the glide, so harmony voices never jump mid-note. Projection echoes keep the from-root shapes.
  - **Then (M):** projection echoes per note: sampled and drawn in steps instead of as shifted copies. Their snap targets are already computed at each beat, so those are easy.
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
- [ ] **13.15 Gravity feel preview** *(M)*
  - A small animated waveform in the Snap drawer showing what Force, Spring and Damping do: its amplitude, frequency and falloff change as you move the sliders.
  - Drive it from the real `snap-magnetic` integrator (a step response into a well), so the preview is the feel, not an illustration of it.
- [ ] **12.1 Snap-target composition + snap-to-sounding-harmony** *(L, own planning session — after 15.6 and 13.8)*
  - First define how gravity sources combine into one target set. Today Prism projection targets *replace* the others while active, guides are additive, and scale vs. chromatic are exclusive.
  - Then let the sounding bed (a drone or Prism chord) become the magnetic target: "you snap to the harmony you're actually in."
  - **Session also owns:**
    - dense-bed resolution: nearest, weighted, or limited targets;
    - whether snapping to a drone uses the current temperament or pure JI.
- [ ] **8.12 Chord-spec favorites on number keys** *(M)*
  - Retune voices mid-perform without the mouse. The live-retune plumbing already exists.
  - Bind through 15.3's command registry.
  - The tuning hot bar (13.23) also wants 1–0: settle the split in its session.
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
  - **Gates (for Eurorack MIDI-to-CV modules and the like):** MIDI has no separate gate message. The module raises its gate on note-on and drops it on note-off, so a curve bracketed by one note-on and one note-off already gives one gate. What needs care is the glissando:
    - **bend range:** a glide wider than the receiver's pitch-bend range forces a new note, which retriggers the gate and envelope. Send the range with RPN 0 (MPE's default is ±48 semitones), so one note can cover most glides;
    - **legato:** where a new note is unavoidable, send its note-on before the old note-off. Most MIDI-to-CV modules treat that as legato and don't retrigger;
    - **clock:** tempo sync (MIDI clock / start / stop) is separate from gates. Export would write it only if a sequencer needs to follow the piece.
  - Direct CV output with an explicit gate per curve (1 V/oct pitch + gate + volume CV) is H.2's VCV Rack path, not MIDI.

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
