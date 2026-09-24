import { describe, it, expect } from 'vitest';
import { routePress, type PressContext } from './input-router';

const base: PressContext = { button: 0, altKey: false, performing: false, inRuler: false, toolWantsAlt: false };
const press = (over: Partial<PressContext>) => routePress({ ...base, ...over });

describe('routePress (BACKLOG 15.2)', () => {
  it('left press edits while editing, performs while performing', () => {
    expect(press({})).toBe('tool');
    expect(press({ performing: true })).toBe('perform');
  });

  it('never both: a performing press goes to perform only (the 14.1 bug)', () => {
    expect(press({ performing: true })).not.toBe('tool');
  });

  it('rulers go to the tools when editing (scrub, loop markers) and are inert while performing', () => {
    expect(press({ inRuler: true })).toBe('tool');
    expect(press({ inRuler: true, performing: true })).toBeNull();
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
