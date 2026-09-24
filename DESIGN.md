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
| UI chrome | Vanilla DOM today | Moving to Preact components (MIT) in BACKLOG 15.4 — see [Target architecture](#target-architecture) |
| Tests | Vitest | |
| Input | Mouse, Web MIDI | Pointer Events (pen), Gamepad and Web Serial planned |

### Why TypeScript and the web stay

The 2026-09-24 review asked whether TypeScript was the right base. It is. The fracture is architectural and would exist in any language. The web is the right home for the studio: zero-install (the free app is the adoption funnel for the hardware), Web MIDI and Web Serial for the prototype hardware, fast iteration.

The two real platform limits have targeted answers that don't require leaving the web:

- **Control rate.** Live pitch is driven from the main thread at mouse/frame rate. The answer is an **AudioWorklet** voice that smooths pitch and gain at audio rate (and can later run the magnetic integrator there) — BACKLOG 15.7.
- **Code sharing with C++ ports.** VST and VCV Rack are C++. The answer is to keep the kernel (cents math, curve evaluation, snap + magnetic physics, `.gliss` codec) **pure and fully tested** now, so porting it is translation rather than excavation, and to decide C++ vs. Rust→WASM vs. an independently implemented spec only when the first port begins — BACKLOG Phase 17.

### Why the "no framework" decision is being revisited

The original rationale was that the UI is ~90% canvas with only a handful of DOM controls. That no longer holds: the chrome has ~36 buttons, ~29 inputs, ~11 selects, drawers and dialogs, all synced to state by hand. Hand-syncing is the source of real bugs (e.g. the tool panel showing Draw while the active tool is Select). The canvas stays imperative; the panels move to a small reactive component layer (recommended default: Preact + `@preact/signals`, confirmed at the start of BACKLOG 15.4).

---

## Current architecture (as of 2026-09-24)

An honest description of the code as it stands, including the problems Phase 15 addresses.

### Module map

```
src/
├── main.ts          # ~4,400 lines: DOM layout template, all UI wiring, keyboard map,
│                    #   perform/record/jam state machine, render loop, store subscription
├── types.ts         # Shared interfaces (Composition, Lane, AppState, …)
├── constants.ts     # Pitch range, zoom limits, cents/frequency conversion, timing constants
├── state/           # store.ts (signals-backed singleton), reactive.ts (watch/effect), history.ts (snapshot undo),
│                    #   clipboard.ts, perform-mode.ts (perform-vs-edit predicate)
├── model/           # curve, lane, track, tone, composition, curve-groups, layer, pass-log, point-selection
├── audio/           # engine, tone-synth, playback (voice-pool scheduler), curve-sampler, preview (live voices),
│                    #   metronome, midi-input, dynamics-bus, voice-allocation
├── canvas/          # viewport, interaction (tool mouse handling, ~1,400 lines), performance-engine
│                    #   (countdown / loop-wrap / AFK / rolling phrase buffer), and one renderer per layer
├── ui/              # toolbar, tool-panel, drawer, prism-panel, property panels, tone builder/picker, dialogs, HUDs
├── export/          # json-export (.gliss envelope + migrations), wav-export, midi-import
└── utils/           # bezier-math, snap, snap-magnetic, snap-presets, scales, harmonics, svg helpers
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

1. **`main.ts` does everything** — layout HTML, wiring, keyboard map, perform logic, render loop, and inline model edits (e.g. multi-point delete in the key handler).
2. **The perform state machine is implicit.** Play / jam / record / pass-record / MIDI-arm state is spread across ~8 flags in the store, the playback engine and module-level variables, each transition function setting its own combination. Two canvas mouse handlers use two different definitions of "is the left button performing?" (`isComposePerformActive` in `main.ts` vs. `isComposePerformLocked` in `interaction.ts`) — with Lock Rail off, a Draw click during Jam both sounds a note and places a curve point.
3. **Coarse store notification + hand-synced UI.** Every store change rebuilds the track list and both property panels via `innerHTML`, including on every mousemove of a drag. Widgets that don't subscribe drift out of sync. *(Resolved in 15.1: signals-backed store, targeted watches, render-if-changed panels.)*
4. **Duplicated state.** Snap settings exist in both `AppState` and `composition.snap`; loop-enabled lives in the playback engine; the snap config is built in three places that disagree (the Space-hold preview ignores guides and projection). *(Snap mirrors and loop state resolved in 15.1; the snap-config builders remain for 15.6.)*
5. **The render loop mutates the model** — it attaches volume lanes, moves volume points and clears the Prism projection source.
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

1. **Group controls by task, not by when they were built.** The gravity map is the North Star, so key, scale, Tune A4, snap, magnetic feel, presets and guides belong in one **Gravity** panel — not split across the top-bar Snap button, the Snap drawer and the Tuning drawer.
2. **One capture model.** Retrospective Keep makes a separate Jam mode largely redundant: if the rolling buffer always runs while the transport rolls, Jam is just Play, Keep is always available, and Record means "keep everything." Record-next-pass, Layer and MIDI-arm become options of one capture control rather than peers.
3. **No hidden modes.** If the left button performs instead of edits, the UI says so visibly (an explicit Perform state), rather than it being implied by Lock Rail + transport state.
4. **Frequent things visible, rare things tucked away.** Tools are an always-visible strip, not a drawer. Device and preference settings (MIDI device, dynamics source, metronome volume) move to a Settings dialog. HUD toggles, guide visibility and the manual go in a **View** menu.
5. **Each control exists once.** Loop currently appears in both the top bar and the Transport drawer.
6. **Name things unambiguously.** "Tuning" names both the drawer (key/A4) and a Harmonic Prism field (JI vs. ET chord ratios). Track-row buttons are single letters (M S I T X).
7. **Avoid timing-dependent keys** where possible (Space is tap = transport, hold > 250 ms = preview).

### Current layout (for reference)

- **Top bar:** composition name, length, File menu, Undo/Redo, Lock Rail toggle, transport (Play, Pause, Stop, Record, Jam, Keep), Snap and Loop toggles.
- **Left icon rail → drawers:** Transport (Loop, Layer, Pitch HUD, Perf HUD, BPM, time signature, metronome, dynamics source, MIDI device), Tools (Draw, Select, Delete, Slice), Snap (preset, magnetic Force/Spring/Damping, guides), Harmonic Prism, Tuning (Key/scale, Tune A4).
- **Centre:** staff canvas with top and bottom rulers and zoom sliders; the Parameters Graph (volume lane of the selected curve) below it, resizable.
- **Right panel:** Tool Properties, Object Properties, Tracks (+ Track, + Tone).

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
  "formatVersion": 1,             // cross-app contract; loaders migrate older files
  "kind": "composition",          // advisory self-description
  "meta":        { ... },         // optional: title, author, license, timestamps (opt-in only; never auto-stamp identity)
  "tuning":      { ... },         // optional: reference pitch + scale as explicit cents/ratios
  "snap":        { ... },         // optional: snap targets, strengths, guides — the gravity map
  "composition": { ... }          // tracks, curves, loops, bpm, …
}
```

`formatVersion` 1 wraps internal composition v4. A migration chain upgrades older saves (v1 flat JSON → per-point volume → volume lane → unified `lanes[]` + cents canon); legacy `.json` files still open. `tuning` and `snap` sit at the top level so preset tools and galleries can read them without parsing the piece.

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
