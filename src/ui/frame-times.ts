/**
 * Rolling frame-time buffer for the Perf HUD (split out of main.ts in 15.3):
 * about 2 s at 60 fps. Push every render frame; sort a copy only when the HUD
 * asks for a percentile. Push is O(1); the sort is O(n log n) over 125 entries,
 * paid only while the HUD is visible.
 */

const FRAME_BUFFER_SIZE = 125;

export interface FrameTimes {
  /** A frame started at `now` (performance.now()). */
  push(now: number): void;
  /** The frame time (ms) at percentile `p` (0–1) of the window; 0 before any. */
  percentile(p: number): number;
}

export function createFrameTimes(): FrameTimes {
  const times = new Float32Array(FRAME_BUFFER_SIZE);
  let filled = 0;
  let index = 0;
  let lastNow = 0;
  return {
    push(now) {
      if (lastNow !== 0) {
        times[index] = now - lastNow;
        index = (index + 1) % FRAME_BUFFER_SIZE;
        if (filled < FRAME_BUFFER_SIZE) filled++;
      }
      lastNow = now;
    },
    percentile(p) {
      if (filled === 0) return 0;
      const sorted = Array.from(times.subarray(0, filled)).sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
      return sorted[idx]!;
    },
  };
}
