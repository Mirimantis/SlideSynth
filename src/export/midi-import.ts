import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';
import type { Composition } from '../types';
import { createCurve, createControlPoint, addPointToCurve } from '../model/curve';
import { createTrack } from '../model/track';
import { createDefaultToneLibrary } from '../model/tone';
import { MIN_NOTE, MAX_NOTE, DEFAULT_BPM, DEFAULT_BEATS_PER_MEASURE } from '../constants';

/** A paired note event with start/end in beats. */
interface NoteEvent {
  noteNumber: number;
  startBeat: number;
  endBeat: number;
  velocity: number; // 0–127
}

/** Key for grouping notes into tracks: "trackIndex:channel". */
type TrackChannelKey = string;

const PRESET_TONE_IDS = ['preset-sine', 'preset-square', 'preset-warm-pad', 'preset-buzzy-saw'];

/** Percussion channel (0-indexed: channel 9 = GM percussion). */
const PERCUSSION_CHANNEL = 9;

/**
 * Convert a Standard MIDI File (ArrayBuffer) into a SlideSynth Composition.
 *
 * Each MIDI track/channel pair becomes a SlideSynth track.
 * Each note becomes a flat 2-point BezierCurve at the note's pitch.
 * Notes outside C2–C7 are discarded. Percussion (channel 10) is skipped.
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

  // Group note events by (trackIndex, channel)
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

        const startBeat = pending.startTick / ticksPerBeat;
        const endBeat = tickCursor / ticksPerBeat;

        // Skip zero-duration notes
        if (endBeat <= startBeat) continue;

        const key: TrackChannelKey = `${trackIdx}:${channel}`;
        if (!notesByKey.has(key)) {
          notesByKey.set(key, []);
        }
        notesByKey.get(key)!.push({
          noteNumber: event.noteNumber,
          startBeat,
          endBeat,
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

    const toneId = PRESET_TONE_IDS[toneIndex % PRESET_TONE_IDS.length]!;
    toneIndex++;

    const name = trackNames.get(key) ?? `Track ${tracks.length + 1}`;
    const track = createTrack(name, toneId);

    for (const note of notes) {
      const curve = createCurve();
      const p1 = createControlPoint(note.startBeat, note.noteNumber, note.velocity / 127);
      const p2 = createControlPoint(note.endBeat, note.noteNumber, note.velocity / 127);
      addPointToCurve(curve, p1);
      addPointToCurve(curve, p2);
      track.curves.push(curve);
    }

    tracks.push(track);
  }

  // Length is derived dynamically from the points themselves.

  return {
    version: 1,
    name: 'Imported MIDI',
    bpm,
    beatsPerMeasure: DEFAULT_BEATS_PER_MEASURE,
    tracks,
    toneLibrary,
    loopStartBeats: 0,
    loopEndBeats: 2 * DEFAULT_BEATS_PER_MEASURE,
  };
}

/** Type guard: does this event have a `channel` property? */
function isChannelEvent(event: MidiEvent): event is MidiEvent & { channel: number } {
  return 'channel' in event;
}
