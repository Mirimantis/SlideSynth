/**
 * The playback scheduler's timing math (BACKLOG 15.8), pure so it can be
 * tested without Web Audio: how beats map to audio-clock time while playing,
 * and which automation events fall in one look-ahead window.
 */

import type { BezierCurve } from '../types';
import { sampleCurve, getCurveTimeRange } from './curve-sampler';

/** How long a curve fades in before its start and out after its end, in
 *  seconds, so a note starts and stops without a click. */
export const CURVE_EDGE_FADE_S = 0.005;

/** Where playback started: this audio-clock time is this beat, at this tempo.
 *  The tempo is fixed for a run (a change applies on the next play()). */
export interface PlayClock {
  startAudioTime: number;
  startBeat: number;
  bpm: number;
}

export function beatToAudioTime(clock: PlayClock, beat: number): number {
  return clock.startAudioTime + (beat - clock.startBeat) * (60 / clock.bpm);
}

export function audioTimeToBeat(clock: PlayClock, time: number): number {
  return clock.startBeat + (time - clock.startAudioTime) / (60 / clock.bpm);
}

/** One automation event for a voice: a frequency (absent on a fade) and a
 *  volume, at an audio-clock time. */
export interface VoiceEvent {
  time: number;
  frequency: number | null;
  volume: number;
}

/**
 * A curve's events in the scheduling window `(after, until]` (audio-clock
 * seconds): its samples, then a fade in just before it starts and a fade out
 * just after it ends when those edges fall in the window. The window is
 * open at the start, so back-to-back windows schedule every sample once.
 */
export function curveEventsInWindow(curve: BezierCurve, clock: PlayClock, after: number, until: number): VoiceEvent[] {
  const range = getCurveTimeRange(curve);
  if (!range) return [];
  const fromBeat = audioTimeToBeat(clock, after);
  const toBeat = audioTimeToBeat(clock, until);
  if (range.end < fromBeat || range.start > toBeat) return [];

  const events: VoiceEvent[] = [];
  const beatsToSec = 60 / clock.bpm;
  for (const sample of sampleCurve(curve, clock.bpm, fromBeat, toBeat)) {
    // Sample times are seconds from beat 0.
    const time = clock.startAudioTime + (sample.timeSeconds - clock.startBeat * beatsToSec);
    if (time <= after || time > until) continue;
    events.push({ time, frequency: sample.frequency, volume: sample.volume });
  }

  const startTime = beatToAudioTime(clock, range.start);
  const endTime = beatToAudioTime(clock, range.end);
  if (startTime > after && startTime <= until) {
    events.push({ time: startTime - CURVE_EDGE_FADE_S, frequency: null, volume: 0 });
  }
  if (endTime > after && endTime <= until) {
    events.push({ time: endTime + CURVE_EDGE_FADE_S, frequency: null, volume: 0 });
  }
  return events;
}
