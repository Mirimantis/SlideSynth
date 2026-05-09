# MIDI recording: improve discoverability of track-arming

> **Note for execution:** Per saved feedback, this plan file should be moved to
> `<repo>/.claude/plans/midi-arm-discoverability.md` before committing.

## Context

The user finally got their MIDI keyboard set up to do the deferred testing
called out by [BACKLOG.md:159](BACKLOG.md:159) item **8.22**, and discovered a
real UX gap: with a MIDI device connected, pressing keys plays the synth
preview but produces no curves. The cause is that MIDI recording is gated in
[src/main.ts:751](src/main.ts:751) by both `midiArmedTrackId !== null` **and**
`playback.isPlaying()`. They had forgotten to arm a track (which they
themselves shipped in BACKLOG 8.11 / PR #43 some time ago).

The user confirmed this was a workflow gap, not a bug, and chose:

1. **Modal on device select** — when the user picks a MIDI device and no track
   is currently armed, prompt them to pick a track to record into.
2. **First-noteOn toast as safety net** — if a MIDI noteOn arrives while no
   track is armed, show a transient toast pointing them at the "I" arm button.

## Approach

Two small surface additions, both reusing existing patterns:

- New file [src/ui/midi-arm-dialog.ts](src/ui/midi-arm-dialog.ts) — a
  Promise-based modal modeled on [src/ui/preset-save-dialog.ts](src/ui/preset-save-dialog.ts).
- Wire the modal into the existing MIDI device-select handler at
  [src/main.ts:775](src/main.ts:775).
- Wire a once-per-episode toast into the existing MIDI noteOn handler at
  [src/main.ts:727](src/main.ts:727), reusing
  [src/ui/toast.ts](src/ui/toast.ts).

No new state in the store — both surfaces read existing state
(`composition.tracks`, `midiArmedTrackId`, `midiInput.getActiveDeviceId()`).

## Implementation

### 1. New modal: `src/ui/midi-arm-dialog.ts`

Mirror the structure of [src/ui/preset-save-dialog.ts](src/ui/preset-save-dialog.ts).

```ts
export function openMidiArmDialog(opts: {
  tracks: readonly { id: string; name: string; toneId: string; }[];
  toneLibrary: readonly { id: string; color: string; name: string; }[];
}): Promise<{ kind: 'arm-existing'; trackId: string }
            | { kind: 'arm-new' }
            | null>
```

- `kind: 'arm-existing'` — caller arms the picked track.
- `kind: 'arm-new'` — caller routes to the existing add-track flow
  (`openTonePicker` → `createTrack` → arm).
- `null` — Cancel / Escape; nothing armed.

UI:
- Heading: **"Record MIDI into which track?"**
- Body: a vertical list of radio buttons, one per existing track. Each row
  shows the tone color swatch + track name, matching the
  `track-color`/`track-info` markup from
  [src/main.ts:1789](src/main.ts:1789).
- Below the list: a `[+ New track]` button (sets `kind: 'arm-new'`).
- Footer: `[Cancel]` (resolves `null`) and `[Arm]` (resolves
  `kind: 'arm-existing'` with the selected radio).
- Escape dismisses (`null`); Enter triggers Arm.
- If `tracks.length === 0`, hide the radio list and the Arm button — only
  show the `+ New track` button and Cancel.

Reuse existing CSS classes: `modal-overlay`, `modal`, `tb-row`, `tb-actions`,
`tb-btn`, `tb-btn primary`. Use `escapeHtml` / `escapeAttr` helpers (copy
from preset-save-dialog).

### 2. Wire into device-select handler — `src/main.ts:775`

Edit the existing handler:

```ts
midiDeviceSelect.addEventListener('change', async () => {
  const id = midiDeviceSelect.value || null;
  if (id && !midiInput.hasAccess()) { /* ...existing access flow... */ }
  midiInput.setActiveDevice(id);
  midiDeviceSelect.blur();

  // NEW: if a device was just enabled and no track is armed, prompt.
  if (id && store.getState().midiArmedTrackId === null) {
    midiArmHintShown = false; // reset the noteOn-fallback gate (see §3)
    await promptForMidiArm();
  }
});
```

`promptForMidiArm()` is a new helper in main.ts:

```ts
async function promptForMidiArm() {
  const st = store.getState();
  const result = await openMidiArmDialog({
    tracks: st.composition.tracks,
    toneLibrary: st.composition.toneLibrary,
  });
  if (!result) return;
  if (result.kind === 'arm-existing') {
    store.setMidiArmedTrackId(result.trackId);
    return;
  }
  // 'arm-new' — reuse the existing add-track flow (tone picker → create).
  const comp = store.getComposition();
  const btn = document.getElementById('add-track-btn')!;
  const picked = await openTonePicker(comp.toneLibrary, null, btn);
  if (!picked) return;
  history.snapshot();
  const track = createTrack(`Track ${comp.tracks.length + 1}`, picked.id);
  store.mutate(c => { c.tracks.push(track); });
  store.setSelectedTrack(track.id);
  store.setMidiArmedTrackId(track.id);
}
```

(The "arm-new" branch duplicates the body of the existing add-track-btn click
handler at [src/main.ts:1874](src/main.ts:1874)–[src/main.ts:1884](src/main.ts:1884)
plus the new `setMidiArmedTrackId` call. Keep them as parallel implementations
rather than abstracting prematurely — the only shared logic is 5 lines.)

### 3. First-noteOn fallback toast — `src/main.ts:727`

Add a module-level flag near the MIDI block:

```ts
let midiArmHintShown = false;
```

In the noteOn handler, after `preview.startDrawPreview(...)` (line 742) and
before the recording block (line 751), insert:

```ts
if (state.midiArmedTrackId === null && !midiArmHintShown) {
  showToast('MIDI received — arm a track (I) to record', 3500);
  midiArmHintShown = true;
}
```

Reset the flag in two places so the user sees it again next time the situation
recurs:
- In the device-select handler (already shown in §2) — fires when the user
  changes device, including from None to a device.
- In a new tiny store subscription right after the MIDI block:
  ```ts
  store.subscribe((s) => {
    if (s.midiArmedTrackId !== null) midiArmHintShown = true; // suppress while armed
    else midiArmHintShown = false; // re-enable when disarmed
  });
  ```
  Or simpler: just check inside the noteOn handler that the toast hasn't been
  shown in the last N seconds. Pick whichever is cleaner once you read the
  surrounding store.subscribe usage — both achieve the goal.

Import `showToast` from `./ui/toast`.

### 4. Help docs — `help.html`

Add a brief section under the existing recording docs. Two short paragraphs:
- "MIDI input recording: connect a MIDI device via the Transport panel's MIDI
  Input dropdown. You'll be prompted to arm a track. Press Play and hold MIDI
  keys — held notes record as curves on the armed track."
- "If you already had a device connected and didn't arm a track, click the
  **I** button on any track."

### 5. BACKLOG.md update

- Mark **8.22** ([BACKLOG.md:159](BACKLOG.md:159)) checked off (`[ ]` → `[x]`)
  with `*(XS, PR #NN)*` after running the three sub-cases listed there. Per
  saved feedback, this happens in the **same PR** that ships this work.
- No new backlog item needed — this PR fixes the discoverability gap directly.

## Critical files

- New: [src/ui/midi-arm-dialog.ts](src/ui/midi-arm-dialog.ts) — modal helper.
- Edit: [src/main.ts:727](src/main.ts:727)–[src/main.ts:773](src/main.ts:773) — noteOn toast.
- Edit: [src/main.ts:775](src/main.ts:775)–[src/main.ts:789](src/main.ts:789) — device-select modal trigger.
- Edit: [help.html](help.html) — MIDI input recording section.
- Edit: [BACKLOG.md:159](BACKLOG.md:159) — check off 8.22.

## Reused (do not reimplement)

- [src/ui/preset-save-dialog.ts](src/ui/preset-save-dialog.ts) — modal template.
- [src/ui/toast.ts](src/ui/toast.ts) `showToast(msg, ms)` — toast.
- [src/ui/tone-picker.ts](src/ui/tone-picker.ts) `openTonePicker(...)` — picker for the "+ New track" branch.
- [src/model/track.ts](src/model/track.ts) `createTrack(name, toneId)` — track factory.
- [src/state/store.ts](src/state/store.ts) `setMidiArmedTrackId`, `setSelectedTrack`, `mutate` — store actions.
- CSS classes `.modal-overlay`, `.modal`, `.tb-row`, `.tb-actions`, `.tb-btn`, `.tb-btn.primary` — already in [styles/dialogs.css](styles/dialogs.css) (and the toolbar styles).

## Verification

1. **Modal on device-select, no track armed.** With at least one track in the
   composition, pick a MIDI device from the Transport "MIDI Input" dropdown.
   Modal should appear listing tracks. Pick one → modal closes and the "I"
   button on that track shows armed.
2. **Modal "+ New track" branch.** Pick `+ New track` in the modal → tone
   picker appears → pick a tone → new track is added, selected, and armed.
3. **Modal Cancel / Escape.** Cancel or press Esc → no track armed; device
   stays connected.
4. **Empty composition.** With zero tracks, modal shows only the `+ New track`
   button; the radio list and Arm button are hidden.
5. **Noteon toast fallback.** Disarm any armed track. Press a MIDI key. Toast
   appears: "MIDI received — arm a track (I) to record." Press more keys —
   toast does not re-appear. Click an "I" button to arm a track. Disarm again,
   press a key — toast appears again (the suppression flag reset on re-arm).
6. **Recording works.** Arm a track via the modal, press Play, hold a MIDI
   note for ~1 second, release. A curve appears on the armed track at the
   right beat range and pitch. Release while still playing — curve is added
   without stopping playback.
7. **BACKLOG 8.22 sub-cases.** Run all three AFK sub-cases listed at
   [BACKLOG.md:159](BACKLOG.md:159) and verify expected auto-stop behavior.
   Then check off 8.22 in this PR.
8. **Type-check + dev server.** `npm run typecheck` (or equivalent) must pass.
   Start `npm run dev`, exercise the flows above in a real browser tab so the
   Web MIDI permission prompt and device list behave realistically.
