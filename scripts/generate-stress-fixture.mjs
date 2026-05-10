// Generate fixtures/stress-test.json — a heavy composition used to push the
// audio engine and watch the Perf HUD react. Deterministic (seeded RNG) so
// regenerations produce byte-identical output.
//
// Usage: node scripts/generate-stress-fixture.mjs
//
// Shape mirrors what `serializeComposition` (src/export/json-export.ts) writes
// at COMPOSITION_VERSION = 2, including the snap/guides additive fields. The
// preset tones inlined below match `PRESET_TONES` in src/constants.ts as of
// authoring; if those drift, regenerate the fixture so the version-2
// migration path doesn't have to fix them up at load time.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRESET_TONES = [
  {
    id: 'preset-sine',
    name: 'Pure Sine',
    color: '#4fc3f7',
    dashPattern: [],
    layers: [{ type: 'sine', gain: 1.0, detune: 0 }],
    distortion: null,
  },
  {
    id: 'preset-square',
    name: 'Bright Square',
    color: '#ff7043',
    dashPattern: [12, 4],
    layers: [{ type: 'square', gain: 0.6, detune: 0 }],
    distortion: null,
  },
  {
    id: 'preset-warm-pad',
    name: 'Warm Pad',
    color: '#ab47bc',
    dashPattern: [6, 3],
    layers: [
      { type: 'sine',     gain: 0.5, detune: 0 },
      { type: 'triangle', gain: 0.3, detune: 7 },
      { type: 'sine',     gain: 0.2, detune: -5 },
    ],
    distortion: null,
  },
  {
    id: 'preset-buzzy-saw',
    name: 'Buzzy Saw',
    color: '#66bb6a',
    dashPattern: [3, 3],
    layers: [
      { type: 'sawtooth', gain: 0.5, detune: 0 },
      { type: 'sawtooth', gain: 0.3, detune: 12 },
    ],
    distortion: { amount: 0.3, oversample: '4x' },
  },
];

// Park–Miller LCG. Deterministic across runs.
let rngState = 42;
const rand = () => {
  rngState = (rngState * 16807) % 2147483647;
  return rngState / 2147483647;
};

const TRACK_PLAN = [
  { name: 'Sine A',   toneId: 'preset-sine',      count: 15 },
  { name: 'Sine B',   toneId: 'preset-sine',      count: 15 },
  { name: 'Square A', toneId: 'preset-square',    count: 15 },
  { name: 'Square B', toneId: 'preset-square',    count: 15 },
  { name: 'Pad A',    toneId: 'preset-warm-pad',  count: 15 },
  { name: 'Pad B',    toneId: 'preset-warm-pad',  count: 15 },
  { name: 'Saw A',    toneId: 'preset-buzzy-saw', count: 15 },
  { name: 'Saw B',    toneId: 'preset-buzzy-saw', count: 15 },
];

const TOTAL_BEATS = 240; // 4 minutes at 120 BPM

function makeCurve(trackIdx, curveIdx, totalCurves) {
  const startBeat = (TOTAL_BEATS / totalCurves) * curveIdx + rand() * 1.0;
  const duration = 4 + rand() * 12; // 4–16 beats
  const baseY = 36 + rand() * 60;   // ~C2..C7
  const numPoints = 4 + Math.floor(rand() * 5); // 4–8
  const points = [];
  for (let p = 0; p < numPoints; p++) {
    const x = startBeat + (duration * p) / (numPoints - 1);
    const y = baseY + (rand() - 0.5) * 14; // ±7 semis wobble
    points.push({
      position: { x, y },
      handleIn:  p === 0              ? null : { x: -0.5, y: 0 },
      handleOut: p === numPoints - 1  ? null : { x:  0.5, y: 0 },
      volume: 0.7 + rand() * 0.3,
    });
  }
  return { id: `t${trackIdx}-c${curveIdx}`, points };
}

const tracks = TRACK_PLAN.map((tp, ti) => ({
  id: `track-${ti}`,
  name: tp.name,
  toneId: tp.toneId,
  curves: Array.from({ length: tp.count }, (_, ci) => makeCurve(ti, ci, tp.count)),
  muted: false,
  solo: false,
  volume: 0.8,
}));

const composition = {
  version: 2,
  name: 'Stress Test (Perf HUD baseline)',
  bpm: 120,
  beatsPerMeasure: 4,
  timeSignatureDenominator: 4,
  tracks,
  toneLibrary: PRESET_TONES,
  loopStartBeats: 0,
  loopEndBeats: 8,
  snap: {
    enabled: true,
    scaleRoot: null,
    scaleId: null,
    hidePitchLines: false,
    magneticEnabled: false,
    magneticStrength: 0.75,
    magneticSpringK: 30,
    magneticDamping: 3,
  },
  guides: [],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'stress-test.json');
writeFileSync(outPath, JSON.stringify(composition, null, 2));

const totalCurves = tracks.reduce((sum, t) => sum + t.curves.length, 0);
console.log(`Wrote ${outPath} (${tracks.length} tracks, ${totalCurves} curves)`);
