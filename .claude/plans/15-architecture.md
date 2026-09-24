# Phase 15 — Consolidate the architecture: build plan

In-flight plan for BACKLOG Phase 15 (target in [DESIGN.md › Target architecture](../../DESIGN.md#target-architecture)). Delete this file when Phase 15 ships.

## Decisions (2026-09-24)

- **Signals library: `@preact/signals-core`** (MIT). Preact + `@preact/signals` (MIT) arrive with 15.4 for the panels; the canvas stays imperative.
- **One PR per step below**, each tested hands-on before the PR, per the usual flow. `main.ts` shrinks as each step pulls its region out (15.3 happens progressively, not as one big move).

## Sequence

| Step | Items | What lands | Why this order |
|------|-------|-----------|----------------|
| A | 15.1 | Signals-backed store; fine-grained UI effects replace the coarse `store.subscribe` calls in `main.ts`; snap mirrors removed; loop-enabled moved into state | Everything else subscribes to state; do it once, first |
| B | 15.2 | Transport/perform state machine (pure, tested) + one canvas input router + Pointer Events | Highest-bug-density region; Phase 16's capture redesign reshapes it, so it must be explicit first |
| C | 15.6, 15.5 | One snap-config builder; render loop made read-only; `fgDirty` + `Path2D` cache | Small, independent; unblocks 12.1 |
| D | 15.3 | Command registry (keyboard / buttons / menus / help table) | Needs A and B to exist so commands have somewhere to dispatch |
| E | 15.4 | Preact panels, one at a time, starting with those Phase 16 won't reshape | After A so components read signals directly |
| F | 15.7 | AudioWorklet live voice | Independent; can move earlier if 14.3's interim glide proves insufficient |
| — | 15.8 | Kernel tests | Accompany every step rather than a step of their own |

## Step A — signals-backed store (15.1) — DONE (branch `phase-15a-signals-store`)

As built: matches the approach below, with two changes. `store.subscribe` was removed rather than kept as a shim, because every caller migrated. Structured point selection moved to step B. Panels use `setHtmlIfChanged` plus id-lookup listeners as the stopgap until step E's Preact components.

**Approach: keep the read API, change what's underneath.** About 190 sites read `store.getState().x`; rewriting them all buys nothing. Instead:

- Each top-level `AppState` field is backed by a **version signal**. `getState()` returns an object whose properties are accessors: reading a field inside an `effect` / `computed` subscribes to it; outside one, it's a plain read.
- Nested objects (`performance`, `harmonicPrism`, the composition) keep **stable references** and are mutated in place, as today; their setter bumps that field's version. Reference stability matters because many call sites cache `const g = st.performance` across setter calls.
- `store.mutate(fn)` bumps the composition version. Hot paths that intentionally don't notify today (`setPlanchetteY`, `markPlanchetteCrossed`, `setPlaybackPosition`) stay silent.
- **Derived, not mirrored:** `snapEnabled`, `scaleRoot`, `scaleId`, `hidePitchLines` and the `magnetic*` fields become accessors over `composition.snap` (tracked by a `snap` version), so `loadComposition` no longer hydrates copies.
- **`loopEnabled` moves into state.** The playback engine is driven by an effect instead of owning the flag.
- **State kinds are explicit** in the store module: document (composition, undoable, saved), workspace preferences (localStorage), runtime (transport, selection, planchettes).
- **Structured point selection** replaces `curveId:idx` string keys — *deferred to step B or later* if it balloons step A; it touches interaction code step B rewrites anyway.
- `store.subscribe` stays as a compatibility shim (fires on any version bump) for anything not yet migrated.

**UI updates become targeted effects.** The big subscriber in `main.ts` splits into one effect per concern (transport buttons, snap drawer, metronome, …). The track list and property panels render from a **view-model key** (a `computed` string of exactly what they display), so they re-render when that changes — not on every mousemove of a drag.

**Composite actions** (e.g. `composePerformStop`, eight setters) run inside `batch()` so effects see one consistent update.

**Tests:** fine-grained notification (a magnetic-slider change doesn't re-run the track-list effect; a point drag doesn't re-render the property panel), derived snap fields after `loadComposition`, loop-enabled round-trip, and the existing store tests unchanged.

**Hands-on test focus:** every drawer control still reflects state after undo / redo / file open; dragging points and transform boxes feels the same or better; track list and property panel stay correct during and after drags.
