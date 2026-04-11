let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

/**
 * Get or create the shared AudioContext.
 * Must be called from a user gesture handler the first time
 * (browser autoplay policy).
 */
export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

export function getMasterGain(): GainNode {
  if (!masterGain) getAudioContext();
  return masterGain!;
}

/** Resume a suspended context (required after first user gesture). */
export async function ensureResumed(): Promise<void> {
  const audio = getAudioContext();
  if (audio.state === 'suspended') {
    await audio.resume();
  }
}

export function getMasterVolume(): number {
  return getMasterGain().gain.value;
}

export function setMasterVolume(v: number): void {
  getMasterGain().gain.value = Math.max(0, Math.min(1, v));
}
