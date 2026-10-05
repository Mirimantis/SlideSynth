# Glissandograph — Design Document

What the app is, why it exists, how it is built today, and the architecture and interface it is moving toward. **Planned work lives only in [BACKLOG.md](BACKLOG.md)** — this document describes design, not schedule. User-facing behavior and the keyboard-shortcut reference live in [help.html](help.html).

> **Direction (2026-09-24).** A full-project review found the product vision and data model sound, but the code fractured (a ~4,400-line `main.ts`, an implicit perform state machine, a notify-everything store with hand-synced UI) and the interface overloaded with modes. New feature work is paused until the stabilize → consolidate → simplify phases in the backlog (Phases 14–16) land. The [Target architecture](#target-architecture) and [Interface principles](#interface-principles) sections below are the new direction.

---

## North Star

> **Pitch is a continuous field. "Notes" are optional landmarks within it — gravity wells you can lean on or ignore.**

Most music tools treat pitch as categories with continuous motion bolted on: discrete note numbers, pitch-bend as an afterthought. Glissandograph inverts this. The user draws or performs Bezier curves on a pitch/time canvas; the curve *is* the sound — pitch and volume shaped continuously, like a trombone, theremin or voice.

**Magnetic snap is the inversion made tangible:** adjustable gravity, not a mandatory grid. Scale lines, just-intonation targets, user guides and (future) the currently sounding harmony are all gravity-well configurations over the same field.

**The instrument's ancestor is the voice, not the keyboard.** Expression lives in the swell — pitch *and* volume shaped within one sustained tone. Each loop layer is a voice; the looper assembles a choir.

Musical practices the design honors:

- **Voice, not piano** — performed dynamics within a note matter more than note onsets.
- **Just intonation over drones** — pure thirds and fifths ring in a way equal temperament can't; the Harmonic Prism's JI ratios and microtonal scales are the app's biggest sonic lever.
- **Register separation** — drone low, harmony mid, lead high.

### What is the product, and what is scaffolding

- **The portable kernel (the product):** live gestural pitch, magnetic snap, Harmonic Prism chords, live looping of the above. This is what future plugin and hardware ports exist for.
- **Prototype scaffolding:** the timeline/score editor, WAV export, MIDI import. Useful, but not where polish should go first.

**The browser app is the studio.** Planned ports (VST, VCV Rack, motorized-fader hardware — see [Ports & hardware](#ports--hardware-thinking)) are *players/performers* that consume the same files, not second editors.

---

## Guardrails

Honored now so future ports stay cheap:

1. **Frozen cents anchor.** Canonical pitch is cents from C-1 (MIDI 0 ≈ 8.1758 Hz). 100 ¢ = semitone, ¢ ÷ 100 = MIDI note number, A4 = 6900 ¢. The anchor never changes. Concert pitch (Tune A4, stored as `tuningOffsetCents`) rides on top and never rewrites stored curves.
2. **Musical time in beats**, never seconds.
3. **Generic lanes.** Every automatable variable is the same lane primitive; the reserved per-lane `gravity` field round-trips verbatim.
4. **Round-trip rule.** Re-saving a file must preserve unknown sections verbatim so files survive crossing runtimes. *(Closed in 12.3: unknown top-level envelope sections, and unknown keys in `meta`, `tuning` and `snap`, ride along in `Composition.unknownEnvelope`; the composition section, snap settings, guides and lanes already kept theirs by spreading.)*
5. **The `tuning` + `snap` envelope sections are the portable "gravity map"** — the same payload the hardware protocol and plugin ports will consume.
6. **Timbre is browser-only.** The shared contract is gesture + gravity map + structure; host-specific settings belong in namespaced advisory blocks.
7. **Store heard pitch as ground truth.** Curves hold the post-snap pitch that was actually heard, so playback is identical everywhere; snap config drives editing and feel, not reproduction.

---

## Technology

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript (strict) | Kept — see below |
| Build | Vite | Dev server on port 5187 |
| Rendering | HTML5 Canvas 2D | Background (staff, rulers) and foreground (curves, playhead, interaction) canvases, plus a Parameters Graph canvas |
| Audio | Web Audio API | Oscillator/gain graphs per voice; `AudioParam` automation; `OfflineAudioContext` for WAV export |
| State | `@preact/signals-core` (MIT) | Fine-grained store subscriptions (BACKLOG 15.1) |
| UI chrome | Preact (MIT) + `@preact/signals` for panels; vanilla DOM for the rest | Migrating panel by panel (BACKLOG 15.4) — see [Target architecture](#target-architecture) |
| Tests | Vitest | |
| Input | Mouse, Web MIDI | Pointer Events (pen), Gamepad and Web Serial planned |

### Why TypeScript and the web stay

The 2026-09-24 review asked whether TypeScript was the right base. It is. The fracture is architectural and would exist in any language. The web is the right home for the studio: zero-install (the free app is the adoption funnel for the hardware), Web MIDI and Web Serial for the prototype hardware, fast iteration.

The two real platform limits have targeted answers that don't require leaving the web:

- **Control rate.** Live pitch is driven from the main thread at mouse/frame rate. The answer is an **AudioWorklet** voice that smooths pitch and gain at audio rate (and can later run the magnetic integrator there) — BACKLOG 15.7, done: `src/audio/live-voice.ts`. The worklet emits control signals into the tone's native oscillators, so live and scheduled notes share one timbre.
- **Code sharing with C++ ports.** VST and VCV Rack are C++. The answer is to keep the kernel (cents math, curve evaluation, snap + magnetic physics, `.gliss` codec) **pure and fully tested** now, so porting it is translation rather than excavation, and to decide C++ vs. Rust→WASM vs. an independently implemented spec only when the first port begins — BACKLOG Phase 17.

### Why the "no framework" decision is being revisited

The original rationale was that the UI is ~90% canvas with only a handful of DOM controls. That no longer holds: the chrome has ~36 buttons, ~29 inputs, ~11 selects, drawers and dialogs, all synced to state by hand. Hand-syncing is the source of real bugs (e.g. the tool panel showing Draw while the active tool is Select). The canvas stays imperative; the panels move to a small reactive component layer (recommended default: Preact + `@preact/signals`, confirmed at the start of BACKLOG 15.4).

---

## Current architecture (as of 2026-09-24)

An honest description of the code as it stands, including the problems Phase 15 addresses.

### Module map

```
src/
├── main.ts          # ~350 lines: the bootstrap. Makes the pieces, hands each the others it needs,
│                    #   renders the layout, starts the frame loop
├── perform/         # performer (the sounding voice, Prism harmonies, extra fingers, capture each frame,
│                    #   edge scrolling, the perform tick), gravity (cursor → pitch under Snap and Gravity,
│                    #   haptic steps), capture (layers, pass log, Keep, Drop last pass), voices (Prism voice ids),
│                    #   midi (live MIDI input: a voice per held key, recording, bend, device choice)
├── app/             # redraw (what the next frame must draw: markBgDirty, requestRedraw), transport-controller
│                    #   (transport(event) → the state machine, its effects; the engine follows the store),
│                    #   frame-loop (tick, redraw when needed, the HUDs over the canvas), modes (tools, Perform,
│                    #   scroll during playback), audition (hold A, ruler scrub), metronome (ticks and flash)
├── commands/        # catalog (every command: label, keys, description), keys (chord matching),
│                    #   registry (dispatch + keyboard), edit-commands, app-commands (what every other command does)
├── help/            # shortcut-table (help.html's table, generated from the catalog)
├── types.ts         # Shared interfaces (Composition, Lane, AppState, …)
├── constants.ts     # Pitch range, zoom limits, cents/frequency conversion, timing constants
├── state/           # store.ts (signals-backed singleton), reactive.ts (watch/effect), history.ts (snapshot undo),
│                    #   clipboard.ts, perform-mode.ts (perform-vs-edit predicate), snap-config.ts (the one snap builder)
├── model/           # curve, lane, track, tone, composition, curve-groups, layer, pass-log, point-selection
├── audio/           # engine, tone-synth, playback (voice-pool scheduler), curve-sampler, preview (live voices),
│                    #   live-voice (+ live-voice-dsp, live-voice.worklet: audio-rate pitch/gain smoothing),
│                    #   metronome, midi-input, dynamics-bus, voice-allocation, schedule-math (the scheduler's
│                    #   pure timing: beat ↔ audio time, a curve's events in one look-ahead window)
├── canvas/          # viewport, interaction (tool mouse handling, ~1,400 lines), performance-engine
│                    #   (countdown / loop-wrap / AFK / rolling phrase buffer), scene (draws every layer from
│                    #   the state, read-only), one renderer per layer, input-router + canvas-input (who owns
│                    #   a press; the right-click menu), pan-zoom, stage (canvas sizing, the opening view)
├── tuning/          # tuning.ts: tunings, scales, degree names, and the pitch set the staff and snap use (13.8);
│                    #   scl.ts: Scala .scl import and export
├── ui/              # Preact (.tsx): layout (the whole page: rail and drawers, canvas area, side panel),
│                    #   panel-section, top-bar, menu, tool-strip, settings-dialog, tempo-panel, snap-panel,
│                    #   prism-panel, tuning-panel, pitch-circle, track-list, property-panel, tool-property-panel.
│                    #   What panels do: drawer-actions, tuning-actions, track-actions. Vanilla DOM: tone
│                    #   builder/picker, context menu, older dialogs, HUDs (pitch-hud, perf-hud, session-overlays),
│                    #   zoom-sliders, param-graph-resize
├── theme/           # theme.ts: the canvas's reader for the colour tokens in styles/theme.css
├── export/          # json-export (.gliss envelope + migrations), wav-export, midi-import
└── utils/           # bezier-math, snap, snap-magnetic, snap-presets, harmonics, svg-normalize

styles/              # theme.css (every colour, as tokens), main / panels / dialogs (layout, via var())
```

### Mechanisms that work well

- **Voice-pool playback.** Each track keeps a pool of persistent synth voices sized to its maximum simultaneous curve overlap (`reconcileTrackPools` + `computeVoiceAssignment` in [src/audio/playback.ts](src/audio/playback.ts)). Loop restarts reuse the pool — no allocation spike at the wrap.
- **Lookahead scheduler.** A 25 ms `setInterval` schedules `AudioParam` changes 100 ms ahead; curves are sampled at 200 samples/s.
- **Monotonic-X constraint.** Anchor X strictly increases and handles are clamped so curves stay functions of time.
- **WAV export** renders through `OfflineAudioContext` using the same synthesis and scheduling code as live playback.
- **Snapshot undo** — deep clones of the composition, max 50; a drag is one step. Each kept loop pass is exactly one undo entry; "drop last pass" (U) is itself an undoable forward delete.
- **Rolling phrase buffer** — 30 s of performed gesture in musical time, so "keep that" (K) commits a phrase after the fact.
- **Versioned file format** with a migration chain and golden-file tests.

### Known structural problems (the review's findings)

1. *(Resolved in 15.3: the command catalog and registry in `src/commands/`; drawing in `canvas/scene.ts` (PR A); perform and capture in `perform/` (PR B); the transport controller, commands, MIDI, Tuning and track actions (PR C); the layout as Preact components in `ui/layout.tsx`, and the frame loop, modes and audition in `app/` (PR D). `main.ts` is a bootstrap of about 350 lines.)* **`main.ts` does everything** — layout HTML, wiring, keyboard map, perform logic, render loop, and inline model edits (e.g. multi-point delete in the key handler).
2. *(Resolved in 15.2: the explicit state machine in `src/state/transport.ts` and one input router per canvas in `src/canvas/input-router.ts`.)* **The perform state machine is implicit.** Play / jam / record / pass-record / MIDI-arm state is spread across ~8 flags in the store, the playback engine and module-level variables, each transition function setting its own combination. Two canvas mouse handlers use two different definitions of "is the left button performing?" (`isComposePerformActive` in `main.ts` vs. `isComposePerformLocked` in `interaction.ts`) — with Lock Rail off, a Draw click during Jam both sounds a note and places a curve point.
3. **Coarse store notification + hand-synced UI.** Every store change rebuilds the track list and both property panels via `innerHTML`, including on every mousemove of a drag. Widgets that don't subscribe drift out of sync. *(Resolved in 15.1: signals-backed store, targeted watches, render-if-changed panels.)*
4. **Duplicated state.** Snap settings exist in both `AppState` and `composition.snap`; loop-enabled lives in the playback engine; the snap config is built in three places that disagree (the Space-hold preview ignores guides and projection). *(Snap mirrors and loop state resolved in 15.1; one snap-config builder in 15.6, `src/state/snap-config.ts`.)*
5. *(Resolved in 15.5: the frame loop splits into `tickFrame()` and a read-only `draw()` that runs only when something changed.)* **The render loop mutates the model** — it attaches volume lanes, moves volume points and clears the Prism projection source.
6. **Live pitch is stepped.** `setFrequency` uses `setValueAtTime` at event/frame rate, so live glides and magnetic vibrato are a ~60 Hz staircase — at odds with the product's core value.
7. **The kernel is untested.** Snap, magnetic physics, bezier math, the curve sampler and the scheduler have no tests.

---

## Target architecture

The shape Phase 15 moves the code toward. The dependency direction is strictly downward:

```
ui/ (reactive components: panels, dialogs, menus)      canvas/ (imperative renderers + one input router)
                  \                                      /
                   state/ (signals store, transport state machine, commands, history)
                                     |
                  audio/ (scheduler, AudioWorklet live voice)      export/ (codec, WAV, MIDI)
                                     \                            /
                          core/ (pure: cents math, curve eval, snap + magnetic physics, gravity map)
```

Rules:

1. **`core/` is pure.** No DOM, store, audio or canvas imports. It is fully unit-tested and is the future cross-runtime conformance suite.
2. **One state store with fine-grained subscriptions** (signals). Document state (the composition) is separate from workspace preferences and from runtime state. No mirrored fields — derived values are computed, not copied.
3. **One explicit transport/perform state machine** with a single mode value and named transitions, unit-tested. Every "is the canvas performing or editing?" question asks it.
4. **One input router per canvas.** The canvas has a single pointer handler that routes to perform, tool, ruler or guide handling based on the state machine — no competing capture/bubble listeners.
5. **Commands, not scattered handlers.** Every user action (keyboard, button, menu, context menu) is a named command in one registry; the shortcut table in help.html and the context menu read from it.
6. **Mutations live in `model/` and `state/`.** UI and input handlers call commands; they don't splice arrays.
7. **Render is read-only.** The render loop never changes the model. Foreground redraw is dirty-flagged and curves are cached as `Path2D`.
8. **One snap-config builder** used by drawing, dragging, preview, perform and guides.
9. **Audio-rate live voice.** The live voice is an AudioWorklet receiving pitch/gain targets and smoothing them at audio rate.
10. **`main.ts` is a bootstrap** that creates the store, audio, canvas and UI and wires them together — a few hundred lines at most.

---

## Interface principles

The UI grew one drawer and toggle per feature and now overlaps heavily: tool × Prism draw × Prism projection × Lock Rail × play/jam/record/pass-record/MIDI-arm × layer × loop × snap × magnetic × Space tap-vs-hold. Worst, the left mouse button silently switches from editing to performing whenever playback runs with Lock Rail on. Phase 16 is a design pass (spec here before code) guided by:

1. **Group controls by task and by when you reach for them, not by when they were built.** Snap feel and tuning both shape the gravity map, but you reach for them at different times and for different reasons, so they stay separate drawers (decided in 16.1). Tempo is set once per project, so it goes in a drawer, not the top bar.
2. **One capture model.** Retrospective Keep makes a separate Jam mode largely redundant: if the rolling buffer always runs while the transport rolls, Jam is just Play, Keep is always available, and Record means "keep everything." Record-next-pass, Layer and MIDI-arm become options of one capture control rather than peers.
3. **No hidden modes.** If the left button performs instead of edits, the UI says so visibly (an explicit Perform state), rather than it being implied by Lock Rail + transport state. Perform is an instrument with a studio attached, so it should *look* different from composing.
4. **Frequent things visible, rare things tucked away.** Tools, Snap and Loop are always visible. Settings with several controls that work together live in drawers (Tempo, Snap, Tuning, Prism). Device preferences go in a Settings dialog, and HUD toggles and the manual in a **View** menu.
5. **Each control exists once.** Loop currently appears in both the top bar and the Transport drawer. This applies to *settings and state*: a command such as Undo can have both a button and a menu item, because both run the same command and neither holds state.
6. **Name things unambiguously.** "Tuning" names both the drawer (key/A4) and a Harmonic Prism field (JI vs. ET chord ratios). Track-row buttons are single letters (M S I T X).
7. **Avoid timing-dependent keys** where possible (Space is tap = transport, hold > 250 ms = preview). *(Resolved in the spec below: Space is transport only.)*
8. **Block it out before styling it.** Get every control working in its final place first; the visual theme comes after, on named theme tokens.

### Interface spec (Phase 16, decided 2026-09-24)

The outcome of the BACKLOG 16.1 structure session. It blocks out the whole interface as working controls. Three areas get their own design sessions afterwards, and this spec leaves room for them:

- **Perform** (16.8): making Perform feel like picking up an instrument, not sitting down in a cockpit. This matters more once the haptic slide hardware exists.
- **Tuning** (13.8): making the Tuning drawer more visually intuitive, together with the tuning-model rework.
- **Visual theme** (16.9): custom graphics come only after everything works.

BACKLOG 16.2–16.7 implement this spec. Anything not settled here is left to those items, as long as it follows the principles above.

#### Two modes: compose and perform

Glissandograph is two things: a simple DAW for composing, and a musical instrument with a recording studio attached. **Perform is an explicit mode, and it looks different.** It replaces the hidden rule that a rolling transport with Lock Rail on turns the left button into an instrument.

- **Entry.** Until the Perform session decides how you enter Perform, it is a **Perform** button in the top bar (where Lock Rail was) plus the **P** key. That is easy to reach and cheap to reshape later. Picking a tool, or Escape, also leaves Perform.
- **The left button's meaning is always visible.** In compose mode, the highlighted tool says what the left button does. In Perform, it always plays.
- **Perform uses the rail view.** Entering Perform snaps the rail to the centre, on the playhead, which also shows at a glance that the mode has changed. The planchette appears on the rail and follows the mouse's Y. Compose mode never shows a planchette.
- **In Perform with the transport stopped**, the left button auditions: it sounds the planchette's pitch with Snap and Gravity live, captures nothing, and doesn't start the clock.
- **In Perform while rolling**, it plays as it does today: the left button sounds the note, and the rolling buffer captures it for Keep, or commits it when Record is on.
- **Record enters Perform.** MIDI capture doesn't depend on the mode.
- **Lock Rail is retired as a mode.** Whether the canvas scrolls during playback in compose mode becomes a view option, *View › Scroll canvas during playback*. Off (the default) is the page view with a moving playhead. On, the edit tools work on the scrolling canvas.
- **Scrubbing in the rail view scrolls the content live.** Dragging the ruler slides the canvas under the fixed rail, so the playhead always *is* the rail beat, and Play starts where you scrubbed. The page view keeps today's scrubbing.
- Ctrl-hold temporary Select stays a Draw-only gesture.

#### One capture model

- **Jam folds into Play.**
  - In Perform, Play runs open-ended: today's jam clock, including the 10-minute idle stop.
  - In compose mode, Play stops at the end of the content unless Loop is on.
  - Entering Perform mid-playback makes the clock open-ended; leaving Perform doesn't end it.
  - The J key and the Jam button are removed.
- **Space is Play/Pause only**, with no hold behavior. Pausing in Perform is a real pause that Space resumes.
- **Keep (K)** is always available while performing, and lights up when there's something keepable (unchanged).
- **Record is one split button.** Clicking it, or pressing R, starts an open-ended recording. Its menu holds:
  - *Record one loop pass* (Shift+R);
  - *Drop last pass* (U);
  - *New track per pass*, today's Layer switch;
  - *Count-in*, on by default: today's 3-second count-in from stopped.
- **MIDI arm stays per track**, as a keyboard icon on the track row. It's amber when armed and red while capturing. Mouse and MIDI can record into different tracks at once, as today.

#### Keys that change

| Key | Before | After |
|-----|--------|-------|
| **P** | — | Enter / leave Perform (interim, pending the Perform session) |
| **J** | Jam | *(unbound)* |
| **Space** | tap: Play/Pause; hold: preview | Play/Pause only |
| **A** (hold) | — | Audition. In Draw, sounds the cursor's pitch (today's Space-hold draw preview, including its "Composition + tone" option). While dragging a Y guide, sounds the guide's pitch (13.6). |

Scrubbing the ruler is audible by default, replacing the Space-hold scrub preview. *Settings › Audible scrub* turns it off.

#### Layout

- **Top bar**, left to right:
  - the composition's name and length;
  - **File**, **Edit** and **View** menus;
  - small Undo and Redo icon buttons;
  - transport: Stop, Play/Pause, Record (split button), Keep;
  - **Snap** and **Loop** toggles, side by side. These are the most-used switches;
  - Settings (a gear).
  - Tempo and metronome are not in the top bar: they're set once per project, if at all.
- **Edit menu** *(new)*, generated from the command catalog: Undo, Redo, Cut, Copy, Paste, Duplicate, Continue curves, Delete, Join, Group, Ungroup, Smooth, Sharpen.
- **View menu:** Pitch HUD, Perf HUD (!), Scroll canvas during playback, Go to start / end / playhead, User Manual (?).
- **Settings dialog:** MIDI input device, audible scrub. Later: pen and gamepad mapping (11.3 / 11.4).
- **Left rail:**
  - The drawer icons at the top.
  - A divider, then the tools (Draw, Select, Delete, Slice) and the Perform entry, always visible as a strip. *(16.4: the drawers sit above the tools.)*
  - **Drawers stay the pattern for settings with several controls that work together.** The Tools drawer is gone, and the Transport drawer is split up.
- **Drawers:**
  - **Tempo** *(new, from the Transport drawer)*: BPM, time signature, and the metronome's on/off switch and volume.
  - **Snap**:
    - Gravity on/off, replacing the Magnetic switch. With Gravity off, Snap snaps instantly, as Magnetic off does today.
    - Gravity's Force, Spring and Damping, and Speed (13.36: a multiplier on the beat time the physics runs in).
    - Presets: select, save, delete. Presets hold feel only (13.2).
    - Guides: show, lock, add X, add Y.
    - Snap on/off is not repeated in the drawer; it is the top-bar switch.
    - Later: an animated waveform showing what Force, Spring and Damping do (13.15).
  - **Tuning**: a pitch circle over Tuning / Root / Scale, Tune A4 and a pitch-lines switch. See [Tuning spec](#tuning-spec-138-decided-2026-09-26).
  - **Harmonic Prism**: unchanged except for names. The chord "Tuning" field becomes **Intonation** (Just / Equal). While Prism Draw is on, the Draw tool and the Perform entry carry a chord badge, so the mode is visible without opening the drawer.
- **Right panel:**
  - **Tool** (was Tool Properties): the active tool's settings. For example, Draw's preview mode, auto-smoothing and handle length. In Perform it shows the performed-volume control (today's Transport-drawer "Dynamics": Fixed, or Key swell with F held), which gets a clearer name in the Perform session.
  - **Selection** (was Object Properties).
  - **Tracks.**
- **Track rows:**
  - colour, name, and tone (click for the tone picker);
  - Mute, Solo and MIDI arm as icon toggles;
  - a ⋯ menu with Edit tone and Delete track.
  - The single letters M S I T X are gone.
- **Groups (13.12, UI half):**
  - Selection shows "Group of *n* curves" with an Ungroup button.
  - The transform box gets an Ungroup button.
  - Group members share an outline on the canvas when any member is hovered or selected.

#### Themeable from the start

Every colour, in both the CSS and the canvas renderers, comes from one set of named theme tokens (16.7), so the theme session (16.9) can restyle the app without touching layout or logic.

- **Where:** [styles/theme.css](styles/theme.css) defines every colour as a CSS custom property on `:root`. `*-rgb` tokens hold bare channels for colours used at several alphas: `rgba(var(--accent-rgb), 0.12)`.
- **Chrome:** the other stylesheets, help.html and inline component styles use `var(--token)`.
- **Canvas:** renderers call `themeColor('staff-line-c')` ([src/theme/theme.ts](src/theme/theme.ts)). `loadTheme()` resolves each token from the page's stylesheets through a probe element, so the canvas and the chrome can't drift. A theme switch calls it again and redraws.
- **Enforced:** `theme.test.ts` fails on a colour literal anywhere else. The exceptions are data: the preset tones' colours and a new tone's default. It also fails on a token that's used but not defined, or that the canvas expects but the CSS lacks. The chrome's ornaments, such as hand-drawn vector scrollwork, will be SVG assets that go through the icon pipeline (PR #59).

### Layout before Phase 16 (for reference)

- **Top bar:** composition name, length, File menu, Undo/Redo, Lock Rail toggle, transport (Play, Pause, Stop, Record, Jam, Keep), Snap and Loop toggles.
- **Left icon rail → drawers:** Transport (Loop, Layer, Pitch HUD, Perf HUD, BPM, time signature, metronome, dynamics source, MIDI device), Tools (Draw, Select, Delete, Slice), Snap (preset, magnetic Force/Spring/Damping, guides), Harmonic Prism, Tuning (Key/scale, Tune A4).
- **Centre:** staff canvas with top and bottom rulers and zoom sliders; the Parameters Graph (volume lane of the selected curve) below it, resizable.
- **Right panel:** Tool Properties, Object Properties, Tracks (+ Track, + Tone).

### Tuning spec (13.8, decided 2026-09-26)

The Key and Scale dropdowns mixed two different axes: the **tuning** (which pitches exist) and the **scale** (which of them the piece uses). `24tet` and `thai-7tet` are tunings sitting in a scale list, and the maqams fuse both. The Key could only be one of 12 notes, so a 19-tone tuning couldn't have a root on most of its own degrees. Research: [.claude/plans/13.8-tuning-taxonomy-research.md](.claude/plans/13.8-tuning-taxonomy-research.md).

#### Three controls, plus reference and pitch lines

- **Tuning** — which pitches exist.
  - **12-EDO** (the default).
  - **Equal divisions:** type N (5–72); optionally divide the 3:1 twelfth instead of the octave (Bohlen–Pierce).
  - **Just intonation:** a short curated list.
  - **Historical:** ¼-comma meantone, Pythagorean, Werckmeister III, Kirnberger III, Vallotti.
  - **Traditional:** Slendro and Pelog, labelled as approximations.
  - **Imported (.scl)** and **Custom** (from frets, below).
  - Overlapping entry points are fine: 19-EDO is under Equal divisions, while ¼-comma meantone (a different tuning) is under Historical.
- **Root** — which degree of the tuning is home, picked from the tuning's own degrees. The names depend on the tuning:
  - letter names for 12-EDO and the meantone EDOs (19, 31), where letters still work;
  - degree numbers for other equal divisions;
  - ratios (5/4) for just intonation.
- **Scale** — which degrees the piece uses, filtered to the tuning.
  - 12-EDO: today's list without the four stray tunings.
  - 24-EDO: Maqam Rast and Bayati, as real scales.
  - Every tuning offers **All notes**, replacing the Key menu's old "Chromatic".
  - **Custom:** built on the pitch circle (Shift+click).
- **One root.** The exception is historical temperaments: they're deliberately unequal, so the note their table is anchored on matters separately from the key. **Tuned from: C** says where a tuning's first degree sits. *(Built in 13.8 (a): it shows for every tuning except 12-EDO, because it also places non-12 equal divisions and the traditional tunings, which migration relies on.)* Changing the tuning or Tuned from keeps the root on the nearest pitch.
- **Tune A4** stays as it is: the reference frequency, applied only in the cents → Hz conversion. The grid never moves.
- **Pitch lines: show / hide** replaces the Key menu's "None". It's a display mode, not a tuning. Hidden, the staff draws no lines and snapping has no fallback grid (8.19's behaviour).

#### The staff follows the tuning

- The staff's lines are the tuning's degrees, labelled by the naming rule above. Non-12 tunings are no longer drawn as 12-EDO with microtonal lines dashed on top, so the app is tuning-agnostic rather than a 12-EDO tool with microtonal decoration.
- For non-12 tunings, an optional faint **12-EDO reference layer** helps with orientation.
- Snapping without a scale rounds to the tuning's degrees, not to 100-cent steps.
- The octave highlight marks the root, not C (absorbs 13.9).
- *(Built in 13.8 (b).)* The reference layer is a drawer switch, off by default (on in (b); too busy as a default, so off since (f)). Labels thin out by zoom as 12-EDO's did, and zoomed out, lines outside the scale fade. The draw HUD names the nearest note of the tuning.
- 12-EDO stays the default, so the default view doesn't change.

#### The drawer: a pitch circle over the controls

- **The pitch circle** shows one period of the tuning (an octave, or the tuning's repeat when it isn't octave-based):
  - the tuning's degrees as ticks around the rim;
  - the scale's degrees as filled dots;
  - the root marked with a ring;
  - for non-12 tunings, a faint inner ring of the 12 standard notes, so you can see how far each degree sits from them.
- **Gestures:** click a degree to hear it; double-click to make it the root; Shift+click to add it to or remove it from the scale (making a Custom scale).
- *(Built in 13.8 (c).)*
  - Hearing a degree lasts as long as it's pressed.
  - Double-click moves the scale with the root, as the Root menu does.
  - A Custom scale is stored as steps from the root, with the tuning size it fits (`SnapSettings.customScale`), and is kept while other scales are chosen.
  - Past 24 degrees the rim names only the root and the natural letters.
- **Below the circle:**
  - Tuning, Root and Scale;
  - Tune A4 with its cents readout;
  - the Pitch lines switch;
  - the Frets switch (13.22): hides every fret and stops it pulling, leaving beat guides; also View › Frets;
  - Import .scl… and Export .scl….

#### Frets and the scale

The scale is the pitch grid; frets (13.16) are exceptions and additions on top of it. Both are lists of pitch targets for snapping: the scale's are generated (root plus steps, repeated every period, not individually selectable), while each fret is stored, selectable and labelled, and wins over the scale lines within its reach. Custom scales therefore stay scales (they keep a root, repeat every period, name their degrees and give the Prism its steps), but the two convert both ways:

- **Scale → frets:** each scale degree becomes an octave fret (13.18), ready to nudge by ear on the canvas (hold A while dragging) and label.
- **Frets → scale:** the octave frets' pitch classes become the scale.
  - If every one lands on a degree of the current tuning, the result is a **Custom scale**.
  - If not, it's a **Custom tuning** with All notes. Frets are exact pitches, so the tuning / scale split stays honest.
  - Single (non-repeating) frets are one-off pitches and stay behind as frets.
- Round trip: explode a scale, tune it by ear, promote it back.
- *(Built in 13.8 (f).)*
  - Scale → frets turns pitch lines off, so the frets are the grid while you tune; Frets → scale uses the octave frets up and turns pitch lines back on.
  - A scale of frets that matches one of the tuning's named scales comes back by name.
  - A Custom tuning ("From frets") starts on the root fret's exact pitch, so Tuned from can sit between the standard notes (D +17¢).

#### .scl files

- **Import** reads a Scala file into an Imported tuning. `.scl` carries no root, reference frequency or note names, so those come from the app (Root, Tune A4, degree numbers). Its description line is untrusted display text.
- **Export** writes the notes you hear, from the root: the scale if one is chosen, otherwise the whole tuning. `.kbm` (MIDI key mapping) is out of scope.
- Very large or non-octave files work, because a scale's steps and period are already free floats. The staff and snap targets for big files need a performance check.
- *(Built in 13.8 (d).)*
  - The composition stores the whole imported tuning, and keeps the last import on offer in the Tuning menu.
  - Imported tunings are checked on every load: up to 1,200 notes, a period of 100–7,200 ¢.
  - Export writes ratios where the tuning has them for both notes, cents otherwise.
  - Measured: 192 notes draw in about 1.5 ms, and the 1,200-note limit in about 7 ms.

#### Consequences elsewhere

- **Harmonic Prism:** Intonation's "Equal" means the current tuning's equal steps (12-EDO steps only when the tuning is 12-EDO). *(Built in 13.8 (b): each voice takes the tuning's step nearest its 12-TET interval, counted from the root. For unequal tables that's the table's own intervals from the root, since a chord's offsets must stay constant along a curve.)*
  - **Per note** (13.21, first slice) is a second Equal: the chord counts up from the tuning's note nearest the base (`noteRootAt`) instead of from the root, and moves with the base's offset from that note. A 12-note octave table counts its notes by the semitones (a third is always four notes up); other tunings take the nearest steps as Equal does. Draw clicks take each click's note; a performed note holds the note it started on (`heldNoteRoot` in perform/performer.ts) until it ends; projection echoes stay from the root.
- **Octave frets (13.18):** "Octaves" repeats every period of the tuning, which is the octave except in non-octave tunings.
- **Files:** `scaleRoot` (0–11) becomes a degree index into the tuning. The composition version goes up, with a migration:

  | Old | New |
  |---|---|
  | Key 0–11 + scale | 12-EDO, that degree as root, same scale |
  | Key "Chromatic" | 12-EDO, All notes |
  | Key "None" | 12-EDO, pitch lines hidden |
  | `24tet` | 24-EDO, All notes |
  | `thai-7tet` | 7-EDO, All notes |
  | `maqam-rast`, `maqam-bayati` | 24-EDO, Maqam Rast / Bayati |
  | `slendro`, `pelog` | the Traditional tuning, All notes |
  | scale `chromatic` | All notes |

  The golden-format test gets a compatibility shim.

### Area Nudge spec (13.26, decided 2026-09-27)

A brush for reshaping part of a busy curve, typically a recorded gravity glide whose spring wobble became many close points, without the kinks that dragging single points leaves.

- **A tool, "Nudge"** (key N), in the tool strip after Select. Its settings are in the Tool panel.
- **The brush reaches along time, on one curve.** A press picks the curve nearest the cursor (any shown track, the active track following it, as a Select click does). Points of that curve within **Size** screen pixels left and right of the cursor are in reach, however far they are in pitch; other curves, such as stacked chord voices, are never touched. Size is in pixels, like any brush, so zooming in gives finer control. **[** and **]** change it.
- **Falloff:** a raised-cosine bell, weight 1 at the cursor to 0 at the edge. One shape for now.
- **Moves: Pitch / Time / Both** (Tool panel). With Both, Shift locks a drag to its main axis.
- **Defaults** (set after testing): Push, Both, Size 100 px, Strength 0.50.
- **Never snaps.** It's for fine adjustment; guides can be matched by eye.
- **Push mode:** the drag moves each point in reach by its weight × the drag. The handles bend with the same field: each handle tip moves by its own weight, so the curve deforms smoothly instead of sliding in stiff pieces. In time, points never pass each other or change order: on the side the drag is heading, each point stops just short of the next one (which moves less), so too much time with too small a brush piles points up at the brush's leading edge, the user's call. Points outside the reach never move. Handles stay inside their segments.
- **Smooth mode:** rubbing (dragging back and forth) relaxes the points in reach toward their neighbours, each move by its weight × a **Strength**. In pitch it irons out wobble; in time it evens out the spacing (a point moves toward the midpoint of its neighbours, so order holds by itself). Handles of the points it moves are re-smoothed (auto-smooth, the shared handle length), since their old shapes belonged to the wobble.
- **Showing the brush:** a faint band marks the reach while hovering the curve, and the points in reach light up, stronger toward the centre. Both move with the brush during a stroke (Push lights the points it's moving). A thin, faint ring round the cursor shows the size. Nudge's cursor is never snapped.
- **Other lanes stay put:** volume and other lanes are time-locked, as with the transform box.
- **One undo step per drag.**
- **Related:** 13.11 (recording density and a better simplifier) gives recordings fewer, better-placed points to start with; 12.4 (raw takes).

### Recording fit spec (13.11, decided 2026-09-28)

How a recorded take (and a MIDI import's pitch bend) becomes an editable curve, and how an existing curve can be thinned.

- **Why:** the old pipeline kept a subset of the samples (RDP, 15 ¢ / 0.03 beats) and gave every kept point **flat handles**, so the curve eased to a stop at each point. Measured on synthetic takes: a straight octave glide came out 133 ¢ off at worst, a wobbly rising glide 78 ¢; only vibrato (whose kept points are its peaks) fitted well. Denser RDP made it worse (an earlier, uncommitted attempt): more flat-handled points, more plateaus.
- **The fitter** (`model/fit.ts`) treats pitch as a function of time:
  - Each segment's handles sit at **⅓ of its width**, so time runs evenly along the segment and pitch is a plain cubic in time. What's fitted is each point's pitch and slope, by least squares against the samples; in and out handles share the slope, so every point is smooth. Nothing can run backward in time, and there's no iteration to go unstable.
  - **First, the shape** (added in testing: the old fit's flat handles had a purpose). Points with **level handles** go where editing wants them, and they stay:
    - **Holds:** a stretch at least ¼ beat long whose pitch stays inside a band (the Accuracy, but never wider than 10 ¢, or a loose Accuracy would call stretches of a vibrato holds) and doesn't drift (its trend under half the band, so a slow glide isn't made into steps) gets a point at each end, both at its average: exactly flat, so a scale can't amplify a bend in a held note, and a glide lands on it smoothly.
    - **Peaks and troughs:** each turn that comes back by more than twice the Accuracy (smaller ones fit inside the band anyway) gets a point on its extreme. A vibrato's tops can be selected and dragged together, and level handles follow a sine within about 1 % of its swing.
  - **Then the cleanup:** sloped points are added where the error is worst: fit, add a point at the worst sample of every segment still out of tolerance, refit, until every sample is within **Accuracy**.
  - **Sloped points are spaced out** (added in testing: they clustered beside the level points): a new one goes at least a third of the way into the gap it splits, and never nearer its neighbours than 1/16 beat, so handles are longer and easier to grab, and moving one leaves its neighbours' shape alone. Where a gap is too short to split, a little fit is given up. (1/8 beat was tried: a springy leap then missed by ~50 ¢.)
  - **Error is measured in cents** (what's heard), with a little timing slack (0.01 beats, found in building: 0.03 excused several cents on ordinary glides) on steep parts, so a fast leap doesn't collect a pile of points.
  - **Then sloped points are taken out** where the few segments round them can be refitted without one (adding at the worst sample alone isn't economical). The shape's points stay.
  - **The ends keep the first and last samples' values:** a take starts and ends where it was played.
  - **No overshoot:** where a stretch of the take only rises or only falls (a leap into a held note), its segment's slopes are limited so the curve can't scoop past the samples.
  - **Volume** uses the same fitter with its own tolerance (0.04, fixed); a steady volume stays two points.
- **Accuracy** (Perform's settings in the Tool panel, and Select's for Simplify; one workspace pref): the most any sample may be off, from 2 ¢ (tight: keeps everything audible, including small vibrato) to 40 ¢ (loose: few points), in steps 2, 3, 4, 6, 8, 10, 15, 20, 30, 40. Default 8 ¢, to be confirmed in testing. A MIDI import uses the default.
- **Simplify** (Edit menu, canvas right-click menu, Selection panel, Alt+Shift+S): refits the selected curves at the current Accuracy, from their own shape (sampled densely), since the raw take isn't kept. A tight take stays within a couple of cents of what was played, so refitting it is nearly the same as refitting the raw take. The curve's ends stay put. With points selected, only the span from the first to the last selected point is refitted, its ends and their slopes kept, so a busy area can be thinned without touching the rest. Volume and other lanes are refitted too. One undo step.
- **Editing dense takes:** Nudge (13.26) for areas, Simplify to thin.
- **Raw takes (12.4):** a tight fit may make keeping the raw samples unnecessary; 12.4 stays open until that's tried.
- **Old fit (for now):** a switch in Perform's settings back to the old fitter, for comparison. Kept after the PR in case something else turns up (decided 2026-09-28); the new fit is meant to be permanent. Whether to remove it is decided before 16.8 (which redesigns Perform's settings) or 17.1 (which would carry the old code into the core), whichever comes first.

### Guide tracks spec (13.10, decided 2026-09-27)

A curve can be a **pitch guide**: silent, drawn as scaffolding, and pulling like a fret whose pitch moves over time. It isn't a fret (a fret is one pitch), so it can't join a scale or the staff.

- **A track role, not a new object.** A track has a **Guide** switch (an icon on its row). A guide track's curves:
  - make no sound: playback, WAV export, the scrub and Composition + tone previews skip them, and Solo ignores guide tracks (a guide track can't be soloed, and doesn't count when others are);
  - are drawn as guides: thin, dashed, dimmed, in the fret colour;
  - pull like frets: at each beat, a guide curve that spans that beat is a pitch target at the curve's pitch there, alongside the scale (additive, like frets; Projection's echoes still replace everything while on, until 13.25 decides Projection's future).
  - **take priority close up** (added in testing): within 100 ¢ of a pitch guide it's the only pitch target, for drawing and Gravity alike, so gliding along a guide isn't pulled onto a staff line where they cross (the nearest-target rule otherwise let a line a few cents nearer win). Beyond that it's one more target among the scale's. A per-guide reach belongs to 13.19.
  - are ordinary curves otherwise: select, edit, transform, copy, record onto. Turning Guide off gives a sounding track back.
- **No self-pull:** a curve being drawn or dragged doesn't pull on itself.
- **The Snap drawer's Guides switch** covers pitch guides with frets and beat guides: off, none pull or show as guides.
- **Send to guide track** (Selection panel and Edit menu) moves the selected curves to a guide track, creating one ("Guides") if there's none. With 13.24's Alt+click copy, that's Projection made explicit: copy a curve up a fifth, send the copy to the guide track, glide against it.
- **Mute, Hide and Guide are separate** (changes what Mute did):
  - **Mute:** silent only. Its curves still show, dimmed, and can be picked and edited. (Before 13.10, muted tracks were also hidden and unpickable.)
  - **Hide** (an eye icon): not drawn and not pickable. A hidden guide track doesn't pull either — hidden means no lines and no pull, as with Pitch lines and Frets.
  - **Guide:** silent, drawn as a guide, pulls. Mute has no meaning on a guide track; turning Guide off leaves the track unmuted.
- **File:** `Track.guide?: true` and `Track.hidden?: true`, optional, so no version bump. A guide track is also written `muted: true`, so an older app shows it as a muted track (silent and hidden there) instead of playing it; this app reads `guide` first and loads the track unmuted.
- **Later:** octave repeats of a pitch guide (like octave frets), per-guide gravity (13.19), guides that follow a sounding curve live (what Projection does and this doesn't).

---

## Data model

- **ToneDefinition** — one or more oscillator layers (sine/square/sawtooth/triangle, gain, detune), optional waveshaper distortion, plus a colour and dash pattern for drawing. Four presets ship.
- **Lane / LanePoint** — the universal automation primitive: `type` (`pitch` | `volume`, more reserved), `unit`, `range`, ordered `points`, optional `gravity` (round-trips verbatim). A point is a position `(beats, value)` plus relative in/out handles; consecutive points form cubic Bezier segments.
- **BezierCurve** — `lanes[]` with `lanes[0]` always pitch (constructor-enforced), optional `groupId` (chord clusters and freehand groups) and `voiceIndex` (Harmonic Prism voice).
- **Track** — tone reference, curves, mute, solo, volume, and optionally `hidden` and `guide` (13.10: a guide track's curves are silent pitch guides). Loop layers are tracks; Layer mode stops opening new layers once the composition has 16 tracks.
- **Composition** — name, BPM, time signature, tracks, tone library, loop range, snap settings, guides, `tuningOffsetCents`.
- **Pitch range** C0–C9 (1,200–12,000 ¢).

---

## File format — `.gliss`

JSON inside a versioned envelope, saved with the `.gliss` extension:

```
{
  "app": "glissandograph",        // type marker — a format contract, never renamed
  "formatVersion": 2,             // cross-app contract; loaders migrate older files
  "kind": "composition",          // advisory self-description
  "meta":        { ... },         // optional: title, author, license, timestamps (opt-in only; never auto-stamp identity)
  "tuning":      { ... },         // optional: reference pitch + scale as explicit cents/ratios
  "snap":        { ... },         // optional: snap targets, strengths, guides — the gravity map
  "composition": { ... }          // tracks, curves, loops, bpm, …
}
```

`formatVersion` 2 wraps internal composition v5. A migration chain upgrades older saves:
- v1 flat JSON → per-point volume → volume lane → unified `lanes[]` + cents canon;
- `formatVersion` 1 / composition v4 → v5: Key + Scale become Tuning / Root / Scale (13.8), playing the same notes.

Legacy `.json` files still open. The tuning settings sit in `snap.settings` beside the Gravity feel; the envelope's `tuning` section still holds only the reference pitch. `tuning` and `snap` sit at the top level so preset tools and galleries can read them without parsing the piece.

**Presets: one schema, two extensions, two verbs (planned, BACKLOG 12.2).** `.glisskit` shares the schema. The extension picks the default verb: `.gliss` → **Open** (replace the workspace), `.glisskit` → **Import settings** (read only `tuning`/`snap`). A File ▸ Import settings… action works on any conforming file. On extension/`kind` mismatch, the extension wins.

**Shareable files** embed presets self-contained (with an optional `id`/`name` label) rather than referencing them by name, and store tuning as explicit cents/ratios plus reference pitch.

### Cross-runtime portability

- **Guaranteed-portable core:** `meta`, `tuning`, `snap`, structure (tracks, loops, BPM in beats) and the canonical pitch + dynamics curves.
- **Host-specific blocks:** `hostSettings: { browser, vst, vcv }` — advisory, namespaced, ignored by other hosts, preserved on re-save.
- **Graceful degradation:** heavy layering can exceed MPE's ~15 or VCV's 16 channels, and timbre doesn't survive into a generator host. Each host should report what it couldn't represent.
- **One spec, ideally one codec** — not three independent parsers that drift.

### Raw takes (design framing for BACKLOG 12.4)

The Bezier is the editable, lossy "JPEG"; the high-rate capture stream is the "negative." Keeping raw takes preserves vibrato texture and human timing, and enables re-fitting and high-fidelity MPE export. Rough size: ~1 KB/s per voice as lean JSON at 60 Hz; delta encoding + gzip gives 5–10×. Endpoint: a zip-style container with lazily loaded blobs, deferred until sizes justify it. Raw takes must never enter the undo-clone path (BACKLOG 9.3 first).

---

## Ports & hardware (THINKING)

Architecture notes only — not ready to build. The corresponding roadmap entries are in the BACKLOG **Horizon** section.

### VST plugin

An **MPE / note-expression generator** driving downstream synths. MIDI is blocks-plus-bend by design, so continuous pitch maps to note + per-note bend; the cents canon makes that mechanical. Player/performer scope, like VCV.

### VCV Rack module

A CV source — pitch CV is the continuous field with no blocks.

- **Canvas:** a custom NanoVG widget on a fixed 3U panel.
- **Timeline:** an internal playhead in `process()`.
- **Outputs:** lanes map 1:1 to CV outputs. Pitch is 1 V/oct via `V = (cents − 6000) / 1200` (0 V = middle C).
- **Gate:** one per track, high while the track sounds.
- **Clock/reset I/O:** so short compositions can sit inside looping patches.
- **Polyphony:** poly cables (16 channels) give a natural 16-track ceiling.

**Scope: player/performer.** Include performance-adjacent edits (mute/solo, loop region, snap strength and tuning, curve nudge/scale, light dynamics); leave from-scratch authoring to the browser studio. The editing UI is bespoke per host; the engine is the shared core. Likely GPL, in line with the Rack ecosystem.

### Motorized-fader hardware

The North Star made physical: a motorized slide potentiometer renders the gravity wells as **force** (magnetic strength = motor force). You feel the snap instead of seeing it.

- **The haptic loop runs on the microcontroller,** not the browser: read position → restoring force toward the nearest target → drive the motor, at hundreds of Hz.
- **Protocol:** the host sends a map of snap targets + strengths (re-sent when scale or harmony changes); the device streams position = pitch back. The same protocol serves the plugin ports — **keep the preset schema and the device protocol as one representation.**
- **Prototype:** Adafruit Feather RP2040.
  - One core runs the force loop in fixed-point math; the other handles USB.
  - It enumerates as a class-compliant composite USB device (MIDI + CDC serial), so the browser talks to it over Web Serial.
  - The motor is powered from the 5 V USB rail through a current-limited H-bridge.
  - Upgrade path: RP2350, which adds an FPU.
- **Interactions it unlocks:**
  - felt detents and felt harmony;
  - motorized playback of a loop layer, with touch-override punch-in;
  - a felt metronome pulse;
  - soft end-stops.
- **Central risk:** detent fidelity. Slide-pot motors are built for position recall, not force rendering. Prototype the feel first.
- **Constraints:**
  - One fader is one voice, which reinforces loop-to-choir; a bank of faders could be a chord.
  - ADC resolution over 9 octaves may force a shiftable pitch window.
  - Commercial units may want contactless magnetic position sensing.
