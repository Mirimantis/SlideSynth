import { describe, it, expect } from 'vitest';
import {
  snapToGrid, findAdaptiveSnap, nearestSnapLine, getAdaptiveSubdivisions, getAdaptiveBeatStep,
  DEFAULT_SNAP_CONFIG, PITCH_GUIDE_PRIORITY_CENTS, type SnapConfig,
} from './snap';
import { MIN_PITCH_CENTS, MAX_PITCH_CENTS } from '../constants';

// Kernel tests (BACKLOG 15.8): the snap rules every runtime must agree on.

/** A sparse grid (C major's white keys around C5), so gaps differ. */
const C_MAJOR = [6000, 6200, 6400, 6500, 6700, 6900, 7100, 7200];
const config = (over: Partial<SnapConfig> = {}): SnapConfig => ({
  enabled: true, subdivisionsPerBeat: 4, pitchTargets: C_MAJOR, ...over,
});
const snapY = (wy: number, over: Partial<SnapConfig> = {}) => snapToGrid(1, wy, config(over)).wy;
const snapX = (wx: number, over: Partial<SnapConfig> = {}) => snapToGrid(wx, 6000, config(over)).wx;

describe('snapToGrid — X', () => {
  it('passes everything through with Snap off', () => {
    expect(snapToGrid(1.13, 6043, config({ enabled: false }))).toEqual({ wx: 1.13, wy: 6043 });
  });

  it('rounds to the subdivision grid', () => {
    expect(snapX(1.13)).toBeCloseTo(1.25);
    expect(snapX(1.1)).toBeCloseTo(1);
    expect(snapToGrid(1.04, 6000, config({ subdivisionsPerBeat: 16 })).wx).toBeCloseTo(1.0625);
  });

  it('lets a beat guide win when it is nearer than the grid and within a quarter beat', () => {
    expect(snapX(1.15, { guideXTargets: [1.17] })).toBeCloseTo(1.17);
    // The grid line is nearer: it wins.
    expect(snapX(1.24, { guideXTargets: [1.1] })).toBeCloseTo(1.25);
    // Out of the guide's reach.
    expect(snapX(1.6, { guideXTargets: [1.3] })).toBeCloseTo(1.5);
  });

  it('never snaps before beat 0', () => {
    expect(snapX(-0.3)).toBe(0);
  });
});

describe('snapToGrid — Y', () => {
  it('snaps to the nearest note of the pitch grid', () => {
    expect(snapY(6090)).toBe(6000);
    expect(snapY(6110)).toBe(6200);
    expect(snapY(6440)).toBe(6400);
    expect(snapY(6460)).toBe(6500);
  });

  it('clamps to the pitch range before snapping', () => {
    const wide = { pitchTargets: [MIN_PITCH_CENTS, 6000, MAX_PITCH_CENTS] };
    expect(snapY(MIN_PITCH_CENTS - 500, wide)).toBe(MIN_PITCH_CENTS);
    expect(snapY(MAX_PITCH_CENTS + 500, wide)).toBe(MAX_PITCH_CENTS);
  });

  it('lets a pitch-line guide within 50 cents win when it is nearer than the grid', () => {
    expect(snapY(6140, { guideYTargets: [6150] })).toBe(6150);
    // The grid note is nearer.
    expect(snapY(6190, { guideYTargets: [6150] })).toBe(6200);
    // Out of the guide's reach.
    expect(snapY(6080, { guideYTargets: [6150] })).toBe(6000);
  });

  it('floats free with pitch lines hidden, except near a guide', () => {
    expect(snapY(6043, { pitchTargets: null })).toBe(6043);
    expect(snapY(6043, { pitchTargets: null, guideYTargets: [6080] })).toBe(6080);
    expect(snapY(6043, { pitchTargets: null, guideYTargets: [6200] })).toBe(6043);
  });

  it('snaps only to Prism projection echoes while projecting, ignoring grid and guides', () => {
    const projecting = { projectionTargets: [6050, 6730], guideYTargets: [6390] };
    expect(snapY(6300, projecting)).toBe(6050);
    expect(snapY(6600, projecting)).toBe(6730);
  });

  it('lets a pitch guide take over within its reach, even past a nearer grid note', () => {
    const near = { priorityYTargets: [6290], guideYTargets: [6290] };
    expect(snapY(6210, near)).toBe(6290);
    expect(snapY(6290 + PITCH_GUIDE_PRIORITY_CENTS + 20, near)).toBe(6400);
    // Projection still owns the snap.
    expect(snapY(6210, { ...near, projectionTargets: [6000] })).toBe(6000);
  });
});

describe('findAdaptiveSnap — Gravity’s wells', () => {
  it('reaches half way to the next note on the cursor’s side', () => {
    // 6400 → 6500 is a semitone above; 6200 → 6400 a tone below.
    expect(findAdaptiveSnap(6420, config())).toEqual({ target: 6400, radius: 50, captured: true });
    expect(findAdaptiveSnap(6380, config())).toEqual({ target: 6400, radius: 100, captured: true });
  });

  it('caps the reach at 300 cents and says when the cursor is outside it', () => {
    const sparse = config({ pitchTargets: [6000, 7200] });
    expect(findAdaptiveSnap(6100, sparse)).toEqual({ target: 6000, radius: 300, captured: true });
    const lone = config({ pitchTargets: null, guideYTargets: [6000] });
    expect(findAdaptiveSnap(6350, lone)).toEqual({ target: 6000, radius: 300, captured: false });
  });

  it('has no target with pitch lines hidden and nothing near', () => {
    expect(findAdaptiveSnap(6000, config({ pitchTargets: null }))).toEqual({ target: null, radius: 0, captured: false });
  });

  it('treats guides as wells beside the notes', () => {
    expect(findAdaptiveSnap(6060, config({ guideYTargets: [6080] })).target).toBe(6080);
  });
});

describe('nearestSnapLine', () => {
  it('finds the nearest line within range, whether Snap is on or not', () => {
    expect(nearestSnapLine(6180, config(), 30)).toBe(6200);
    expect(nearestSnapLine(6180, config({ enabled: false }), 30)).toBe(6200);
    expect(nearestSnapLine(6100, config(), 30)).toBeNull();
  });
});

describe('zoom-adaptive steps', () => {
  it('coarsens the X snap as you zoom out', () => {
    expect(getAdaptiveSubdivisions(80)).toBe(16);
    expect(getAdaptiveSubdivisions(40)).toBe(2);
    expect(getAdaptiveSubdivisions(10)).toBe(1);
  });

  it('keeps grid lines at least 30 px apart, in whole measures once beats are too close', () => {
    expect(getAdaptiveBeatStep(40, 4)).toBe(1);
    expect(getAdaptiveBeatStep(20, 4)).toBe(4);
    expect(getAdaptiveBeatStep(5, 4)).toBe(8);
    expect(getAdaptiveBeatStep(2, 3)).toBe(24);
  });

  it('defaults to chromatic 12-EDO', () => {
    expect(snapToGrid(0, 6049, DEFAULT_SNAP_CONFIG).wy).toBe(6000);
    expect(snapToGrid(0, 6051, DEFAULT_SNAP_CONFIG).wy).toBe(6100);
  });
});
