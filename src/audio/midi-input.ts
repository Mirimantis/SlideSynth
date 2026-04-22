/**
 * Thin wrapper around the Web MIDI API for live note input. Distinct from
 * src/export/midi-import.ts which imports MIDI *files*; this module reads
 * real-time noteOn / noteOff events from a connected MIDI device.
 *
 * Scope for the first pass: note events only. Pitch-bend, CC, and channel
 * routing are deliberately ignored — a future phase can add them once the
 * performance-engine side has a design for MIDI-driven recording.
 */

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiInput {
  /** Request browser permission + enumerate devices. Idempotent. */
  requestAccess(): Promise<boolean>;
  /** List currently-connected MIDI inputs. Empty if access not yet granted. */
  getDevices(): MidiDeviceInfo[];
  /** Route events from this device id, or null to disable. */
  setActiveDevice(deviceId: string | null): void;
  getActiveDeviceId(): string | null;
  /** Called when the set of connected devices changes (plug / unplug). */
  onDevicesChanged(cb: () => void): void;
  onNoteOn(cb: (note: number, velocity: number) => void): void;
  onNoteOff(cb: (note: number) => void): void;
  /** True once the user has granted MIDI access and the API is ready. */
  hasAccess(): boolean;
  /** True when `requestMIDIAccess` is available on this browser. */
  isSupported(): boolean;
}

type MIDIAccessLike = {
  inputs: Map<string, MIDIInputLike>;
  onstatechange: ((e: { port?: { type?: string } }) => void) | null;
};
type MIDIInputLike = {
  id: string;
  name: string | null;
  manufacturer: string | null;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
};

export function createMidiInput(): MidiInput {
  let access: MIDIAccessLike | null = null;
  let activeDeviceId: string | null = null;
  let activeInput: MIDIInputLike | null = null;
  let noteOnCb: ((note: number, velocity: number) => void) | null = null;
  let noteOffCb: ((note: number) => void) | null = null;
  let devicesChangedCb: (() => void) | null = null;

  function handleMessage(e: { data: Uint8Array }) {
    const [status, data1, data2] = e.data;
    if (status === undefined) return;
    const command = status & 0xf0;
    // Note-on with velocity 0 is treated as note-off by the MIDI spec.
    if (command === 0x90 && (data2 ?? 0) > 0) {
      if (data1 !== undefined && noteOnCb) noteOnCb(data1, (data2 ?? 0) / 127);
    } else if (command === 0x80 || (command === 0x90 && (data2 ?? 0) === 0)) {
      if (data1 !== undefined && noteOffCb) noteOffCb(data1);
    }
  }

  function attachActive(input: MIDIInputLike | null) {
    if (activeInput && activeInput !== input) activeInput.onmidimessage = null;
    activeInput = input;
    if (input) input.onmidimessage = handleMessage;
  }

  return {
    isSupported() {
      return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
    },
    async requestAccess() {
      if (access) return true;
      const req = (navigator as any).requestMIDIAccess;
      if (typeof req !== 'function') return false;
      try {
        access = await req.call(navigator) as MIDIAccessLike;
      } catch {
        return false;
      }
      access.onstatechange = () => {
        // If our active device vanished, drop it cleanly.
        if (activeDeviceId && !access!.inputs.has(activeDeviceId)) {
          activeDeviceId = null;
          attachActive(null);
        }
        if (devicesChangedCb) devicesChangedCb();
      };
      return true;
    },
    getDevices() {
      if (!access) return [];
      const out: MidiDeviceInfo[] = [];
      for (const input of access.inputs.values()) {
        out.push({
          id: input.id,
          name: input.name ?? 'MIDI Input',
          manufacturer: input.manufacturer ?? '',
        });
      }
      return out;
    },
    setActiveDevice(deviceId) {
      if (deviceId === activeDeviceId) return;
      activeDeviceId = deviceId;
      if (!access || !deviceId) {
        attachActive(null);
        return;
      }
      const input = access.inputs.get(deviceId) ?? null;
      attachActive(input);
    },
    getActiveDeviceId() {
      return activeDeviceId;
    },
    onDevicesChanged(cb) {
      devicesChangedCb = cb;
    },
    onNoteOn(cb) {
      noteOnCb = cb;
    },
    onNoteOff(cb) {
      noteOffCb = cb;
    },
    hasAccess() {
      return access !== null;
    },
  };
}
