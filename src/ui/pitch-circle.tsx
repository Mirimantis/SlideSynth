import '@preact/signals'; // the circle re-renders when the store fields it reads change
import { store } from '../state/store';
import { CENTS_PER_OCTAVE, CENTS_PER_SEMITONE } from '../constants';
import {
  degreeCents, degreeLabel, degreeName, isTwelveEdo, resolveTuning, scaleSteps,
} from '../tuning/tuning';

/**
 * The pitch circle (BACKLOG 13.8 (c); spec in DESIGN.md › Tuning spec): one
 * period of the tuning around a circle, C at the top.
 * - the tuning's degrees as ticks on the rim, named outside it;
 * - the scale's degrees as filled dots, the root with a ring;
 * - for tunings other than 12-EDO that repeat at the octave, a faint inner
 *   ring of the 12 standard notes, to see how far each degree is from them.
 *
 * Press a degree to hear it (for as long as it's held), double-click to make
 * it the root, Shift+click to add it to or take it out of the scale.
 */

export interface PitchCircleActions {
  /** Sound a pitch (cents) on the current track's tone; null stops it. */
  audition(cents: number | null): void;
  setRoot(degree: number): void;
  toggleScaleDegree(degree: number): void;
}

const SIZE = 216;
const MID = SIZE / 2;
const RIM = 76;
const LABEL_R = 94;
const INNER = 52;
/** Past this many degrees only the root and the natural letters (A–G) are
 *  named on the rim. */
const MAX_NAMED = 24;

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A point on a circle of radius r at `turn` (0 = top, clockwise, 1 = a full turn). */
function at(turn: number, r: number): { x: number; y: number } {
  const a = turn * 2 * Math.PI - Math.PI / 2;
  return { x: MID + r * Math.cos(a), y: MID + r * Math.sin(a) };
}

export function PitchCircle({ actions, scaleName }: { actions: PitchCircleActions; scaleName: string }) {
  const st = store.getState();
  const tuning = resolveTuning(st.tuning);
  const n = tuning.degrees.length;
  const octave = Math.abs(tuning.period - CENTS_PER_OCTAVE) < 1e-6;
  // Octave tunings sit against the standard notes, C at the top; others put degree 0 there.
  const anchor = octave ? st.tunedFrom * CENTS_PER_SEMITONE : 0;
  const turnOf = (d: number) => (((anchor + tuning.degrees[d]!) % tuning.period) + tuning.period) % tuning.period / tuning.period;

  const steps = scaleSteps(st, tuning);
  const inScale = new Set(steps ? steps.map(s => (st.root + s) % n) : tuning.degrees.map((_, i) => i));
  // Dots and hit areas shrink as degrees crowd the rim.
  const spacing = (2 * Math.PI * RIM) / n;
  const dotR = Math.max(2, Math.min(5, spacing * 0.3));
  const hitR = Math.max(dotR + 3, Math.min(12, spacing / 2));

  const release = () => actions.audition(null);

  return (
    <div class="pitch-circle">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="group"
        aria-label={`Pitch circle: ${tuning.name}`}
      >
        <circle class="pitch-circle-rim" cx={MID} cy={MID} r={RIM} />

        {octave && !isTwelveEdo(st.tuning) && (
          <g class="pitch-circle-standard">
            <circle class="pitch-circle-inner" cx={MID} cy={MID} r={INNER} />
            {PITCH_CLASS_NAMES.map((name, pc) => {
              const p = at(pc / 12, INNER);
              const l = at(pc / 12, INNER + 10);
              return (
                <g key={name}>
                  <circle class="pitch-circle-standard-dot" cx={p.x} cy={p.y} r={1.8} />
                  {!name.includes('#') && <text class="pitch-circle-standard-label" x={l.x} y={l.y}>{name}</text>}
                </g>
              );
            })}
          </g>
        )}

        {tuning.degrees.map((cents, d) => {
          const turn = turnOf(d);
          const t0 = at(turn, RIM - 4);
          const t1 = at(turn, RIM + 4);
          const p = at(turn, RIM);
          const l = at(turn, LABEL_R);
          const isRoot = d === st.root;
          const scaled = inScale.has(d);
          const label = degreeLabel(tuning, st.tunedFrom, d);
          const named = n <= MAX_NAMED || isRoot || /^[A-G]$/.test(label);
          return (
            <g
              key={d}
              class={`pitch-circle-degree${scaled ? ' in-scale' : ''}${isRoot ? ' root' : ''}`}
              data-degree={d}
              onPointerDown={e => {
                if (e.button !== 0) return;
                actions.audition(degreeCents(st, d));
                // Keep the release even if the pointer slides off the degree.
                try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not capturable */ }
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onLostPointerCapture={release}
              onClick={e => { if (e.shiftKey) actions.toggleScaleDegree(d); }}
              onDblClick={e => { if (!e.shiftKey) actions.setRoot(d); }}
            >
              <title>{`${degreeName(tuning, st.tunedFrom, d)} · ${cents.toFixed(1)}¢`}</title>
              <line class="pitch-circle-tick" x1={t0.x} y1={t0.y} x2={t1.x} y2={t1.y} />
              {scaled && <circle class="pitch-circle-dot" cx={p.x} cy={p.y} r={dotR} />}
              {isRoot && <circle class="pitch-circle-root" cx={p.x} cy={p.y} r={dotR + 3.5} />}
              {named && <text class="pitch-circle-label" x={l.x} y={l.y}>{label}</text>}
              <circle class="pitch-circle-hit" cx={p.x} cy={p.y} r={hitR} />
            </g>
          );
        })}

        <text class="pitch-circle-center-root" x={MID} y={MID - 6}>{degreeLabel(tuning, st.tunedFrom, st.root)}</text>
        <text class="pitch-circle-center-scale" x={MID} y={MID + 12}>{scaleName}</text>
      </svg>
      <div class="pitch-circle-hint">Press to hear · double-click: root · Shift+click: scale</div>
    </div>
  );
}
