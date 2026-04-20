import type { Viewport } from './viewport';
import { RAIL_SCREEN_X_RATIO } from './planchette';

/**
 * Position the viewport so `beat` sits under the stationary centered playhead/rail.
 * Allows offsetX to go negative so beat 0 can reach the centre.
 * Shared by Compose (Scroll Canvas view) and Glissandograph scrolling play.
 */
export function scrollViewportToBeat(
  vp: Viewport,
  beat: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const centreX = canvasWidth * RAIL_SCREEN_X_RATIO;
  vp.state.offsetX = beat - centreX / vp.state.zoomX;
  vp.clampOffset(canvasWidth, canvasHeight, -centreX / vp.state.zoomX);
}
