// Generate fixtures/bend-*.mid — small Standard MIDI Files exercising the
// pitch-bend import path (BACKLOG 8.24) with a few varied gestures.
//
// Usage: node scripts/generate-bend-fixtures.mjs
//
// Files produced (in fixtures/):
//   - bend-vibrato.mid       Sustained C with ~5 Hz, ±50 cent vibrato (sine LFO)
//   - bend-slide-up.mid      Held C linearly bent up by 2 semitones over the note
//   - bend-curl.mid          Guitar-style: hold, bend up 2 semis, hold, release
//   - bend-rpn-12.mid        RPN 0/0 = 12; full-positive bend → +1 octave
//
// All files use ticksPerBeat=480, 4/4, 120 BPM. Notes are on channel 0. MIDI
// pitchBend is signed 14-bit (-8192..+8191); +8192 overflows back to -8192.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMidi } from 'midi-file';

const TPB = 480;

function toBuffer(events) {
  const data = {
    header: { format: 1, numTracks: 1, ticksPerBeat: TPB },
    tracks: [events],
  };
  return Buffer.from(writeMidi(data));
}

// Build a single track from absolute-tick events. Sorts by tick (stable) and
// converts to deltaTime, appending an endOfTrack meta event.
function track(absEvents) {
  const sorted = [...absEvents].sort((a, b) => a.tick - b.tick);
  const out = [];
  let prev = 0;
  for (const e of sorted) {
    const { tick, ...rest } = e;
    out.push({ ...rest, deltaTime: tick - prev });
    prev = tick;
  }
  out.push({ deltaTime: 0, type: 'endOfTrack', meta: true });
  return out;
}

const tempo = (microsecondsPerBeat) => ({
  tick: 0,
  type: 'setTempo',
  meta: true,
  microsecondsPerBeat,
});

// ── 1. Vibrato ────────────────────────────────────────────────────────────────
// 4-beat held note with a continuous sine vibrato at 5 Hz, depth ±50 cents.
// At ±2 semitone bend range, ±50 cents = bend amplitude of 8192 * (0.5/2) = 2048.
function makeVibrato() {
  const events = [tempo(500_000)]; // 120 BPM
  events.push({ tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 });
  // 4 beats at 120 BPM = 2 sec. 5 Hz over 2 sec = 10 cycles. Sample 32 points / cycle.
  const totalTicks = TPB * 4;
  const steps = 320;
  const cyclesPerBeat = 5 / 2; // 5 Hz / (2 beats/sec at 120 BPM)
  const amplitude = 2048;
  for (let i = 0; i <= steps; i++) {
    const tick = Math.round((i / steps) * totalTicks);
    const phase = (i / steps) * (totalTicks / TPB) * cyclesPerBeat * 2 * Math.PI;
    const value = Math.round(Math.sin(phase) * amplitude);
    events.push({ tick, type: 'pitchBend', channel: 0, value });
  }
  events.push({ tick: totalTicks, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 });
  return toBuffer(track(events));
}

// ── 2. Slide up ───────────────────────────────────────────────────────────────
// Held C, bend ramps linearly from 0 to +8191 over 4 beats (= +2 semitones, so
// the note slides C → D over its duration).
function makeSlideUp() {
  const events = [tempo(500_000)];
  events.push({ tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 });
  const totalTicks = TPB * 4;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const tick = Math.round((i / steps) * totalTicks);
    const value = Math.round((i / steps) * 8191);
    events.push({ tick, type: 'pitchBend', channel: 0, value });
  }
  // Place noteOff one tick after the last bend so the bend is part of the curve.
  events.push({ tick: totalTicks + 1, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 });
  return toBuffer(track(events));
}

// ── 3. Bend curl (guitar style) ────────────────────────────────────────────────
// Hold C briefly, ramp up 2 semis over a beat, sustain at top for 2 beats, ramp
// back down over a beat. 4 beats total.
function makeCurl() {
  const events = [tempo(500_000)];
  events.push({ tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 });
  // Phase 1: flat at 0 for half a beat
  events.push({ tick: 0, type: 'pitchBend', channel: 0, value: 0 });
  // Phase 2: ramp up over 1 beat (TPB/2 .. 3*TPB/2)
  const rampUpStart = Math.round(TPB / 2);
  const rampUpEnd = Math.round((3 * TPB) / 2);
  const rampSteps = 24;
  for (let i = 1; i <= rampSteps; i++) {
    const tick = rampUpStart + Math.round((i / rampSteps) * (rampUpEnd - rampUpStart));
    const value = Math.round((i / rampSteps) * 8191);
    events.push({ tick, type: 'pitchBend', channel: 0, value });
  }
  // Phase 3: hold at +8191 for 2 beats (3*TPB/2 .. 7*TPB/2)
  // Phase 4: ramp down over 1 beat (7*TPB/2 .. 9*TPB/2)
  const rampDownStart = Math.round((7 * TPB) / 2);
  const rampDownEnd = Math.round((9 * TPB) / 2);
  for (let i = 1; i <= rampSteps; i++) {
    const tick = rampDownStart + Math.round((i / rampSteps) * (rampDownEnd - rampDownStart));
    const value = Math.round((1 - i / rampSteps) * 8191);
    events.push({ tick, type: 'pitchBend', channel: 0, value });
  }
  // noteOff one tick after final bend so it's part of the curve, not hygiene
  events.push({ tick: rampDownEnd + 1, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 });
  return toBuffer(track(events));
}

// ── 4. RPN ±12 (guitar bend range) ────────────────────────────────────────────
// Sets RPN 0/0 = 12 semitones, then full-positive bend on a held C → +1 octave.
function makeRpn12() {
  const events = [tempo(500_000)];
  // Set bend range to ±12 via RPN 0/0
  events.push({ tick: 0, type: 'controller', channel: 0, controllerType: 101, value: 0 });
  events.push({ tick: 0, type: 'controller', channel: 0, controllerType: 100, value: 0 });
  events.push({ tick: 0, type: 'controller', channel: 0, controllerType: 6, value: 12 });
  // Lock RPN selector (NULL RPN = 127/127) so further data-entry doesn't leak
  events.push({ tick: 0, type: 'controller', channel: 0, controllerType: 101, value: 127 });
  events.push({ tick: 0, type: 'controller', channel: 0, controllerType: 100, value: 127 });
  // Held C with bend ramping 0 → +8191 over 4 beats → 0 → +12 semitones (octave)
  events.push({ tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 });
  const totalTicks = TPB * 4;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const tick = Math.round((i / steps) * totalTicks);
    const value = Math.round((i / steps) * 8191);
    events.push({ tick, type: 'pitchBend', channel: 0, value });
  }
  events.push({ tick: totalTicks + 1, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 });
  return toBuffer(track(events));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../fixtures');
mkdirSync(outDir, { recursive: true });

const files = {
  'bend-vibrato.mid': makeVibrato(),
  'bend-slide-up.mid': makeSlideUp(),
  'bend-curl.mid': makeCurl(),
  'bend-rpn-12.mid': makeRpn12(),
};

for (const [name, buf] of Object.entries(files)) {
  const path = resolve(outDir, name);
  writeFileSync(path, buf);
  console.log(`Wrote ${path} (${buf.length} bytes)`);
}
