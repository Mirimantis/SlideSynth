let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const createdListeners: ((ctx: AudioContext) => void)[] = [];

/** Run `fn` with the AudioContext once it exists (now, if it already does).
 *  For setup that shouldn't create the context early, such as loading an
 *  AudioWorklet module. */
export function onAudioContextCreated(fn: (ctx: AudioContext) => void): void {
  if (ctx) fn(ctx);
  else createdListeners.push(fn);
}

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
    for (const fn of createdListeners.splice(0)) fn(ctx);
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
