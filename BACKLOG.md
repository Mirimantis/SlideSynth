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

## Phase 6 — Reserved

- [ ] **6.1 Harmonic Prism** *(XL, own planning session — user has additional notes)*
  Dynamic chords at selectable harmonic frequencies. Out of scope until dedicated planning pass.

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

## Housekeeping reminders

- Update [help.html](help.html) in the same PR as each feature.
- User testing pass in the dev server before PRing each item (ship-after-review).
- Dev server for this worktree: `npm run dev` → port 5187.
