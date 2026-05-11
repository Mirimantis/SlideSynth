import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';
import type { BezierCurve, Composition } from '../types';
import {
  createCurve,
  createControlPoint,
  addPointToCurve,
  curveFromRecording,
  type RecordedSample,
} from '../model/curve';
import { createTrack } from '../model/track';
import { createDefaultToneLibrary } from '../model/tone';
import { createDefaultSnapSettings } from '../model/composition';
import { MIN_NOTE, MAX_NOTE, DEFAULT_BPM, DEFAULT_BEATS_PER_MEASURE } from '../constants';

/** A paired note event in absolute ticks. */
interface NoteEvent {
  noteNumber: number;
  startTick: number;
  endTick: number;
  velocity: number; // 0–127
}

/** A single pitch-bend event in absolute ticks. value is signed -8192..+8191. */
interface BendPoint {
  tick: number;
  value: number;
}

/** Key for grouping notes into tracks: "trackIndex:channel". */
type TrackChannelKey = string;

const PRESET_TONE_IDS = ['preset-sine', 'preset-square', 'preset-warm-pad', 'preset-buzzy-saw'];

/** Percussion channel (0-indexed: channel 9 = GM percussion). */
const PERCUSSION_CHANNEL = 9;

/** Default pitch-bend range in semitones (GM standard ±2). RPN 0/0 may override per channel. */
const BEND_RANGE_DEFAULT_SEMITONES = 2;

/** Hard cap on points per imported curve — keeps dense vibrato from blowing up scheduler cost. */
const MAX_POINTS_PER_CURVE = 256;

/**
 * Convert a Standard MIDI File (ArrayBuffer) into a Glissandograph Composition.
 *
 * Each MIDI track/channel pair becomes a Glissandograph track.
 * Each note becomes a BezierCurve. Pitch-bend events on the note's channel are
 * folded into the curve as additional control points; notes with no overlapping
 * bend collapse to the same flat 2-point curve the legacy importer produced.
 * Notes outside C2–C7 are discarded. Percussion (channel 10) is skipped.
 *
 * Known limitations: only the first setTempo event is honoured (bend points use
 * that single tempo to convert ticks→beats). Per-channel bend range may change
 * over the course of a file; we use the most recently observed RPN 0/0 setting,
 * defaulting to ±2 semitones.
 */
export function midiToComposition(buffer: ArrayBuffer): Composition {
  const midi = parseMidi(new Uint8Array(buffer));
  const ticksPerBeat = midi.header.ticksPerBeat ?? 480;

  // Extract BPM from first setTempo event (default 120)
  let bpm = DEFAULT_BPM;
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'setTempo') {
        bpm = Math.round(60_000_000 / event.microsecondsPerBeat);
        break;
      }
    }
    if (bpm !== DEFAULT_BPM) break;
  }

  // Pass 1: build per-channel bend timeline + per-channel pitch-bend range
  // (RPN 0/0). Bend in MIDI is per-channel-per-port and on Type-1 files is
  // commonly authored on a different track than the notes, so we walk every
  // track and key by channel.
  const { bendByChannel, bendRangeByChannel } = collectBendTimelines(midi.tracks);

  // Pass 2: pair noteOn/noteOff into NoteEvent[], grouped by (trackIndex, channel)
  const notesByKey = new Map<TrackChannelKey, NoteEvent[]>();
  const trackNames = new Map<TrackChannelKey, string>();

  for (let trackIdx = 0; trackIdx < midi.tracks.length; trackIdx++) {
    const events = midi.tracks[trackIdx]!;
    let tickCursor = 0;

    // Track pending note-ons: Map<"channel:noteNumber", { startTick, velocity }>
    const pendingNotes = new Map<string, { startTick: number; velocity: number }>();

    // Extract track name if present
    let rawTrackName: string | null = null;

    for (const event of events) {
      tickCursor += event.deltaTime;

      if (event.type === 'trackName') {
        rawTrackName = event.text;
        continue;
      }

      // Skip percussion channel
      if (isChannelEvent(event) && event.channel === PERCUSSION_CHANNEL) continue;

      if (event.type === 'noteOn' && event.velocity > 0) {
        // Note-on (velocity 0 is treated as note-off by some MIDI files)
        const pendingKey = `${event.channel}:${event.noteNumber}`;
        pendingNotes.set(pendingKey, { startTick: tickCursor, velocity: event.velocity });
      } else if (
        event.type === 'noteOff' ||
        (event.type === 'noteOn' && event.velocity === 0)
      ) {
        // Note-off
        const channel = event.channel;
        const pendingKey = `${channel}:${event.noteNumber}`;
        const pending = pendingNotes.get(pendingKey);
        if (!pending) continue; // Orphan note-off, skip
        pendingNotes.delete(pendingKey);

        // Skip notes outside our range
        if (event.noteNumber < MIN_NOTE || event.noteNumber > MAX_NOTE) continue;

        // Skip zero-duration notes
        if (tickCursor <= pending.startTick) continue;

        const key: TrackChannelKey = `${trackIdx}:${channel}`;
        if (!notesByKey.has(key)) {
          notesByKey.set(key, []);
        }
        notesByKey.get(key)!.push({
          noteNumber: event.noteNumber,
          startTick: pending.startTick,
          endTick: tickCursor,
          velocity: pending.velocity,
        });

        // Store track name for this key
        if (rawTrackName && !trackNames.has(key)) {
          trackNames.set(key, rawTrackName);
        }
      }
    }
  }

  // Build composition
  const toneLibrary = createDefaultToneLibrary();
  const tracks = [];
  let toneIndex = 0;

  // Sort keys for deterministic track order
  const sortedKeys = Array.from(notesByKey.keys()).sort();

  for (const key of sortedKeys) {
    const notes = notesByKey.get(key)!;
    if (notes.length === 0) continue;

    const channel = parseInt(key.split(':')[1]!, 10);
    const bendRange = bendRangeByChannel.get(channel) ?? BEND_RANGE_DEFAULT_SEMITONES;
    const bendTimeline = bendByChannel.get(channel) ?? [];

    const toneId = PRESET_TONE_IDS[toneIndex % PRESET_TONE_IDS.length]!;
    toneIndex++;

    const name = trackNames.get(key) ?? `Track ${tracks.length + 1}`;
    const track = createTrack(name, toneId);

    for (const note of notes) {
      track.curves.push(noteWithBendToCurve(note, bendTimeline, bendRange, ticksPerBeat));
    }

    tracks.push(track);
  }

  // Length is derived dynamically from the points themselves.

  return {
    version: 2,
    name: 'Imported MIDI',
    bpm,
    beatsPerMeasure: DEFAULT_BEATS_PER_MEASURE,
    timeSignatureDenominator: 4,
    tracks,
    toneLibrary,
    loopStartBeats: 0,
    loopEndBeats: 2 * DEFAULT_BEATS_PER_MEASURE,
    snap: createDefaultSnapSettings(),
    guides: [],
    tuningOffsetCents: 0,
  };
}

/** Type guard: does this event have a `channel` property? */
function isChannelEvent(event: MidiEvent): event is MidiEvent & { channel: number } {
  return 'channel' in event;
}


/**
 * Walk every track once, collecting:
 *   - per-channel bend timeline (sorted by tick, raw -8192..+8191 values)
 *   - per-channel pitch-bend range in semitones, derived from RPN 0/0 control
 *     change sequences (CC 101=0, CC 100=0, then CC 6 = semitones MSB and
 *     optional CC 38 = cents LSB). Channels with no RPN 0/0 stay default ±2.
 */
function collectBendTimelines(tracks: MidiEvent[][]): {
  bendByChannel: Map<number, BendPoint[]>;
  bendRangeByChannel: Map<number, number>;
} {
  const bendByChannel = new Map<number, BendPoint[]>();
  const bendRangeByChannel = new Map<number, number>();
  // Per-channel RPN selector state — null until both bytes have been seen.
  const rpnState = new Map<number, { msb: number | null; lsb: number | null }>();

  for (const track of tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;

      if (event.type === 'pitchBend') {
        if (event.channel === PERCUSSION_CHANNEL) continue;
        let list = bendByChannel.get(event.channel);
        if (!list) {
          list = [];
          bendByChannel.set(event.channel, list);
        }
        list.push({ tick, value: event.value });
        continue;
      }

      if (event.type === 'controller') {
        if (event.channel === PERCUSSION_CHANNEL) continue;
        let st = rpnState.get(event.channel);
        if (!st) {
          st = { msb: null, lsb: null };
          rpnState.set(event.channel, st);
        }
        switch (event.controllerType) {
          case 101: st.msb = event.value; break; // RPN MSB
          case 100: st.lsb = event.value; break; // RPN LSB
          case 6: { // Data Entry MSB — semitones part of bend range when RPN is 0/0
            if (st.msb === 0 && st.lsb === 0) {
              bendRangeByChannel.set(event.channel, event.value);
            }
            break;
          }
          case 38: { // Data Entry LSB — cents part of bend range when RPN is 0/0
            if (st.msb === 0 && st.lsb === 0) {
              const semis = bendRangeByChannel.get(event.channel) ?? BEND_RANGE_DEFAULT_SEMITONES;
              bendRangeByChannel.set(event.channel, Math.floor(semis) + event.value / 100);
            }
            break;
          }
        }
      }
    }
  }

  // Cross-track collection may have interleaved events out of order — sort each list.
  for (const list of bendByChannel.values()) {
    list.sort((a, b) => a.tick - b.tick);
  }

  return { bendByChannel, bendRangeByChannel };
}

/**
 * Build a curve for one note, folding in any pitch-bend events from the
 * channel's timeline that fall within [startTick, endTick]. Bend value is
 * applied as `noteNumber + (bend / 8192) * bendRangeSemitones`. Notes with
 * no overlapping bend collapse to the legacy 2-point flat curve.
 *
 * Bend points are collected as RecordedSamples and run through
 * curveFromRecording() so they share RDP simplification + auto-smooth handle
 * generation with the live-record path. A 256-point cap protects the audio
 * scheduler against pathological dense-vibrato files.
 */
function noteWithBendToCurve(
  note: NoteEvent,
  bendTimeline: BendPoint[],
  bendRangeSemitones: number,
  ticksPerBeat: number,
): BezierCurve {
  const startBeat = note.startTick / ticksPerBeat;
  const endBeat = note.endTick / ticksPerBeat;
  const volume = note.velocity / 127;

  // Find the bend value active at startTick (latest event with tick <= startTick).
  // After the loop, `i` indexes the first event strictly after startTick.
  let bendAtStart = 0;
  let i = 0;
  for (; i < bendTimeline.length; i++) {
    if (bendTimeline[i]!.tick > note.startTick) break;
    bendAtStart = bendTimeline[i]!.value;
  }

  // Collect bend events in (startTick, endTick) — open at both ends. A bend at
  // exactly the noteOff tick is conventionally MIDI hygiene for the next note
  // ("return wheel to centre") rather than musical intent for this note; WMP
  // and other players ignore it. If we honoured it, c_twice.mid (D-2 / A#+2,
  // both with a centre reset coincident with noteOff) would slide back to the
  // unbent pitch on release. Producers wanting a bend ramp during the note put
  // the final bend strictly before noteOff.
  const interior: BendPoint[] = [];
  for (; i < bendTimeline.length; i++) {
    const b = bendTimeline[i]!;
    if (b.tick >= note.endTick) break;
    interior.push(b);
  }

  // Fast path: no bend overlap and starting bend is centred → flat 2-point curve.
  if (interior.length === 0 && bendAtStart === 0) {
    const c = createCurve();
    addPointToCurve(c, createControlPoint(startBeat, note.noteNumber, volume));
    addPointToCurve(c, createControlPoint(endBeat, note.noteNumber, volume));
    return c;
  }

  const bendToY = (bend: number) =>
    note.noteNumber + (bend / 8192) * bendRangeSemitones;

  const samples: RecordedSample[] = [];
  samples.push({ beat: startBeat, note: bendToY(bendAtStart), volume });
  let lastBend = bendAtStart;
  for (const b of interior) {
    samples.push({ beat: b.tick / ticksPerBeat, note: bendToY(b.value), volume });
    lastBend = b.value;
  }
  // Always close at endBeat.
  const tail = samples[samples.length - 1]!;
  if (Math.abs(tail.beat - endBeat) > 1e-6) {
    samples.push({ beat: endBeat, note: bendToY(lastBend), volume });
  }

  const simplified = curveFromRecording(samples, 0.03, 0.15);
  if (!simplified || simplified.points.length < 2) {
    // Bend gesture too short for curveFromRecording's duration filter; emit a
    // direct 2-point curve at the bent endpoints so we don't lose the note.
    const c = createCurve();
    addPointToCurve(c, createControlPoint(startBeat, bendToY(bendAtStart), volume));
    addPointToCurve(c, createControlPoint(endBeat, bendToY(lastBend), volume));
    return c;
  }
  if (simplified.points.length > MAX_POINTS_PER_CURVE) {
    console.warn(
      `[midi-import] Note at beat ${startBeat.toFixed(2)} (note ${note.noteNumber}) ` +
      `produced ${simplified.points.length} bend points; capping at ${MAX_POINTS_PER_CURVE}.`,
    );
    const step = (simplified.points.length - 1) / (MAX_POINTS_PER_CURVE - 1);
    const decimated = [];
    for (let k = 0; k < MAX_POINTS_PER_CURVE; k++) {
      decimated.push(simplified.points[Math.round(k * step)]!);
    }
    simplified.points = decimated;
  }
  return simplified;
}
