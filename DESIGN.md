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
4. **Round-trip rule.** Re-saving a file must preserve unknown sections verbatim so files survive crossing runtimes (top-level envelope gap: BACKLOG 12.3).
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
├── main.ts          # ~3,900 lines: DOM layout template, UI wiring, command handlers,
│                    #   perform/record/jam state machine, render loop, store watches
├── commands/        # catalog (every command: label, keys, description), keys (chord matching),
│                    #   registry (dispatch + keyboard), edit-commands
├── help/            # shortcut-table (help.html's table, generated from the catalog)
├── types.ts         # Shared interfaces (Composition, Lane, AppState, …)
├── constants.ts     # Pitch range, zoom limits, cents/frequency conversion, timing constants
├── state/           # store.ts (signals-backed singleton), reactive.ts (watch/effect), history.ts (snapshot undo),
│                    #   clipboard.ts, perform-mode.ts (perform-vs-edit predicate), snap-config.ts (the one snap builder)
├── model/           # curve, lane, track, tone, composition, curve-groups, layer, pass-log, point-selection
├── audio/           # engine, tone-synth, playback (voice-pool scheduler), curve-sampler, preview (live voices),
│                    #   live-voice (+ live-voice-dsp, live-voice.worklet: audio-rate pitch/gain smoothing),
│                    #   metronome, midi-input, dynamics-bus, voice-allocation
├── canvas/          # viewport, interaction (tool mouse handling, ~1,400 lines), performance-engine
│                    #   (countdown / loop-wrap / AFK / rolling phrase buffer), and one renderer per layer
├── tuning/          # tuning.ts: tunings, scales, degree names, and the pitch set the staff and snap use (13.8)
├── ui/              # Preact (.tsx): top-bar, menu, tool-strip, settings-dialog, tempo-panel, snap-panel,
│                    #   prism-panel, tuning-panel, track-list, property-panel, tool-property-panel.
│                    #   Vanilla DOM: drawer, tone builder/picker, older dialogs, HUDs
├── theme/           # theme.ts: the canvas's reader for the colour tokens in styles/theme.css
├── export/          # json-export (.gliss envelope + migrations), wav-export, midi-import
└── utils/           # bezier-math, snap, snap-magnetic, snap-presets, harmonics, svg helpers

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

1. *(Keyboard map resolved in 15.3: the command catalog and registry in `src/commands/`. Layout, perform logic and the render loop are still in `main.ts`.)* **`main.ts` does everything** — layout HTML, wiring, keyboard map, perform logic, render loop, and inline model edits (e.g. multi-point delete in the key handler).
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
    - Gravity's Force, Spring and Damping.
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
- 12-EDO stays the default, so the default view doesn't change.

#### The drawer: a pitch circle over the controls

- **The pitch circle** shows one period of the tuning (an octave, or the tuning's repeat when it isn't octave-based):
  - the tuning's degrees as ticks around the rim;
  - the scale's degrees as filled dots;
  - the root marked with a ring;
  - for non-12 tunings, a faint inner ring of the 12 standard notes, so you can see how far each degree sits from them.
- **Gestures:** click a degree to hear it; double-click to make it the root; Shift+click to add it to or remove it from the scale (making a Custom scale).
- **Below the circle:**
  - Tuning, Root and Scale;
  - Tune A4 with its cents readout;
  - the Pitch lines switch;
  - Import .scl… and Export .scl….

#### Frets and the scale

The scale is the pitch grid; frets (13.16) are exceptions and additions on top of it. Both are lists of pitch targets for snapping: the scale's are generated (root plus steps, repeated every period, not individually selectable), while each fret is stored, selectable and labelled, and wins over the scale lines within its reach. Custom scales therefore stay scales (they keep a root, repeat every period, name their degrees and give the Prism its steps), but the two convert both ways:

- **Scale → frets:** each scale degree becomes an octave fret (13.18), ready to nudge by ear on the canvas (hold A while dragging) and label.
- **Frets → scale:** the octave frets' pitch classes become the scale.
  - If every one lands on a degree of the current tuning, the result is a **Custom scale**.
  - If not, it's a **Custom tuning** with All notes. Frets are exact pitches, so the tuning / scale split stays honest.
  - Single (non-repeating) frets are one-off pitches and stay behind as frets.
- Round trip: explode a scale, tune it by ear, promote it back.

#### .scl files

- **Import** reads a Scala file into an Imported tuning. `.scl` carries no root, reference frequency or note names, so those come from the app (Root, Tune A4, degree numbers). Its description line is untrusted display text.
- **Export** writes the notes you hear, from the root: the scale if one is chosen, otherwise the whole tuning. `.kbm` (MIDI key mapping) is out of scope.
- Very large or non-octave files work, because a scale's steps and period are already free floats. The staff and snap targets for big files need a performance check.

#### Consequences elsewhere

- **Harmonic Prism:** Intonation's "Equal" means the current tuning's equal steps (12-EDO steps only when the tuning is 12-EDO).
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

---

## Data model

- **ToneDefinition** — one or more oscillator layers (sine/square/sawtooth/triangle, gain, detune), optional waveshaper distortion, plus a colour and dash pattern for drawing. Four presets ship.
- **Lane / LanePoint** — the universal automation primitive: `type` (`pitch` | `volume`, more reserved), `unit`, `range`, ordered `points`, optional `gravity` (round-trips verbatim). A point is a position `(beats, value)` plus relative in/out handles; consecutive points form cubic Bezier segments.
- **BezierCurve** — `lanes[]` with `lanes[0]` always pitch (constructor-enforced), optional `groupId` (chord clusters and freehand groups) and `voiceIndex` (Harmonic Prism voice).
- **Track** — tone reference, curves, mute, solo, volume. Loop layers are tracks; Layer mode stops opening new layers once the composition has 16 tracks.
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
