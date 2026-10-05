import { describe, it, expect } from 'vitest';
import { joinsAsFinger, routeMove, routePress, type PressContext } from './input-router';

const base: PressContext = { button: 0, altKey: false, performing: false, inRuler: false, rulerLocked: false, toolWantsAlt: false };
const press = (over: Partial<PressContext>) => routePress({ ...base, ...over });

describe('routePress (BACKLOG 15.2)', () => {
  it('left press edits while editing, performs while performing', () => {
    expect(press({})).toBe('tool');
    expect(press({ performing: true })).toBe('perform');
  });

  it('never both: a performing press goes to perform only (the 14.1 bug)', () => {
    expect(press({ performing: true })).not.toBe('tool');
  });

  it('rulers go to the tools (scrub, loop markers) in both modes, and are inert under a recording', () => {
    expect(press({ inRuler: true })).toBe('tool');
    expect(press({ inRuler: true, performing: true })).toBe('tool');
    expect(press({ inRuler: true, performing: true, rulerLocked: true })).toBeNull();
    expect(press({ inRuler: true, rulerLocked: true })).toBeNull();
    // The lock is only about the rulers.
    expect(press({ performing: true, rulerLocked: true })).toBe('perform');
  });

  it('middle button always pans', () => {
    expect(press({ button: 1 })).toBe('pan');
    expect(press({ button: 1, performing: true })).toBe('pan');
  });

  it('Alt+left pans unless the tools claim it for Alt-drag duplicate', () => {
    expect(press({ altKey: true })).toBe('pan');
    expect(press({ altKey: true, toolWantsAlt: true })).toBe('tool');
    // Not while performing — then Alt+left is a pan, never a perform.
    expect(press({ altKey: true, toolWantsAlt: true, performing: true })).toBe('pan');
    expect(press({ altKey: true, performing: true })).toBe('pan');
  });

  it('right button is left to the context menu', () => {
    expect(press({ button: 2 })).toBeNull();
  });
});

describe('routeMove', () => {
  const move = (over: Partial<Parameters<typeof routeMove>[0]>) =>
    routeMove({ isFinger: false, activePointerId: null, pointerId: 1, pointerType: 'mouse', ...over });

  it('sends an extra finger’s moves to its own voice', () => {
    expect(move({ isFinger: true, activePointerId: 1, pointerId: 2, pointerType: 'touch' })).toBe('finger');
  });

  it('moves the press in progress, and nothing else meanwhile', () => {
    expect(move({ activePointerId: 1, pointerId: 1 })).toBe('press');
    // A finger the performance didn't take (Prism Draw, the limit) used to
    // drag the primary and its chord around.
    expect(move({ activePointerId: 1, pointerId: 2, pointerType: 'touch' })).toBeNull();
  });

  it('hovers a mouse or pen between presses, never a touch', () => {
    expect(move({})).toBe('hover');
    expect(move({ pointerType: 'pen' })).toBe('hover');
    expect(move({ pointerType: 'touch' })).toBeNull();
  });
});

describe('joinsAsFinger (13.33)', () => {
  it('lets a second finger join a performance on a touch screen', () => {
    expect(joinsAsFinger('perform', 'touch', 'perform')).toBe(true);
  });

  it('is touch only: not a mouse or a pen', () => {
    expect(joinsAsFinger('perform', 'mouse', 'perform')).toBe(false);
    expect(joinsAsFinger('perform', 'pen', 'perform')).toBe(false);
  });

  it('only joins a performance, and only where it would perform itself', () => {
    expect(joinsAsFinger('tool', 'touch', 'tool')).toBe(false);
    expect(joinsAsFinger('pan', 'touch', 'perform')).toBe(false);
    expect(joinsAsFinger('perform', 'touch', 'tool')).toBe(false);   // on the rulers
    expect(joinsAsFinger('perform', 'touch', null)).toBe(false);
  });
});
