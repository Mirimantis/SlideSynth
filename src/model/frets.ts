import type { GuideDefinition } from '../types';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';

/**
 * Frets (Y guides) and octave frets (BACKLOG 13.18).
 *
 * A fret with `repeat: 'octave'` sounds in every period of the tuning: the
 * octave, or the tuning's repeat when it isn't octave-based. Its lines are
 * one fret: `position` is the pitch it was placed at, and line `k` sits `k`
 * periods above it (below for negative k). Snapping, drawing and hit-testing
 * all read the lines from here, so they agree.
 */

/** One line of a fret: `k` periods from the placed pitch. */
export interface FretLine {
  k: number;
  cents: number;
}

export const repeats = (g: GuideDefinition): boolean => g.orientation === 'y' && g.repeat === 'octave';

/** The guides on show, which are also the ones that pull and can be picked:
 *  none with Guides off (the Snap drawer), and no frets with Frets off (the
 *  Tuning drawer, 13.22). Beat guides don't follow Frets. */
export function shownGuides(st: {
  guidesVisible: boolean; fretsVisible: boolean; composition: { guides: readonly GuideDefinition[] };
}): readonly GuideDefinition[] {
  if (!st.guidesVisible) return [];
  return st.fretsVisible ? st.composition.guides : st.composition.guides.filter(g => g.orientation === 'x');
}

/** A fret's lines within the pitch range: just its pitch, or with Octaves
 *  every period above and below it. */
export function fretLines(g: GuideDefinition, period: number): FretLine[] {
  if (!repeats(g) || !(period > 0)) return [{ k: 0, cents: g.position }];
  const lines: FretLine[] = [];
  const first = Math.ceil((MIN_PITCH_CENTS - g.position) / period - 1e-9);
  const last = Math.floor((MAX_PITCH_CENTS - g.position) / period + 1e-9);
  for (let k = first; k <= last; k++) lines.push({ k, cents: g.position + k * period });
  return lines;
}

/** The pitch of line `k` (the placed pitch for a single fret). */
export function fretLinePitch(g: GuideDefinition, k: number, period: number): number {
  return repeats(g) ? g.position + k * period : g.position;
}

/** Move line `k` of a fret to `cents`, moving every line by the same
 *  interval. Returns the new placed pitch, and the dragged line's new `k`:
 *  if the move would take the placed pitch off the pitch range, it's folded
 *  back in by whole periods, and `k` follows so the dragged line stays put. */
export function moveFretLine(g: GuideDefinition, k: number, cents: number, period: number): { position: number; k: number } {
  if (!repeats(g) || !(period > 0)) return { position: cents, k: 0 };
  let position = cents - k * period;
  let line = k;
  while (position < MIN_PITCH_CENTS) { position += period; line -= 1; }
  while (position > MAX_PITCH_CENTS) { position -= period; line += 1; }
  return { position, k: line };
}
