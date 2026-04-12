# SlideSynth - Design Document

## Overview

SlideSynth is a browser-based music composition app where users draw Bezier curves on a chromatic staff to create smooth, continuous pitch modulation — like a trombone or theremin. Instead of placing discrete notes, users sketch tonal lines with control points that define pitch, timing, and volume simultaneously.

## Core Concept

Traditional music notation uses discrete note symbols. SlideSynth replaces this with **vector curves**: the user draws Bezier paths across a chromatic staff using a pen tool (similar to Illustrator). The vertical position of the curve controls pitch continuously, enabling smooth glides between notes. Each control point also carries a volume value, allowing fade-in/fade-out dynamics.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (strict) | Type safety for complex audio math, Bezier calculations, and data models |
| Build | Vite (`vanilla-ts`) | Near-zero config, fast HMR, native ES modules. No framework overhead for a canvas-heavy app |
| Rendering | HTML5 Canvas (2D) | Full control over zoom, pan, custom grid rendering, curve drawing. Outperforms SVG for many elements with real-time interaction |
| Audio | Web Audio API (native) | OscillatorNode, GainNode, WaveShaperNode, AudioParam scheduling for smooth pitch/volume modulation |
| WAV Export | Manual PCM encoding | 44-byte RIFF header + 16-bit PCM samples. No library needed |
| Testing | Vitest | Ships with Vite, zero config |

**Why no React/Vue/Svelte?** The UI is ~90% canvas. The only DOM elements are the toolbar, tone builder dialog, tone picker popup, and track/property panels. These are simple enough that vanilla DOM manipulation is cleaner than a framework fighting with imperative canvas code.

**Note on MIDI:** MIDI *export* was considered but deferred. MIDI's note-based model doesn't naturally support the continuous pitch modulation that is SlideSynth's core feature. Approximation via pitch bend events is possible but lossy. WAV export provides exact reproduction and is the recommended output format. MIDI *import* is supported — MIDI notes are converted to Bezier curves (one curve per note, with pitch bends applied).

## Architecture Decisions

### 1. Dual Canvas Strategy

Two `<canvas>` elements stacked via CSS absolute positioning:
- **Background canvas:** Staff grid lines, note labels, beat markers. Only redrawn on zoom/pan changes.
- **Foreground canvas:** Bezier curves, control handles, playhead, selection visuals. Redrawn per animation frame.

This avoids the main performance bottleneck: redrawing hundreds of grid lines 60 times per second when only the curves or playhead change.

### 2. Persistent Oscillator per Track

Rather than creating/destroying OscillatorNodes per note (which causes audio clicks), each track maintains a **single OscillatorNode** for the duration of playback. Pitch and volume are controlled entirely through `AudioParam` scheduling. Gain ramps to zero in gaps between curves. This produces the smooth continuous sound that is the core value of SlideSynth.

### 3. Lookahead Audio Scheduler

A `setInterval` fires every 25ms and schedules AudioParam changes 100ms into the future. For each active curve, the curve sampler generates ~200 pitch/volume samples per second from Bezier evaluation, which are scheduled via `setValueAtTime` and `linearRampToValueAtTime`.

### 4. Monotonic-X Constraint

Control point positions must have strictly increasing X values (time only moves forward). Handles are clamped if they would cause X-reversal in the evaluated curve. This keeps curves well-defined for audio sampling and matches musical intuition (you can't go back in time).

### 5. WAV Export via OfflineAudioContext

The `OfflineAudioContext` API renders the Web Audio graph in non-real-time. This means WAV export reuses the **exact same synthesis and scheduling code** as real-time playback — no separate rendering pipeline. The result is encoded as 16-bit PCM WAV at 44100Hz stereo.

### 6. State Management Without a Library

A simple pub/sub store with `getState()`, `mutate(fn)`, and `subscribe(callback)` in ~120 lines. The state shape is well-defined and the mutation surface is limited. Undo/redo is implemented via snapshot-based state stacking (see below).

### Undo/Redo via Snapshot Stacking

A `UndoHistory` singleton takes deep clones of the `Composition` (via `JSON.parse(JSON.stringify())`) before each undoable operation. Clones are stored in an undo stack (max 50). On undo, current state is pushed to the redo stack and the previous snapshot is restored via `store.loadComposition()`. Drag operations are batched: the snapshot is taken on `mousedown`, so the entire drag counts as one undo step. Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo). UI buttons are also provided in the toolbar.

### 7. Bounded Viewport

The viewport clamps pan/scroll to stay within the composition bounds: beat 0 to `totalBeats` on the X axis, and C0 (MIDI 12) to C9 (MIDI 120) on the Y axis — 9 octaves. This prevents users from getting lost in infinite empty space. The composition length is user-configurable (default 120 beats = 1 minute at 120 BPM, max 3000 beats).

## Data Models

### ToneDefinition
Each tone defines a synthesizer voice that can be modulated to any pitch:
- **Waveform layers:** One or more oscillators (sine, square, sawtooth, triangle) with individual gain and detune
- **Distortion:** Optional waveshaper with configurable drive amount and oversample setting
- **Visual identity:** Color (CSS) and dash pattern for rendering on the staff

Four preset tones are included: Pure Sine, Bright Square, Warm Pad, and Buzzy Saw.

### ControlPoint
Each point on a Bezier curve carries:
- **Position:** `(x, y)` where x = time in beats, y = continuous MIDI note number (60.0 = C4, 60.5 = quarter-tone)
- **Handles:** Incoming and outgoing control handles (relative to position) defining curve shape
- **Volume:** 0.0–1.0 at this point, interpolated along the curve

### BezierCurve
An ordered list of ControlPoints with increasing X. Between consecutive points P[i] and P[i+1], a cubic Bezier segment is defined by:
- P0 = P[i].position
- P1 = P[i].position + P[i].handleOut
- P2 = P[i+1].position + P[i+1].handleIn
- P3 = P[i+1].position

### Track
Groups curves that share a tone. Has mute, solo, and volume controls.

### Composition
Top-level document: BPM, beats per measure, total length in beats, array of tracks, and a tone library.

## Staff Configuration

- **Note range:** C0–C9 (9 octaves, 108 chromatic note lines)
- **Grid snap:** Each note line (Y) and each 1/16 beat (X) is a snap position
- **Free placement:** Press **S** to toggle snap on/off (shown as a toolbar button)
- **Zoom:** Independent X (time) and Y (pitch) zoom via scroll wheel (Ctrl+wheel for Y)

## UI Layout

```
+---------------------------------------------------------------+
| [TOOLBAR] Play|Pause|Stop [Loop]  BPM:[120]  Length:[120] 1:00|
| Tool:[Draw|Select|Del]  ZoomX:[--o--]  ZoomY:[--o--]  [Snap] |
| [Save] [Load] [WAV] [MIDI]  [Undo] [Redo]                    |
+----------+-------------------------------------------+---------+
|  TRACKS  |            CANVAS (dual layer)            |  PROPS  |
|  200px   |  --- C5 --------------------------------  |  200px  |
| [Track1] |      ~~~~curve~~~~                        | Pitch:  |
|  # Sine  |  --- B4 --------------------------------  | Vol:    |
|  [M][S]  |           ~~~~curve~~~~                   | Time:   |
| [Track2] |  --- A4 --------------------------------  |         |
|  # Saw   |     |playhead                             |         |
|  [M][S]  |  ---|-----|-----|-----|-----|              |         |
| [+Track] |  |1     |2     |3     |4     |5           |         |
| [+Tone]  |                                           |         |
+----------+-------------------------------------------+---------+
```

Layout uses CSS Grid: `grid-template-columns: 200px 1fr 200px`, `grid-template-rows: auto 1fr`.

### Track Panel Features
- Click a track to select it, select all its curves, and show a transform box around them (auto-switches to Select tool)
- Click the tone name to open a **tone picker popup** for reassigning the track's tone
- **M** button mutes a track; **S** button solos it (only solo tracks play when any track is soloed)
- **T** button opens the tone builder to edit the track's current tone
- **+ Track** button opens tone picker first, then creates a new track with the chosen tone
- **+ Tone** button opens the tone builder to create a new tone from scratch

### Curve Selection and Transform
- **Select tool:** Click a curve segment to select it and activate its transform box
- **Multi-select:** Hold **Shift** and click additional curves to add/remove them from the selection
- **Transform box:** Surrounds all selected curves with resize handles (edges, corners) and translate (drag body)
- **Octave shift buttons:** ▲/▼ arrows on the transform box shift all selected curves ±12 semitones
- Clicking a point on a selected curve (single-select only) enables point editing with handle display
- Clicking an unselected curve inside a transform box selects it instead of starting a translate drag
- **Ctrl held** in Draw mode temporarily switches to Select for quick Ctrl+click selection
- **Delete/Backspace** with curves selected (no point selected) deletes all selected curves

### Tone Picker
A popup anchored to the click target, listing all tones in the library with:
- Color swatch and dash pattern preview (rendered on a mini canvas)
- Tone name and waveform layer summary
- Click to select; click outside or press Escape to cancel

### Property Panel
Context-sensitive right panel:
- **When no point is selected:** Shows track info (name, tone, volume slider)
- **When a control point is selected:** Shows point details (time in beats, pitch as note name + cents deviation, volume slider, handle coordinates)

## Playback Features

- **Play/Pause/Stop** transport controls
- **Loop toggle:** When enabled, playback restarts from beat 0 when reaching the end of the composition
- **Composition length:** Configurable total beats (default 120, min 4, max 3000). Playback stops (or loops) at this boundary.
- **Playhead:** Visual indicator on the canvas showing current playback position. Visible during playback and when paused at a non-zero position.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Toggle play/pause |
| D | Switch to Draw tool |
| V | Switch to Select tool |
| X | Switch to Delete tool |
| S | Toggle grid snap on/off |
| L | Toggle loop on/off |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Delete / Backspace | Delete selected point, or all selected curves (if no point selected) |
| Enter / Escape | Finish current drawing |
| Ctrl (held in Draw mode) | Temporarily switch to Select tool |
| Shift+Click (Select tool) | Add/remove curve from multi-selection |
| Alt+Click drag | Pan the canvas |
| Middle-click drag | Pan the canvas |
| Scroll wheel | Zoom X axis |
| Ctrl+Scroll wheel | Zoom Y axis |

## Export

### JSON (Save/Load)
Compositions are serialized as versioned JSON files. The format preserves the complete composition structure including all tracks, curves, control points, and the tone library. Load replaces the current composition entirely.

### WAV Export
Uses `OfflineAudioContext` to render the full composition offline at 44100Hz stereo. The same synthesis code path (tone synth + curve sampler + scheduling) is used for both real-time playback and WAV export, guaranteeing identical output. The result is encoded as a standard 16-bit PCM WAV file.

### MIDI Import
MIDI files (`.mid`, `.midi`) can be imported via the toolbar button. Each MIDI channel maps to a track, and each note event is converted to a two-point Bezier curve (note-on to note-off). Pitch bend events are applied to adjust the curve's Y position. Tracks are auto-assigned tones from the default library in round-robin fashion. Composition BPM and total length are derived from the MIDI file's tempo and duration.

## Implementation Status

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Scaffolding + First Sound | Complete |
| 2 | Canvas Staff + Viewport | Complete |
| 3 | Drawing Curves | Complete |
| 4 | Playback Engine | Complete |
| 5 | Tone Builder + Multi-Track | Complete |
| 6 | JSON Save/Load + WAV Export | Complete |
| 7 | MIDI Import | Complete |
| 8 | Curve Select + Transform Box | Complete |
| 9 | Undo/Redo | Complete |
| 10 | Multi-Curve Selection | Complete |
| 11 | UX Polish (extended range, snap toggle, shortcuts) | Complete |

## File Structure

```
SlideSynth/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── DESIGN.md
├── src/
│   ├── main.ts                    # Bootstrap, wire all modules together
│   ├── types.ts                   # All shared interfaces
│   ├── constants.ts               # Note range, zoom limits, presets, defaults
│   ├── state/
│   │   ├── store.ts               # Pub/sub state store with multi-curve selection
│   │   └── history.ts             # Snapshot-based undo/redo (max 50 steps)
│   ├── audio/
│   │   ├── engine.ts              # AudioContext lifecycle, user-gesture guard
│   │   ├── tone-synth.ts          # Build oscillator graph from ToneDefinition
│   │   ├── playback.ts            # Lookahead scheduler with loop support
│   │   └── curve-sampler.ts       # Bezier → pitch/volume sample arrays
│   ├── canvas/
│   │   ├── staff-renderer.ts      # Grid lines, note labels, beat markers
│   │   ├── curve-renderer.ts      # Curves with color/dash, handles, multi-select rendering
│   │   ├── interaction.ts         # Pen tool, select (multi-curve), drag, delete, transform
│   │   ├── transform-box-renderer.ts  # Transform box with resize handles and octave buttons
│   │   ├── viewport.ts            # Pan, zoom, coord transforms, clamping
│   │   └── playhead.ts            # Animated playhead line
│   ├── model/
│   │   ├── tone.ts                # ToneDefinition defaults + presets
│   │   ├── curve.ts               # BezierCurve/ControlPoint manipulation
│   │   ├── track.ts               # Track creation
│   │   └── composition.ts         # Top-level document model
│   ├── export/
│   │   ├── json-export.ts         # Serialize/deserialize, file download/open
│   │   ├── wav-export.ts          # OfflineAudioContext → 16-bit PCM WAV
│   │   └── midi-import.ts         # MIDI file → Composition conversion
│   ├── ui/
│   │   ├── toolbar.ts             # Transport, BPM, length, tools, zoom, snap
│   │   ├── tone-builder.ts        # Tone definition modal dialog
│   │   ├── tone-picker.ts         # Tone selection popup
│   │   └── property-panel.ts      # Selected point/track properties
│   └── utils/
│       ├── bezier-math.ts         # Cubic Bezier eval, subdivision, hit-test
│       ├── music-math.ts          # Note/frequency conversions
│       ├── snap.ts                # Grid snapping (1/16 beat + note line)
│       └── dom-helpers.ts         # Minimal DOM utilities
├── styles/
│   ├── main.css                   # App layout, toolbar, canvas
│   ├── panels.css                 # Track panel, property panel
│   └── dialogs.css                # Tone builder modal, tone picker popup
└── test/
    ├── bezier-math.test.ts
    ├── music-math.test.ts
    ├── curve-sampler.test.ts
    └── snap.test.ts
```

## Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| AudioParam stepping on rapid pitch changes | Use `linearRampToValueAtTime`, sample at 200pts/sec, test steep curves early |
| Canvas perf with many curves | Dual-canvas split, dirty-rect optimization if needed |
| Monotonic-X handle clamping confuses users | Visual feedback when handles are constrained |
| Browser requires user gesture for AudioContext | `ensureResumed()` guard on first playback interaction |
