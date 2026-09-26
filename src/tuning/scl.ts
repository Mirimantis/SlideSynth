import { CENTS_PER_OCTAVE } from '../constants';
import {
  ALL_NOTES, CUSTOM_SCALE, degreeLabel, getScale, importedTuningProblem, resolveTuning, scaleSteps,
  type ImportedTuningRef, type PitchSettings,
} from './tuning';

/**
 * Scala .scl files (BACKLOG 13.8 (d); format: https://www.huygens-fokker.org/scala/scl_format.html).
 *
 *   ! comment lines start with "!"
 *   description line (may be empty)
 *   number of notes
 *   one pitch per line, ascending, 1/1 left out; the last one is the period.
 *   A pitch with a "." is cents; otherwise a ratio ("5/4", or "2" for 2/1).
 *   Anything after the pitch on its line is ignored.
 *
 * A file carries no root, reference frequency or note names: those come from
 * the app. The description is untrusted text, only ever shown as text.
 */

/** Longer files aren't tunings anyone meant to load. */
export const MAX_SCL_BYTES = 256 * 1024;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 200;

/** A file the app can't read, with a message for the user. */
export class SclError extends Error {}

interface Pitch {
  cents: number;
  ratio: string | null;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function parseRatio(token: string): { n: number; d: number } | null {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const d = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n <= 0 || d <= 0) return null;
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function parsePitch(line: string, lineNo: number): Pitch {
  const token = line.trim().split(/\s+/)[0] ?? '';
  if (token.includes('.')) {
    const cents = Number(token);
    if (!Number.isFinite(cents)) throw new SclError(`line ${lineNo}: "${clip(token, 20)}" isn't a pitch in cents`);
    return { cents, ratio: null };
  }
  const r = parseRatio(token);
  if (!r) throw new SclError(`line ${lineNo}: "${clip(token, 20)}" isn't a ratio or a pitch in cents`);
  return { cents: CENTS_PER_OCTAVE * Math.log2(r.n / r.d), ratio: `${r.n}/${r.d}` };
}

/** Printable text only, and not too much of it. */
function clip(s: string, max: number): string {
  const clean = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Read a .scl file into a tuning. Throws SclError, with a message for the
 *  user, when the file can't be used. */
export function parseScl(text: string, fileName: string): ImportedTuningRef {
  if (text.length > MAX_SCL_BYTES) throw new SclError('the file is too large to be a tuning');
  const lines = text.split(/\r\n|\r|\n/);
  let i = 0;
  const next = (): { line: string; no: number } | null => {
    while (i < lines.length) {
      const line = lines[i++]!;
      if (!line.trimStart().startsWith('!')) return { line, no: i };
    }
    return null;
  };

  const description = next();
  if (!description) throw new SclError('the file is empty');
  const countLine = next();
  const count = countLine ? Number(countLine.line.trim().split(/\s+/)[0]) : NaN;
  if (!Number.isInteger(count) || count < 1) throw new SclError('the number of notes is missing');

  const pitches: Pitch[] = [];
  while (pitches.length < count) {
    const l = next();
    if (!l) throw new SclError(`it says ${count} notes but has ${pitches.length}`);
    if (l.line.trim() === '') continue;
    pitches.push(parsePitch(l.line, l.no));
  }

  const period = pitches[pitches.length - 1]!;
  if (!(period.cents > 0)) throw new SclError('its last note (the period) must be above 1/1');
  // The notes within one period, with 1/1; the period itself is the repeat.
  // A note outside the period is folded into it (losing its ratio). 1/1 is
  // named as a ratio only if the file names its other notes that way.
  const unison: Pitch = { cents: 0, ratio: pitches.some(p => p.ratio) ? '1/1' : null };
  const notes = [unison, ...pitches.slice(0, -1).map(p => {
    const folded = ((p.cents % period.cents) + period.cents) % period.cents;
    return Math.abs(folded - p.cents) < 1e-9 ? p : { cents: folded, ratio: null };
  })]
    .sort((a, b) => a.cents - b.cents)
    .filter((p, k, all) => k === 0 || p.cents - all[k - 1]!.cents > 1e-6);

  const ref: ImportedTuningRef = {
    kind: 'imported',
    name: clip(fileName.replace(/\.scl$/i, ''), MAX_NAME) || 'Imported',
    description: clip(description.line, MAX_DESCRIPTION),
    degrees: notes.map(p => p.cents),
    period: period.cents,
    ratios: notes.map(p => p.ratio),
    periodRatio: period.ratio,
  };
  const problem = importedTuningProblem(ref);
  if (problem) throw new SclError(problem);
  return ref;
}

// ── Export ──────────────────────────────────────────────────────

function ratioOf(s: string | null | undefined): { n: number; d: number } | null {
  return s ? parseRatio(s) : null;
}

/** a/b × c/d, reduced; null if it outgrows exact integers. */
function multiply(a: { n: number; d: number }, b: { n: number; d: number }): { n: number; d: number } | null {
  const n = a.n * b.n;
  const d = a.d * b.d;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) return null;
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const formatCents = (c: number) => c.toFixed(5);

/** The notes you hear as a .scl file (13.8 (d)): the scale if one is chosen,
 *  else the whole tuning, counted from the root, with the period last. Ratios
 *  where the tuning has them for both notes, cents otherwise. */
export function toScl(s: PitchSettings): { text: string; fileName: string } {
  const tuning = resolveTuning(s.tuning);
  const n = tuning.degrees.length;
  const root = ((s.root % n) + n) % n;
  const steps = scaleSteps(s, tuning) ?? tuning.degrees.map((_, k) => k);
  const scaleName = s.scaleId === ALL_NOTES || steps.length === n ? ''
    : s.scaleId === CUSTOM_SCALE ? 'custom scale' : getScale(s.scaleId)?.name ?? '';
  const rootName = degreeLabel(tuning, s.tunedFrom, root);
  const description = `${tuning.name}, ${[rootName, scaleName].filter(Boolean).join(' ')}`;

  const rootRatio = ratioOf(tuning.ratios?.[root]);
  const periodRatio = ratioOf(tuning.periodRatio);
  const lines = steps.filter(step => step > 0).map(step => {
    const idx = root + step;
    const wraps = Math.floor(idx / n);
    const d = idx % n;
    const cents = tuning.degrees[d]! + wraps * tuning.period - tuning.degrees[root]!;
    // Exact ratio: (degree × period^wraps) / root.
    const degreeRatio = ratioOf(tuning.ratios?.[d]);
    if (degreeRatio && rootRatio && (wraps === 0 || periodRatio)) {
      let r: { n: number; d: number } | null = { n: degreeRatio.n * rootRatio.d, d: degreeRatio.d * rootRatio.n };
      const g = gcd(r.n, r.d);
      r = { n: r.n / g, d: r.d / g };
      for (let w = 0; w < wraps && r; w++) r = multiply(r, periodRatio!);
      if (r && Number.isSafeInteger(r.n) && Number.isSafeInteger(r.d)) return `${r.n}/${r.d}`;
    }
    return formatCents(cents);
  });
  lines.push(tuning.periodRatio ?? formatCents(tuning.period));

  const fileName = `${description.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'tuning'}.scl`;
  const text = [
    `! ${fileName}`,
    '! Exported from Glissandograph: the notes from the root, the period last.',
    '!',
    description,
    ` ${lines.length}`,
    '!',
    ...lines.map(l => ` ${l}`),
    '',
  ].join('\n');
  return { text, fileName };
}
