import { describe, it, expect } from 'vitest';
import { writeMidi } from 'midi-file';
import type { MidiData } from 'midi-file';
import { midiToComposition } from './midi-import';
import { pitchPoints } from '../model/curve';

const TPB = 480;

function toBuffer(numbers: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(numbers.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < numbers.length; i++) view[i] = numbers[i]!;
  return buf;
}

function buildMidi(events: Array<Array<unknown>>): ArrayBuffer {
  const data: MidiData = {
    header: { format: 1, numTracks: events.length, ticksPerBeat: TPB },
    tracks: events as never,
  };
  return toBuffer(writeMidi(data));
}

/** Build a single track with absolute-tick events; converts to deltaTime. */
function track(absEvents: Array<{ tick: number } & Record<string, unknown>>): unknown[] {
  const sorted = [...absEvents].sort((a, b) => a.tick - b.tick);
  const out: unknown[] = [];
  let prev = 0;
  for (const e of sorted) {
    const { tick, ...rest } = e;
    out.push({ ...rest, deltaTime: tick - prev });
    prev = tick;
  }
  out.push({ deltaTime: 0, type: 'endOfTrack', meta: true });
  return out;
}

describe('midiToComposition — pitch bend', () => {
  it('flat note with no bend → 2-point curve at noteNumber', () => {
    const buf = buildMidi([
      track([
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curve = comp.tracks[0]!.curves[0]!;
    expect(pitchPoints(curve)).toHaveLength(2);
    expect(pitchPoints(curve)[0]!.position.y).toBe(60);
    expect(pitchPoints(curve)[1]!.position.y).toBe(60);
  });

  it('half-bend up at note start → curve Y is shifted +1 semitone (default ±2 range)', () => {
    // Bend value +4096 = half of +8192 = +1 semitone with default ±2 range
    const buf = buildMidi([
      track([
        { tick: 0, type: 'pitchBend', channel: 0, value: 4096 },
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curve = comp.tracks[0]!.curves[0]!;
    // Every sample sits at note 61 (60 + 1 semitone), so RDP collapses to 2 points
    expect(pitchPoints(curve).length).toBeGreaterThanOrEqual(2);
    expect(pitchPoints(curve)[0]!.position.y).toBeCloseTo(61, 5);
    expect(pitchPoints(curve)[pitchPoints(curve).length - 1]!.position.y).toBeCloseTo(61, 5);
  });

  it('mid-note bend → multi-point curve covering the bend gesture', () => {
    // Up-slide at the midpoint
    const buf = buildMidi([
      track([
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB / 2, type: 'pitchBend', channel: 0, value: 8191 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curve = comp.tracks[0]!.curves[0]!;
    // Expect at least 3 points: start at 60, midpoint at ~62, end at ~62
    expect(pitchPoints(curve).length).toBeGreaterThanOrEqual(3);
    expect(pitchPoints(curve)[0]!.position.y).toBeCloseTo(60, 5);
    // Last point near +2 semitones (bend ~ +8191 = ~+2 semis at default range)
    const lastY = pitchPoints(curve)[pitchPoints(curve).length - 1]!.position.y;
    expect(lastY).toBeCloseTo(62, 1);
  });

  it('cross-track bend (Type-1: bend on track A, notes on track B, same channel)', () => {
    const buf = buildMidi([
      // Track 0: just bend
      track([
        { tick: TPB / 2, type: 'pitchBend', channel: 0, value: -8192 },
      ]),
      // Track 1: note
      track([
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    // Track index 1 produced the note (track 0 has none). Find the curve.
    const allCurves = comp.tracks.flatMap(t => t.curves);
    expect(allCurves.length).toBe(1);
    const curve = allCurves[0]!;
    // Mid-note bend down to -2 semitones, then end stays at -2
    const lastY = pitchPoints(curve)[pitchPoints(curve).length - 1]!.position.y;
    expect(lastY).toBeCloseTo(58, 1);
  });

  it('RPN 0/0 sets bend range to ±12 semitones (guitar-style)', () => {
    const buf = buildMidi([
      track([
        // RPN 0/0 → range = 12 semitones
        { tick: 0, type: 'controller', channel: 0, controllerType: 101, value: 0 },
        { tick: 0, type: 'controller', channel: 0, controllerType: 100, value: 0 },
        { tick: 0, type: 'controller', channel: 0, controllerType: 6, value: 12 },
        // Half-bend up = +6 semitones with ±12 range
        { tick: 0, type: 'pitchBend', channel: 0, value: 4096 },
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curve = comp.tracks[0]!.curves[0]!;
    expect(pitchPoints(curve)[0]!.position.y).toBeCloseTo(66, 1);
  });

  it('chord on one channel: both notes get the same bend', () => {
    const buf = buildMidi([
      track([
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 64, velocity: 100 },
        { tick: TPB / 2, type: 'pitchBend', channel: 0, value: 8191 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
        { tick: TPB, type: 'noteOff', channel: 0, noteNumber: 64, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curves = comp.tracks[0]!.curves;
    expect(curves).toHaveLength(2);
    // Both curves should end ~+2 semitones above their start note
    const first = curves[0]!;
    const second = curves[1]!;
    const endA = pitchPoints(first)[pitchPoints(first).length - 1]!.position.y;
    const endB = pitchPoints(second)[pitchPoints(second).length - 1]!.position.y;
    const startA = pitchPoints(first)[0]!.position.y;
    const startB = pitchPoints(second)[0]!.position.y;
    expect(endA - startA).toBeCloseTo(2, 1);
    expect(endB - startB).toBeCloseTo(2, 1);
  });

  it('c_twice.mid pattern: centre-reset bend at noteOff tick is ignored (post-release hygiene)', () => {
    // Two notes that should both sound as middle C:
    //   ch0: D (62) with bend=-8192 (range ±2 → -2 semitones) → C
    //   ch1: A# (58) with bend=+8191 (range ±2 → +1.9998 semis) → ~C
    // Each channel has a centre-reset bend (value=0) at the noteOff tick — that
    // reset must NOT be applied to the note's curve. WMP plays this as "C twice".
    // Note: MIDI pitch bend is signed 14-bit, so +8191 is the actual maximum;
    // value=+8192 overflows the encoding back to -8192.
    const buf = buildMidi([
      track([
        // Channel 0
        { tick: 0, type: 'pitchBend', channel: 0, value: -8192 },
        { tick: 0, type: 'noteOn', channel: 0, noteNumber: 62, velocity: 117 },
        { tick: 250, type: 'noteOff', channel: 0, noteNumber: 62, velocity: 0 },
        { tick: 500, type: 'pitchBend', channel: 0, value: 0 },
        // Channel 1
        { tick: 250, type: 'pitchBend', channel: 1, value: 8191 },
        { tick: 250, type: 'noteOn', channel: 1, noteNumber: 58, velocity: 117 },
        { tick: 500, type: 'noteOff', channel: 1, noteNumber: 58, velocity: 0 },
        { tick: 500, type: 'pitchBend', channel: 1, value: 0 }, // centre reset on noteOff tick
      ]),
    ]);
    const comp = midiToComposition(buf);
    const allCurves = comp.tracks.flatMap(t => t.curves);
    expect(allCurves).toHaveLength(2);
    // Both curves should be flat at note 60 (middle C). Tolerance 0.1 covers
    // the 8191/8192 = 0.99988 quantization at max bend (~0.00024 semitone error).
    for (const curve of allCurves) {
      for (const pt of pitchPoints(curve)) {
        expect(pt.position.y).toBeCloseTo(60, 1);
      }
    }
  });

  it('bend before first noteOn does not crash and is applied to that note', () => {
    const buf = buildMidi([
      track([
        { tick: 0, type: 'pitchBend', channel: 0, value: 8191 },
        { tick: TPB, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { tick: TPB * 2, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]),
    ]);
    const comp = midiToComposition(buf);
    const curve = comp.tracks[0]!.curves[0]!;
    expect(pitchPoints(curve)[0]!.position.y).toBeCloseTo(62, 1);
  });
});
