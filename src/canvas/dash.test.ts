import { describe, it, expect } from 'vitest';
import { worldDashOffset } from './dash';

describe('dashes move with the canvas', () => {
  it('pins the pattern to world 0', () => {
    expect(worldDashOffset(0, [4, 4])).toBe(0);
    // World 0 three pixels left of the screen: the line starts 3 px into the pattern.
    expect(worldDashOffset(-3, [4, 4])).toBe(3);
    // Scrolling by a whole pattern changes nothing.
    expect(worldDashOffset(-11, [4, 4])).toBe(worldDashOffset(-3, [4, 4]));
    expect(worldDashOffset(5, [2, 4])).toBe(1);
  });
});
