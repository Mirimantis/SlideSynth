import type { Composition, ToneDefinition } from '../types';
import { createDefaultSnapSettings } from '../model/composition';

const COMPOSITION_VERSION = 2;

/**
 * Serialize a composition to JSON string.
 */
export function serializeComposition(comp: Composition): string {
  return JSON.stringify({ ...comp, version: COMPOSITION_VERSION }, null, 2);
}

/**
 * Deserialize a composition from JSON string.
 */
export function deserializeComposition(json: string): Composition {
  const data = JSON.parse(json) as Composition;

  if (!data.version || !data.tracks || !data.toneLibrary) {
    throw new Error('Invalid composition file');
  }

  // Backfill additive fields on older saves
  if (typeof data.loopStartBeats !== 'number') data.loopStartBeats = 0;
  if (typeof data.loopEndBeats !== 'number') data.loopEndBeats = 2 * data.beatsPerMeasure;
  if (typeof data.timeSignatureDenominator !== 'number') data.timeSignatureDenominator = 4;

  // Migrate Phase-1 chord groupings: chordGroupId → groupId.
  for (const track of data.tracks) {
    for (const curve of track.curves as Array<{ chordGroupId?: string | null; groupId?: string | null }>) {
      if (curve.chordGroupId !== undefined && curve.groupId === undefined) {
        curve.groupId = curve.chordGroupId;
      }
      delete curve.chordGroupId;
    }
  }

  // v1 → v2: per-composition snap settings + guides. v1 files had no `snap` block;
  // seed from the documented defaults so legacy saves open with the historical
  // global defaults rather than whatever the user had set in their session.
  if (!data.snap || typeof data.snap !== 'object') {
    data.snap = createDefaultSnapSettings();
  } else if (typeof (data.snap as Partial<typeof data.snap>).hidePitchLines !== 'boolean') {
    // 8.19: v2 files saved before hidePitchLines existed open as Chromatic.
    data.snap.hidePitchLines = false;
  }
  if (!Array.isArray(data.guides)) {
    data.guides = [];
  }

  return data;
}

/**
 * Serialize tone library to JSON string.
 */
export function serializeToneLibrary(tones: ToneDefinition[]): string {
  return JSON.stringify(tones, null, 2);
}

/**
 * Deserialize tone library from JSON string.
 */
export function deserializeToneLibrary(json: string): ToneDefinition[] {
  const data = JSON.parse(json) as ToneDefinition[];
  if (!Array.isArray(data) || data.length === 0 || !data[0]?.id) {
    throw new Error('Invalid tone library file');
  }
  return data;
}

/**
 * Trigger a browser download of a string as a file.
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker and read the selected file as text.
 */
export function openFile(accept: string = '.json'): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    input.click();
  });
}

/**
 * Open a file picker and read the selected file as an ArrayBuffer.
 * Used for binary formats like MIDI.
 */
export function openBinaryFile(accept: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    input.click();
  });
}
