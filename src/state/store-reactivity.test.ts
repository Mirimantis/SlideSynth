import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { effect, watch } from './reactive';
import { createComposition } from '../model/composition';
import { setHtmlIfChanged } from '../utils/dom-helpers';

/** Count how many times `read` is re-run by an effect after creation. */
function countRuns(read: () => unknown): { runs: () => number; dispose: () => void } {
  let n = -1; // the effect's first run happens on creation
  const dispose = effect(() => { read(); n++; });
  return { runs: () => n, dispose };
}

describe('store reactivity (BACKLOG 15.1)', () => {
  beforeEach(() => {
    store.loadComposition(createComposition());
    store.setLoopEnabled(false);
  });

  it('a composition mutation does not notify selection readers', () => {
    const sel = countRuns(() => store.getState().selectedTrackId);
    store.mutate(c => { c.bpm = 97; });
    expect(sel.runs()).toBe(0);
    sel.dispose();
  });

  it('a snap change does not notify composition readers, and vice versa', () => {
    const comp = countRuns(() => store.getComposition().tracks.length);
    const snap = countRuns(() => store.getState().magneticStrength);
    store.setMagneticStrength(0.3);
    expect(comp.runs()).toBe(0);
    expect(snap.runs()).toBe(1);
    store.mutate(() => {});
    expect(snap.runs()).toBe(1);
    expect(comp.runs()).toBe(1);
    comp.dispose();
    snap.dispose();
  });

  it('snap fields are views of composition.snap, not copies', () => {
    store.setMagneticDamping(4);
    expect(store.getComposition().snap.magneticDamping).toBe(4);

    const loaded = createComposition();
    loaded.snap.magneticDamping = 9;
    loaded.snap.enabled = false;
    const seen: number[] = [];
    const dispose = watch(() => store.getState().magneticDamping, v => { seen.push(v); });
    store.loadComposition(loaded);
    expect(store.getState().magneticDamping).toBe(9);
    expect(store.getState().snapEnabled).toBe(false);
    expect(seen).toEqual([4, 9]);
    dispose();
  });

  it('loop state lives in the store', () => {
    const seen: boolean[] = [];
    const dispose = watch(() => store.getState().loopEnabled, v => { seen.push(v); });
    store.setLoopEnabled(true);
    store.setLoopEnabled(true); // no-op
    store.setLoopEnabled(false);
    expect(seen).toEqual([false, true, false]);
    dispose();
  });

  it('state objects keep stable references across setters', () => {
    const perf = store.getState().performance;
    store.setPerformLmbSounding(true);
    expect(store.getState().performance).toBe(perf);
    expect(perf.lmbSounding).toBe(true);
    store.setPerformLmbSounding(false);
  });

  it('getState() values cannot be assigned directly', () => {
    expect(() => {
      (store.getState() as { activeTool: string }).activeTool = 'select';
    }).toThrow(TypeError);
  });
});

describe('watch', () => {
  it('runs once up front, then only when the selected value changes', () => {
    const calls: string[] = [];
    const dispose = watch(() => store.getState().activeTool, t => { calls.push(t); });
    store.setTool('draw');   // same value → skipped
    store.setTool('select');
    store.setTool('select'); // same value → skipped
    expect(calls).toEqual(['draw', 'select']);
    dispose();
    store.setTool('draw');
  });

  it('does not subscribe to what the run callback reads', () => {
    let runs = 0;
    const dispose = watch(() => store.getState().activeTool, () => {
      runs++;
      void store.getState().metronomeVolume; // read inside run: untracked
    });
    store.setMetronomeVolume(0.25);
    store.setMetronomeVolume(0.5);
    expect(runs).toBe(1);
    dispose();
  });
});

describe('setHtmlIfChanged', () => {
  it('only touches the DOM when the markup differs', () => {
    const el = { innerHTML: '' } as unknown as Element;
    expect(setHtmlIfChanged(el, '<b>a</b>')).toBe(true);
    (el as unknown as { innerHTML: string }).innerHTML = 'sentinel';
    expect(setHtmlIfChanged(el, '<b>a</b>')).toBe(false);
    expect((el as unknown as { innerHTML: string }).innerHTML).toBe('sentinel');
    expect(setHtmlIfChanged(el, '<b>b</b>')).toBe(true);
    expect((el as unknown as { innerHTML: string }).innerHTML).toBe('<b>b</b>');
  });
});
