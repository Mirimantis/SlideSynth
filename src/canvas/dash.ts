/**
 * Dashed lines that belong to the canvas, not the screen. A line drawn from
 * the screen's edge starts its dash pattern there, so when the canvas scrolls
 * (Scroll canvas during playback, panning) the dashes stand still while
 * everything else moves. Setting `lineDashOffset` to this pins the pattern to
 * world 0 instead, so the dashes travel with the content.
 */
export function worldDashOffset(worldZeroOnScreen: number, pattern: readonly number[]): number {
  const length = pattern.reduce((a, b) => a + b, 0);
  if (!(length > 0)) return 0;
  return (((-worldZeroOnScreen) % length) + length) % length;
}
