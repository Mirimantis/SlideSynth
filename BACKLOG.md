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

- [ ] **8.2 Move curve to a different track** *(M, feature)*
  Track-picker dropdown in Object Properties (when a single curve is selected) listing existing tracks plus "+ New track". Single `store.mutate()` with one history snapshot. Edge case: clear `groupId` on move so the moved curve doesn't accidentally couple with siblings on the new track.

- [ ] **8.18 Live recording trail visualization** *(S–M, feature)*
  A newly recorded curve currently doesn't appear until the user finishes recording — there's no visible feedback that anything is being captured. Add some kind of live trail behind the planchette during record. If rendering the raw pre-smoothed sample points is impractical, fall back to a temporary breadcrumb / fading trace that gets replaced by the simplified curve once it's committed on release. Render in the foreground layer alongside the planchette so it scrolls with the canvas in Scroll Canvas mode.

- [ ] **8.20 Record AFK timer should respect loop / future content** *(S, bug)*
  The perform-engine AFK timeout (`afkTimeoutMs` in [src/canvas/performance-engine.ts](src/canvas/performance-engine.ts)) currently fires whenever record is armed and there's no input activity, even when the session has a meaningful reason to keep waiting. Suppress the auto-stop when (a) Loop is enabled (the user is intentionally recording over loops), or (b) the playhead hasn't yet reached the rightmost control point in the composition (there's still future content to record over). Update `tickComposePerform`'s `onAfkTimeout` gate or thread the new conditions through `TickArgs`.

### Selection & editing
- [ ] **8.3 Multi-select points: shift-click + drag-marquee** *(M, feature)*
  Select tool currently supports shift+click on whole curves; extend to (a) shift+click on individual points and (b) drag-marquee on empty canvas. Likely needs a new `selectedPointIndices: Set<{curveId, idx}>` shape on `AppState`. Transform Box already handles multi-curve geometry — likely reusable for multi-point bounds.

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

- [ ] **8.19 Rename Key "None" to "Chromatic" + new "None" mode (no pitch lines)** *(S, feature + UX)*
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

- [ ] **8.21 MIDI sustained note doesn't continue past loop wrap** *(S, bug)*
  When a MIDI note is held across a loop wrap during recording, the wrap finalizes the note's curve (correct — `finalizeAllInFlightMidiVoices` in `tickComposePerform`'s `onLoopWrap` callback in [src/main.ts](src/main.ts)) but the synth and recording don't restart on the other side, so the held note goes silent and stops capturing. Should: keep the synth voice alive across the wrap, and start a fresh recording for that voice from the loop start beat so the held note becomes two contiguous curves (one ending at loop-out, one starting at loop-in). Match LMB-held perform behavior on loop wrap.

### Harmonic Prism nice-to-haves
- [ ] **8.12 Chord-spec hotkeys / number-key favorites** *(M, feature)*
  Phase 6.3's state plumbing already retunes voices live whenever the chord spec changes — the missing piece is a non-LMB way to trigger the change so the user can shape-shift mid-perform. Concept: user-definable chord-shape favorites bound to number keys.

- [ ] **8.13 Inversion controls** *(S, feature)*
  Reorder the ratio chain or add octave offsets to specific voices.

- [ ] **8.14 Chord-label readout on selected groups** *(S, feature)*
  Honest about microtonal bases ("C(+17¢) major"). Shown in Object Properties when a chord cluster is selected.

- [ ] **8.15 "Lite harmonies" audio mode** *(S, feature)*
  Sine-only for harmony voices, for CPU relief when running 5×multi-layer voices.

- [ ] **8.16 Secondal stacking** *(S, feature)*
  Cluster chords. Listed as low priority in the original Harmonic Prism design doc.

- [ ] **8.17 CPU monitoring under heavy loads** *(S, ops)*
  Verify multi-voice perform + multi-layer tones + playback CPU on target hardware. Measure before optimising.

---

## Housekeeping reminders

- Update [help.html](help.html) in the same PR as each feature.
- User testing pass in the dev server before PRing each item (ship-after-review).
- Dev server for this worktree: `npm run dev` → port 5187.
