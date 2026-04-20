import type { Composition, ToneDefinition } from '../types';

const COMPOSITION_VERSION = 1;

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

  // Future migration logic would go here
  // if (data.version < COMPOSITION_VERSION) { migrate(data); }

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
