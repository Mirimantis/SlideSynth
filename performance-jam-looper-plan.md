# Performance Mode: Magnetic-Snap Jam + Live Looper — Planning Note

> **Status: PARTIALLY TRANSFERRED (2026-07-19).**
> The near-term sections below have been resolved and moved to [BACKLOG.md](BACKLOG.md) as sequenced items — **Phase 10** (jam mode & live looper), **Phase 11** (dynamics bus), **Phase 12** (harmony & format guardrails). Items carry `→ BACKLOG x.y` markers where transferred.
> The hardware, VST/VCV, and business sections remain **THINKING — not ready to build**; do not write implementation code from those sections. Each `own planning session` backlog item still gets a dedicated design pass before code.

---

## North Star — why this project exists

Most music tools treat **pitch as categories with continuous motion bolted on**: discrete note-numbers, pitch-bend as an inexact afterthought, the space between notes as a thin dividing line. Glissandograph inverts this:

> **Pitch is a continuous field. "Notes" are optional landmarks within it — thin slivers of spectrum, gravity wells you can lean on or ignore.**

Everything serves this. **Magnetic snap is the inversion made tangible: adjustable gravity, not a mandatory grid.** Scale lines, just-intonation targets, and snap-to-sounding-harmony are all just different gravity-well configurations over the same continuous field.

The instrument's true ancestor is **the voice**, not the keyboard: pitch *and* volume shaped continuously through one sustained tone. Each loop layer is a voice; the looper assembles a choir.

*Port implication:* MIDI is blocks-plus-bend by design, so an eventual VST fits best as an **MPE / note-expression generator**. **CV / VCV Rack** expresses the continuous-field paradigm more purely — pitch CV is just the spectrum, no blocks.

---

## The core kernel

The novel, portable thing is **live gesture + magnetic snap** (most fun, most compelling results). This is what an eventual VST/VCV module exists *for*.

- **Portable (the product):** live gestural pitch, magnetic snap, Harmonic Prism as a live chord generator, live looping of the above.
- **Prototype-only scaffolding (a DAW / Rack will own it):** the timeline/score document model, JSON save/load, WAV export, MIDI file import. Don't over-invest polish here.

---

## Settled design decisions

### Clock & performance mode
- [x] Decouple the BPM clock from the record/length commitment. In performance/jam mode the clock **free-runs**: canvas scrolls, sound on, magnetic snap fully live, no fixed composition length, nothing armed. **→ BACKLOG 10.1.** *(Code note: today "unbounded" recording is faked via `endBeat = compLength + 10_000` in `startComposePerformPlayback` — 10.1 formalizes this.)*
- [x] **Confirmed in code (2026-07-19) — answer is no, needs work:** *instant* pitch snap is static and works at rest, but the **magnetic** physics ticks off `playback.getPositionBeats()` and only runs during an active LMB perform (`computeComposeCursorPitch` in `src/main.ts`). Off the perform path the integrator is reset and snap is instantaneous. Giving magnetic snap a playback-independent time base (wall-clock dt when the transport is idle) is folded into **BACKLOG 10.1**.
- *Rationale:* a running clock is what lets a free gesture be captured in **musical time**, so it can later be looped / quantized / edited into a theme. A clock-less capture would be wall-time wiggle needing a retrofit tempo.
- [x] **Decided (2026-07-19):** jam-mode time-axis beat-snap defaults **off** (free rubato); toggle available for groove work. Pitch-axis magnetic snap is always live.
- [x] **Decided (2026-07-19):** the free-running clock uses the **composition BPM** (persisted, editable in Transport). Tap-tempo is a later nicety.

### Retrospective capture (high priority) — → BACKLOG 10.2 (own planning session)
- A rolling buffer (~30s, tunable) of gesture runs continuously during jam.
- A **"keep that"** key commits what was *just* played into a curve, after the fact — serendipity isn't armed in advance.
- Because the clock runs, the buffer stores musical-time positions, so the kept gesture drops straight onto the loop grid, in time, no quantize step.
- Gestures crossing the loop seam reuse the **loop-wrap finalization already built for held MIDI notes (8.21)** — split into two contiguous curves at the boundary.

### Live looping (built in)
- Loop length: **set loop-in / loop-out points** (current approach, works well) is the primary idiom.
- Layers = **tracks**: each kept pass becomes its own track, inheriting mute / solo / volume and its own tone. **→ BACKLOG 10.3.**
- [x] **Undo last layer** as a single key — sacred in live looping; throw away a bad pass instantly. **Decided (2026-07-19): one undo stack, semantic key** — each kept pass is exactly one undo entry; the key is a targeted undo of the most recent kept pass (resolves loose end #4). **→ BACKLOG 10.4.**
- Two capture styles, mapped to the two content types:
  - **Deliberate "record next full pass"** → structured material (drones, harmony beds placed precisely). **→ BACKLOG 10.5.**
  - **Retrospective "keep that"** → serendipitous leads. **→ BACKLOG 10.2.**

### Snap-to-sounding-harmony (unification) — → BACKLOG 12.1 (own planning session, after Phase 10)
- Let the currently sounding bed (a drone, or a Harmonic Prism chord) **become the magnetic-snap target**, so the lead snaps toward the *live* harmony instead of a fixed scale.
- Fuses the three favorites — magnetic snap + Harmonic Prism + drones — into one idea: **you snap to the harmony you're actually in.**
- *Code note:* today's snap-target combination is not additive everywhere — Prism projection targets **replace** scale/chromatic/guides while active (`src/utils/snap.ts`). The 12.1 planning session must define composition rules (loose end #2) before harmony targets join the set.

### Loop-boundary handling
- [x] **Decided (2026-07-19):** bar-quantize applies to the future **live "set loop in/out" taps** during jam (absorbing reaction delay); the existing **dragged markers keep today's fine-grid snapping** for precise editing. **→ BACKLOG 10.6.**
- Optional classic-looper behavior: read a late tap as the *previous* boundary and snap the playhead back so the loop catches cleanly (folded into 10.6).

---

## Open questions — decide before building

- [x] Does jam mode default to **beat-snap on** (groove) or **off** (free rubato)? **Decided: off**, with a toggle (see Clock section).
- [ ] UI/triggers: actual keys/controls for *keep that*, *deliberate record*, *undo last layer*, *set loop in/out live*. **Deferred to the per-item planning sessions (10.2, 10.4–10.6).**
- [x] How do stacked layers stay **visually distinguishable** — **folded into BACKLOG 10.3**: lean on 8.23's non-active-track dimming; remaining polish scoped inside the item.
- [x] Snap-to-harmony resolution when the bed is **dense** (cluster / secundal) — **folded into the 12.1 planning session.**
- [x] Live loop-out (set loop-out mid-jam) — **unparked → BACKLOG 10.6** (bar-quantize absorbs reaction delay; late-tap-reads-as-previous-boundary optional).
- [x] Should retrospective "keep that" with **no preset region** *define* the region from the kept phrase (first-take-defines)? — **input to the 10.2 planning session.**

---

## Musical best practices to honor (the vocal / choral lineage)

- **Voice, not piano.** Expression lives in the *swell* — pitch and volume shaped within a sustained note — not in note-onsets.
- **Just intonation over drones.** Pure (beatless) thirds/fifths "ring" the way a locked a cappella chord does; equal temperament can't. The Prism's pure ratios + microtonal tuning already enable this. Biggest sonic lever the prototype has that an ordinary synth doesn't.
- **Register separation.** Drone low, harmony mid, lead high — already done by instinct; crowding one octave = mud.

---

## Hardware: motorized slide input + haptics (parallel track) — THINKING

A **motorized slide potentiometer** as the linear pitch input, with **haptic feedback**. Currently prototyping the hardware; must tie into the final software, and into this prototype if feasible.

**The unification — this is the North Star made physical.** The motor renders the gravity wells as *force*: it pulls the cap toward the nearest scale line / JI target / sounding-harmony pitch. The existing **magnetic-strength parameter becomes motor force.** You feel the snap instead of seeing it — a fretless slider with tactile landmarks you can lean into or override. This is the thing a mouse can never do, and therefore the thing worth selling.

### Integration architecture
- **Haptic loop runs on the microcontroller, not the browser.** Read position → compute restoring force toward nearest target → drive motor, at hundreds of Hz, for a stable feel. The browser tab + audio thread are too slow/jittery.
- **Protocol:** software sends the device a **map of snap targets + strengths** (re-sent when scale or harmony changes); device streams back **position = pitch**. The same protocol survives the VST/VCV port — the host just supplies a different gravity map.
- **Prototype hookup:** **Web Serial / WebHID** lets a Chromium browser talk to the USB device directly, no native app. Caveat: Chromium-only (Chrome/Edge), not Firefox/Safari — fine for a prototype.

### Interactions the motor unlocks
- **Felt snap detents** (magnetic strength = motor force).
- **Felt harmony:** snap-to-sounding-harmony becomes a physical pull toward the ringing chord tones.
- **Motorized playback + touch-override:** the motor retraces a kept/looping layer; touch-sensing lets you grab the cap to punch in/overwrite, release to resume. (Console touch/latch automation — perfect for the looper + retrospective capture.)
- **Beat pulse** as a felt metronome (optional).
- **Soft end-stops** at the edges of the pitch range.

### Hardware design notes / risks
- **One fader = monophonic = one voice at a time → looped into a choir.** The hardware constraint reinforces the software model. (Future: a *bank* of motorized faders = a chord / Harmonic Prism voices shaped by hand.)
- **Felt fidelity is the make-or-break.** Slide-pot motors are built for position recall, not rich force rendering; backlash and cogging can make detents mushy. **Prototype the detent feel first.**
- [ ] **Resolution vs. range:** a pot + 10–12-bit ADC over 9 octaves may be too coarse for fine microtonal work. Scope the fader to a *shiftable window* (octave/two) with octave-shift controls?

### Microcontroller, firmware & USB
- **Prototype MCU:** Adafruit Feather RP2040 (dual Cortex-M0+ @ 133 MHz, four 12-bit ADCs, 16 PWM channels, USB-C, host/device USB).
- **Core split:** pin the haptic control loop to one core, USB comms to the other → fixed-rate, jitter-free force loop independent of USB timing.
- **Fixed-point math:** the M0+ has no FPU; keep the tight force loop in integer/fixed-point, not float. Upgrade path if needed: **Feather RP2350** (same ecosystem + PIO, adds an FPU).
- **Single-USB power:** drive the motor from the 5 V USB rail through the H-bridge with current limiting (*not* the 3.3 V logic reg); use USB-C current negotiation so a motor stall can't brown out the board.
- **Single-USB data (driverless):** present as a **class-compliant composite USB device** (MIDI + CDC serial via TinyUSB). The browser prototype talks over Web Serial (CDC); the commercial unit also speaks class-compliant MIDI → driverless on every OS, plugs straight into a DAW for the VST future.
- **Durable IP = the protocol + the control-loop math, not the chip.** This is what makes "open to different chipsets" the right call: lock the protocol, keep the silicon free.
- **Commercial sensing:** consider a contactless magnetic position sensor on the carriage instead of leaning on the pot wiper + RP2040 ADC — better microtonal resolution, no wiper wear. The motor still supplies the force.

### Open questions
- [ ] **Dynamics axis.** The fader is the pitch axis; the vocal model says the *swell* (volume within a note) is where expression lives. What controls dynamics on the hardware — cap pressure / aftertouch, a second fader, an expression pedal, breath?
- [ ] **Protocol spec.** Define the snap-target-map format + the position→pitch stream early — it's the through-line across mouse prototype → RP2040 → custom PCB → VST/VCV. *(The `Lane.gravity` field and the envelope's `tuning`/`snap` sections, both shipped, are the natural payload skeleton.)*

## Business model — THINKING

- **Software free** (fun with a mouse) as the **adoption funnel**; **sell the slide hardware.**
- *Implication:* the mouse version must make people *crave* the tactile one, and the hardware must deliver what the mouse can't — **felt gravity.** The haptic feel is the entire value proposition, which is why detent fidelity (above) is the central bet.
- [ ] **Protocol openness:** keep the device protocol open (invites 3rd-party / community hardware, helps the VST/VCV ecosystem) or closed (protects the hardware business)? Decide later.

---

## File format — `.gliss`

**Decision:** custom `.gliss` extension, **JSON inside** (human-readable, web-native, easy to version). The extension buys identity / icon / app association; internals can change later without changing the extension.

**Status (2026-07-19): the envelope shipped** in `src/export/json-export.ts` — `app: "glissandograph"`, `formatVersion: 1`, `kind: "composition"`, optional `meta` / `tuning` / `snap` sections, `composition` payload; saves download as `.gliss`; migrations v1→v4 exist (per-point volume → volume lane → unified `lanes[]` + cents canon). Still to build: `.glisskit` + the Import-settings verb (**→ BACKLOG 12.2**) and full round-trip preservation (**→ BACKLOG 12.3**, see below).

**Bake in now (painful to retrofit):**
- `formatVersion` — bumped on schema changes; loader upgrades older files. ✅ shipped
- `kind` — `"composition" | "presetPack"` — decides load *behavior* (replace workspace vs. apply settings without clobbering current work). ✅ shipped (`"composition"` only so far)
- A type marker (`app: "glissandograph"`) so a file is identifiable even if renamed. ✅ shipped

**Schema = one format, modular optional sections:**
```
{
  "app": "glissandograph",
  "formatVersion": 1,
  "kind": "composition",
  "meta":        { ...optional... },
  "tuning":      { ...optional... },   // reference pitch + scale as explicit cents/ratios
  "snap":        { ...optional... },   // snap targets, strengths, guides
  "composition": { tracks, curves, loops, bpm, ... }
}
```
- **Full piece** = all sections present.
- **Preset pack** = `tuning` and/or `snap`, empty/absent `composition`, `kind: "presetPack"`.

**Presets: one schema, two extensions, two verbs.** Ship both `.gliss` (compositions) and `.glisskit` (dedicated preset sharing) — *same JSON schema underneath*. Separate the **verb** from the **file**: any conforming file supports two load actions —
- **Open** — load everything, replace the workspace (default for `.gliss`).
- **Import settings** — read only `tuning`/`snap`, apply them, ignore the rest (default for `.glisskit`; also a **File ▸ Import settings…** menu item that works on *any* `.gliss` or `.glisskit`).

The **extension picks the default verb**, so renaming `.gliss` → `.glisskit` "just works": it routes through the import path, which reads the gravity-map sections and ignores the leftover composition. `kind` is demoted to an **advisory** self-description (useful for sharing-site categorization, and as a fallback when there's no meaningful extension — e.g. drag-dropped raw JSON). On extension/`kind` mismatch after a rename, **extension wins**; optional power-user touch: a `.glisskit` that contains a full composition can prompt "import settings only, or open the whole piece?". (The earlier "empty composition clobbers current work" trap is avoided by routing on the verb, not on emptiness.) **→ BACKLOG 12.2.**

**For shareable, portable files:**
- **Embed** presets self-contained in a shared piece (keep an optional `id`/`name` label so a known preset is still recognized) — don't reference-by-name only.
- Store **tuning as explicit cents/ratios + reference pitch**, not just a preset name, so it survives even if built-in presets change.

**Author metadata (`meta`, all optional):**
- title, author, contact/URL, description, tags, **license** (CC0 / CC-BY / all-rights-reserved), createdAt/modifiedAt, generator/appVersion.
- Separate top-level object so a gallery can read title/author cheaply without parsing the whole piece.
- **Opt-in only**; never auto-stamp identifying info (machine IDs, file paths) — these files are meant to be shared publicly.

**Cross-medium tie-in:** the `tuning` + `snap` sections *are* the gravity-well map the hardware and the VST/VCV port consume. A shared preset pack is therefore a shareable **feel**, not just settings — the same data the motorized fader renders as force. **Keep the preset schema and the hardware protocol as one thing** (see the protocol open question under Hardware).

**Browser reality:** in-browser, `.gliss` is a download-with-extension convention + accepting it in the picker. True double-click-to-open needs a PWA + the **File Handling API** (Chromium — already the Web Serial target).

### Cross-runtime portability (browser ↔ VST ↔ VCV)

**Goal:** one `.gliss` made in any runtime opens faithfully in the others.

**The architecture already buys most of this.** Continuous pitch (stored as **cents-from-reference**, host-independent — ✅ shipped), **musical time** (beats/bars, not seconds — ✅ shipped), and **tuning as explicit cents/ratios** all mean the same thing in every host. Each runtime just renders the same canonical data to its own output: browser → audio, VST → MPE pitch, VCV → pitch CV.

**What can't be shared, and why:** the browser synthesizes sound; the VST and VCV don't (they're generators driving downstream synths). So **timbre/voice settings are browser-only.** The shared contract is gesture + gravity map + structure, never the sound source.

**Two-tier schema:**
- **Guaranteed-portable core (identical meaning everywhere):** `meta`, `tuning`, `snap` (gravity map), structure (`tracks`, `loops`, `bpm` in beats), and the **canonical continuous pitch + dynamics curves** (what was actually heard).
- **Host-specific blocks (advisory, namespaced, ignorable):** `hostSettings: { browser: {voice/synth}, vst: {MPE bend range, channels}, vcv: {patch hints} }`. Each runtime reads its own, ignores the rest.

**The rule that makes interchange work — round-trip preservation:** opening a file and re-saving it **must preserve unknown sections verbatim** (VCV must not strip the browser's synth settings on save). Without this, files degrade every time they change hands.
- **Gap found in code (2026-07-19):** unknown keys nested inside `composition` survive a load→save cycle (and `Lane.gravity` round-trips verbatim by design), but unknown **top-level envelope sections** are dropped — `serializeComposition` rebuilds the envelope from a fixed key set. **→ BACKLOG 12.3.**

**Store canonical heard-pitch as ground truth:** the post-snap continuous curve, so playback is identical everywhere; keep raw pre-snap gesture + snap config as editable extras. Tuning/snap then drive editing and hardware feel, not playback reproduction.

**One spec, ideally one codec — not three parsers.** `formatVersion` is now a **cross-app contract**; all three must agree and ship migrations. VST + VCV are both C++ → share a codec library; browser matches the spec or reuses the core via WASM. Three independent parsers will drift.

**Graceful degradation:** heavy layering can exceed MPE's ~15 / VCV's 16 channels; timbre won't survive into a generator host. Define the portable core as the *guarantee*; everything else is best-effort, and each host should report what it couldn't represent.

**Tie-in:** the portable core *is* the hardware protocol payload — continuous pitch + the tuning/snap gravity map. Keep the file's core and the hardware protocol as one representation.

**Open questions:**
- [x] `.glisskit` for preset packs — **decided: yes** (dedicated sharing). Same schema as `.gliss`; extension picks the default verb (open vs. import); see *Presets: one schema, two extensions, two verbs* above. **→ BACKLOG 12.2.**
- [x] Canonical pitch units — **decided and shipped: cents relative to a fixed physical reference** (log scale: 100 ¢ = semitone, 1200 ¢ = octave). Perceptually linear, so a smooth glide is a straight line and interpolation / vibrato width / snap distances behave musically; fully microtonal; escapes MIDI's grid. Derive **Hz** for synthesis (`f = referenceHz · 2^(¢/1200)`) and **note + bend** for MIDI as output-only conversions. Two distinct references, kept separate:
  - **storage anchor** (`referenceHz`): **frozen at C-1 / MIDI note 0 ≈ 8.1758 Hz** — 0 ¢ ≡ 8.1758 Hz, always. C-based to match convention (MIDI's own zero; octave multiples land on Cs). This constant never changes, even when concert pitch is edited; it is purely the zero of the number line. Bonuses: **¢ ÷ 100 = MIDI note number** (12-TET), making MIDI export near-trivial, and every audible pitch is a *positive* cents value. Concert A4 = 440 sits at 6900 ¢. *(Shipped: composition v4, `src/constants.ts`.)*
  - **musical reference** (concert A4 = 440 / 442 / 415…) + temperament: editable, lives in `tuning`, and **rides on top** of the canon; moves snap targets and note labels but **not** the recorded curve (consistent with storing heard-pitch as ground truth). *(Partially shipped: Tune A4 / `tuningOffsetCents`, 8.27; temperament storage not yet.)*
  - Frequency **ratios** stay in `tuning` / `snap` for gravity-well definitions (Scala-style cents/ratios), not for the continuous curve.
  - Fallback if trivial MIDI export is prioritized over purity: fractional-MIDI-semitones — same math, MIDI-flavored zero.
- [ ] Shared C++ codec for VST+VCV with a WASM build for the browser, or a language-neutral spec each implements independently?

---

### Capture resolution & raw-take retention — → BACKLOG 12.4 (own planning session, after 9.3)

**Today:** gestures are stored as low-res **Bezier curves** (editable, compact) — this stays the default working/edit representation. Performance/record captures a much higher-res sample stream that is currently fitted to a Bezier (RDP simplification in `curveFromRecording`), then the raw cache is dumped.

**The question:** keep the raw high-res capture instead of dumping it.

**Frame — RAW vs. JPEG.** Bezier = the editable, lossy "JPEG"; raw capture = the "negative." Keeping raw preserves expressive micro-detail (vibrato texture, human timing) that curve-fitting smooths away — worth it for an instrument whose whole point is continuous expression. Also enables re-fitting later at a different smoothing, high-fidelity MIDI/MPE export, and full-nuance motorized-fader playback. Consistent with the earlier "store canonical heard-pitch as ground truth" decision: raw is the truest heard pitch; the Bezier is a derived view.

**Size (rough):**
- Raw, lean JSON (pitch + dynamics) @ ~60 Hz ≈ **~1 KB/s per voice**; binary int16 ≈ ~0.25 KB/s.
- A ~3-min, ~6-voice piece ≈ **~1 MB raw** vs **tens of KB** Bezier-only → roughly **10–30× bigger**.
- **Capture rate is the lever:** the haptic loop runs at hundreds of Hz, but storing at **100–200 Hz** captures all musical nuance (vibrato ~5–8 Hz). Downsample on save to cap growth.
- **Compression:** pitch streams are smooth/autocorrelated → **delta-encode + gzip ≈ 5–10×** smaller. The ~1 MB → a few hundred KB; a small multiple of the Bezier, trivial vs. audio.

**Save architecture:**
- **Not fundamentally different at first** — can inline compressed raw arrays in the same JSON.
- **Endpoint:** a **container** `.gliss` (zip-style: JSON manifest with beziers / tuning / meta + separate compressed raw-take blobs, lazy-loaded). Standard "metadata + heavy assets" pattern (Ableton / Sketch / Office); a structurally different save model, but well-trodden and **deferrable until sizes justify it**.
- Lazy-load raw only when re-fitting/inspecting, to keep browser RAM sane.

**Open decisions — inputs to the 12.4 planning session:**
- [ ] Authority policy: raw = immutable **original take** (provenance + re-fit source); edited Bezier = working version, **wins for playback** once edited.
- [ ] Retention: keep raw only for **committed / "kept" takes**, discard scratch?
- [ ] Persist rate (100–200 Hz?) + stream encoding (delta + fixed-point + gzip).
- [ ] Inline-compressed arrays now vs. move to a zip container.
- [ ] Raw take pre- or post-snap? (loose end #8 — reconcile with "heard-pitch as ground truth.")

---

## Cross-cutting loose ends (audit)

Gaps surfaced in review, not yet captured above, roughly by load-bearing-ness:

1. **Dynamics axis — direction set. → BACKLOG Phase 11.** A mouse has no spare continuous axis, so the fix is a second continuous *channel* feeding one shared **dynamics bus**: a single normalized value that (a) drives synth amplitude live and (b) is recorded into the *currently-recording voice's* dynamics curve. Build the bus once; every input is then a thin adapter. Per-voice (each layer shapes its own swell on capture), not global. *(Code note: recorded volume is currently hardcoded `0.8`, and live MIDI velocity is discarded — the bus replaces both.)*
   **Inputs (all lightweight once the bus exists):**
   - **Key-held swell** — *build first* (keydown ramps up, keyup decays). Trivial, and it stands up the bus with zero hardware. **Decided. → 11.1.**
   - **MIDI: CC / expression pedal / MPE pressure** — extends existing MIDI input; add CC + channel-pressure handling + **MIDI-learn** so any controller/pedal maps. Prototype now with the Keylab mod-wheel/fader; keep optional, never a prerequisite. **Decided. → 11.2.**
   - **Pen pressure + tilt** — read from **Pointer Events** (the canvas is on legacy mouse events today, so this includes the pointer-events migration). Capture tilt now even if its use (vibrato/timbre) is decided later. Detect pen-vs-mouse + adjustable sensitivity curve. **Add (lightweight). → 11.3.**
   - **Gamepad analog trigger/stick** — poll the **Gamepad API** in the existing frame loop; add a "pick your control" step for mapping variance. **Add (lightweight–moderate). → 11.4.**
   - Per-point volume editing stays as the **refinement layer**; ADSR = automatic note-shaping, not performed dynamics.
   **Build order:** key-held swell (stands up the bus) → pen + MIDI (extend what exists) → gamepad.
   **Platform:** Pointer Events + Gamepad API everywhere; Web MIDI = Chromium + Firefox, not Safari (matches the Chromium-leaning prototype / Web Serial).
2. **Snap-target composition. → BACKLOG 12.1 (design session).** Three gravity sources (fixed scale, JI targets, snap-to-sounding-harmony) + editable temperament on top — how they combine into one target set is unspecified. E.g. snapping to the ringing bed: current temperament or pure JI against the drone? This logic is the core of the magnetic-snap feel. *(Code note: today Prism projection targets replace all others; guides are additive; scale vs. chromatic are mutually exclusive.)*
3. **Whole-composition portability to timeline-less hosts.** Transport is clean for gestures/presets but soft for a full arranged piece (VST under host timeline; VCV has no song timeline). Be explicit that portability is strongest at the preset/gesture layer; "play this whole timed piece in a modular patch" needs a clock/playback story.
4. **Undo scope. Resolved (2026-07-19): one stack, semantic key** — each kept pass is one undo entry; "undo last layer" is a targeted undo of the most recent kept pass. No mode-dependent undo. Recorded in BACKLOG 9.3 + 10.4.
5. **Free-jam clock tempo. Resolved (2026-07-19): composition BPM** (persisted, editable in Transport); tap-tempo later if wanted.
6. **Layer → voice mapping on export.** How stacked layers map to MPE channels / CV outs / downstream voices in a generator host (connects to the ~15/16-channel degradation note).
7. **Software license.** Is the free app open-source? VCV Rack's ecosystem leans GPLv3 — the choice ripples into the VCV port and the shared-codec idea.
8. **Raw take pre- or post-snap?** Store as-felt (post-snap) + snap config, or pre-snap + snap config to re-derive? Reconcile with "store heard-pitch as ground truth." **Input to the 12.4 session.**

---

## Parameter lanes (automation model) — LANDED (data model)

**Shipped** in the cents + lanes refactor (composition v4, PR #60): every curve is `lanes: Lane[]` with pitch as `lanes[0]`; generic per-lane schema `{ type, unit, range, points, gravity? }`; pitch in cents; volume as an independent lane; `gravity` reserved and round-tripped verbatim. Remaining from this section:

- **Dedicated dynamics-lane UI below the canvas** (graph-editor view, contextual display, show/hide/solo per variable) — still open, tracked as **BACKLOG 8.4** (its design session inherits this section).
- **Functional-curve constraint** (one value per X, auto-clamped tangents) — holds in the model via monotonic-X clamping.
- **North Star generalizes:** every lane = a continuous field with its **own optional gravity wells**; magnetic snap becomes **lane-agnostic** (the `gravity` field is the hook).
- **Export/hardware:** each lane is a natural output dimension (MPE pitch / pressure / slide, a CC, or a CV out) and a candidate **future physical control**.

---

## VCV Rack integration (approach) — THINKING

User is a VCV beginner; found Rack as an open-source tone-synth source to use "off-label" as the downstream voice. Vision: a Glissandograph module containing the canvas; CV out per pitch track + per dynamic variable; monophonic tracks with a count limit; play live to drive a user-patched voice, or play back a composition for recording; short comps inside looping patches.

**Verdict: feasible, and it fits VCV's grain better than "off-label" implies** — a CV-source module driving voice modules *is* the modular paradigm. "No timeline" is a convention, not a restriction; a module may run its own internal playhead.

**Mapping to VCV mechanics:**
- **Canvas:** custom interactive widget via Rack's NanoVG drawing + mouse handling. Fixed 3U-tall panel, chosen width → more cramped than a browser; editable canvas is doable.
- **Timeline:** internal playhead advances in the per-sample `process()` loop (elapsed time × rate); reading each curve at the playhead yields output. Self-contained timeline.
- **CV outputs = lanes, 1:1.** Each lane is a continuous value over time = a CV signal. Pitch → **1V/oct**; each variable lane → its own voltage. Cents→volts one-liner: `V = (cents − 6000)/1200`, 0 V = middle C (Rack convention) — the C-1 cents anchor paying off again.
- **Gate per track:** normal voices need pitch **+ gate** to trigger envelopes; emit a gate high while a track sounds (e.g., dynamics above a floor). Makes "patch a normal voice and play it" work.
- **Clock/reset I/O:** slave to or drive the patch clock → short comps become part of looping patches; good modular citizen.

**Many tracks / monophonic / limit:** use **polyphony** — a poly cable carries up to **16 channels**, so one *poly* pitch out (channel per track), one poly out per variable, one poly gate, instead of dozens of jacks. **16 = natural track ceiling**, consistent with MPE's ~16. (Discrete per-track jacks optional: better repatching, busier panel.)

**Cost & scoping:**
- Heavy lift = rebuilding the canvas UI in **C++/NanoVG**. The **engine** (curves, playhead, snap, cents→CV) is the **shared C++** reused across VST + VCV; the interaction layer is bespoke per host.
- **Decided: player/performer scope** (reduced editing). The module loads full compositions authored in the richer browser app; playback + live jam + a *reduced* editing set, not full parity. Browser app stays the primary editor. Shrinks the build, suits the cramped 3U panel.
  - **Editing line (principle):** include **performance-adjacent** edits (track mute/solo/select, loop region, snap strength + tuning, curve nudge/scale, light dynamics tweaks); exclude **authoring** (from-scratch composition, heavy multi-track drawing) — that stays in the app.
  - **Generalizes to the VST:** same logic (bespoke UI, lives under a host timeline, generator role) → both plugins are **players/performers; the browser app is the studio.** Also part of the answer to the "whole-composition portability to timeline-less hosts" loose end — plugins *play* authored `.gliss`, they don't have to *edit* everywhere.

**Smaller notes:**
- UI-thread editing vs. audio-thread CV reads → thread-safe handoff (standard Rack concern, manageable).
- Likely an **open-source GPL** plugin — fits free-software / paid-hardware (ties to the software-license loose end). Verify specifics against the current Rack SDK when building.

---

## Features not yet discussed — parking lot

> Add new ideas here as they surface. Keep them rough; this is a holding area, not a spec.

- _(to be added)_

---

## Build readiness checklist

Implementation may begin on the transferred items (BACKLOG Phases 10–12) once each item's own planning session (where marked) is done:
- [x] Open questions above resolved or explicitly deferred *(2026-07-19: interview — remaining ones assigned to per-item planning sessions or the THINKING sections)*.
- [x] Parking-lot features triaged (parking lot currently empty).
- [x] Broken into sequenced, sized items and moved to `BACKLOG.md` *(Phases 10–12; hardware / VST / VCV / business sections intentionally not transferred — still THINKING)*.
- [x] A dedicated build plan exists for the first item (10.1) — [.claude/plans/10.1-free-running-jam-clock.md](.claude/plans/10.1-free-running-jam-clock.md) (2026-07-19). **Build may begin with 10.1.**
