/**
 * Voice ids of the Harmonic Prism's chord voices (split out of main.ts in
 * 15.3). The cursor's voice is 'primary'; chord voice i (1..N-1) is
 * `harmony-${i - 1}`.
 */

/** Harmony voiceId for chord index i (1..N-1, since 0 = primary). */
export function harmonyVoiceId(harmonyIndex: number): string {
  return `harmony-${harmonyIndex}`;
}

/** Parse 'harmony-N' → N. Returns null for non-harmony voiceIds. */
export function parseHarmonyIndex(voiceId: string): number | null {
  if (!voiceId.startsWith('harmony-')) return null;
  const n = Number(voiceId.slice('harmony-'.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}
