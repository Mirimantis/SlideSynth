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
| MIDI Export | `midi-writer-js` | Mature library with Track, NoteEvent, PitchBendEvent support |
| WAV Export | Manual PCM encoding | 44-byte RIFF header + 16-bit PCM samples. No library needed |
| Testing | Vitest | Ships with Vite, zero config |

**Why no React/Vue/Svelte?** The UI is ~90% canvas. The only DOM elements are the toolbar, tone builder dialog, and track/property panels. These are simple enough that vanilla DOM manipulation is cleaner than a framework fighting with imperative canvas code.

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

Control point positions must have strictly increasing X values (time only moves forward). Handles are clamped if they would cause X-reversal in the evaluated curve. This keeps curves well-defined for audio sampling and MIDI export, and matches musical intuition (you can't go back in time).

### 5. WAV Export via OfflineAudioContext

The `OfflineAudioContext` API renders the Web Audio graph in non-real-time. This means WAV export reuses the **exact same synthesis and scheduling code** as real-time playback — no separate rendering pipeline. The result is encoded as 16-bit PCM WAV at 44100Hz.

### 6. State Management Without a Library

A simple pub/sub store with `getState()`, `dispatch(action)`, and `subscribe(callback)` in ~60 lines. The undo system stores shallow copies of the composition on each mutation. The state shape is well-defined and the mutation surface is limited (~20 action types).

## Data Models

### ToneDefinition
Each tone defines a synthesizer voice that can be modulated to any pitch:
- **Waveform layers:** One or more oscillators (sine, square, sawtooth, triangle) with individual gain and detune
- **Distortion:** Optional waveshaper with configurable drive amount
- **Visual identity:** Color (CSS) and dash pattern for rendering on the staff

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
Top-level document: BPM, time signature, total length, array of tracks, and a tone library.

## Staff Configuration

- **Note range:** C2–C7 (5 octaves, 60 chromatic note lines)
- **Grid snap:** Each note line (Y) and each 1/16 beat (X) is a snap position
- **Free placement:** Holding Shift disables snap for continuous positioning
- **Zoom:** Independent X (time) and Y (pitch) zoom via Ctrl+wheel / plain wheel

## UI Layout

```
+---------------------------------------------------------------+
| [TOOLBAR] Play|Pause|Stop  BPM:[120]  Tool:[Draw|Select|Del]  |
| ZoomX:[---o---]  ZoomY:[---o---]  [Snap:ON]  [Save][Export]   |
+----------+-------------------------------------------+---------+
|  TRACKS  |            CANVAS (dual layer)            |  PROPS  |
|  200px   |  --- C5 --------------------------------  |  200px  |
| [Track1] |      ~~~~curve~~~~                        | Pitch:  |
|  # Sine  |  --- B4 --------------------------------  | Vol:    |
|  [M][S]  |           ~~~~curve~~~~                   | Time:   |
| [Track2] |  --- A4 --------------------------------  |         |
|  # Saw   |     |playhead                             |         |
|  [M][S]  |  ---|-----|-----|-----|-----|              |         |
| [+ Add]  |  |1     |2     |3     |4     |5           |         |
+----------+-------------------------------------------+---------+
```

Layout uses CSS Grid: `grid-template-columns: 200px 1fr 200px`, `grid-template-rows: auto 1fr`.

## MIDI Export Strategy

Since MIDI is note-based and our curves are continuous, export involves approximation:

1. Sample the curve at high resolution
2. Quantize each sample to the nearest MIDI note number
3. Group consecutive same-note samples into note events
4. Within each note, emit pitch bend events where the curve deviates >5 cents from the quantized pitch
5. Map volume changes to MIDI CC#11 (expression)
6. One SlideSynth track = one MIDI track

The export dialog notes: *"MIDI is an approximation of continuous curves. Use WAV export for exact reproduction."*

## Implementation Phases

| Phase | Focus | Milestone |
|-------|-------|-----------|
| 1 | Scaffolding + First Sound | Click a button, hear a synthesized tone |
| 2 | Canvas Staff + Viewport | Scrollable, zoomable chromatic staff |
| 3 | Drawing Curves | Pen tool places Bezier curves with snapping |
| 4 | Playback Engine | Draw a curve, press play, hear smooth pitch glide |
| 5 | Tone Builder + Multi-Track | Custom tones, multiple simultaneous tracks |
| 6 | Save/Export | JSON save/load, WAV and MIDI export |
| 7 | Polish | Undo/redo, keyboard shortcuts, performance |

## File Structure

```
src/
├── main.ts                    # Bootstrap
├── types.ts                   # All shared interfaces
├── constants.ts               # Musical constants, defaults
├── state/
│   ├── store.ts               # Pub/sub state store
│   └── actions.ts             # State mutations
├── audio/
│   ├── engine.ts              # AudioContext lifecycle
│   ├── tone-synth.ts          # Oscillator graph from ToneDefinition
│   ├── playback.ts            # Lookahead scheduler
│   └── curve-sampler.ts       # Bezier → pitch/volume samples
├── canvas/
│   ├── staff-renderer.ts      # Grid, labels, beat markers
│   ├── curve-renderer.ts      # Curves with color/dash/handles
│   ├── interaction.ts         # Pen tool, select, drag
│   ├── viewport.ts            # Pan, zoom, coord transforms
│   └── playhead.ts            # Animated playhead, scrub
├── model/
│   ├── tone.ts                # ToneDefinition CRUD + presets
│   ├── curve.ts               # BezierCurve manipulation
│   ├── track.ts               # Track management
│   └── composition.ts         # Top-level document
├── export/
│   ├── json-export.ts         # JSON save/load
│   ├── midi-export.ts         # Curves → MIDI
│   └── wav-export.ts          # OfflineAudioContext → WAV
├── ui/
│   ├── toolbar.ts             # Transport, zoom, tools
│   ├── tone-builder.ts        # Tone definition modal
│   ├── track-panel.ts         # Track list sidebar
│   ├── property-panel.ts      # Point/curve properties
│   └── dialogs.ts             # Save/load/export
└── utils/
    ├── bezier-math.ts         # Cubic Bezier math
    ├── music-math.ts          # Note/frequency conversions
    ├── snap.ts                # Grid snapping
    └── dom-helpers.ts         # DOM utilities
```

## Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| AudioParam stepping on rapid pitch changes | Use `linearRampToValueAtTime`, sample at 200pts/sec, test steep curves early |
| Canvas perf with many curves | Dual-canvas split, dirty-rect optimization if needed |
| Monotonic-X handle clamping confuses users | Visual feedback (red handle at clamp limit) |
| MIDI export is lossy | Clear disclaimer, recommend WAV for fidelity |
| Browser requires user gesture for AudioContext | Click-to-start overlay if context is suspended |
