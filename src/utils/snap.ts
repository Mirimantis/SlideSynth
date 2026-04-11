import { SUBDIVISIONS_PER_BEAT, MIN_NOTE, MAX_NOTE } from '../constants';

export interface SnapConfig {
  enabled: boolean;
  subdivisionsPerBeat: number;
}

/**
 * Snap world coordinates to the grid.
 * X snaps to 1/16 beat boundaries, Y snaps to nearest integer note.
 * Returns original coordinates if snap is disabled.
 */
export function snapToGrid(
  wx: number,
  wy: number,
  config: SnapConfig,
): { wx: number; wy: number } {
  if (!config.enabled) return { wx, wy };

  const step = 1 / config.subdivisionsPerBeat;
  const snappedX = Math.round(wx / step) * step;
  const snappedY = Math.round(Math.max(MIN_NOTE, Math.min(MAX_NOTE, wy)));

  return { wx: Math.max(0, snappedX), wy: snappedY };
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  subdivisionsPerBeat: SUBDIVISIONS_PER_BEAT,
};
