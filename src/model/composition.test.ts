import { describe, it, expect } from 'vitest';
import { createComposition, createDefaultSnapSettings } from './composition';
import { migrateSnapSettings } from '../export/json-export';
import { ALL_NOTES, TWELVE_EDO } from '../tuning/tuning';

describe('new composition defaults (2026-10-04)', () => {
  it('starts in 12-EDO, root C, Major', () => {
    const { snap } = createComposition();
    expect(snap.tuning).toEqual(TWELVE_EDO);
    expect(snap.root).toBe(0);
    expect(snap.scaleId).toBe('major');
  });

  it('keeps All notes for a file or MIDI import with no snap settings, as before', () => {
    expect(createDefaultSnapSettings().scaleId).toBe(ALL_NOTES);
    expect(migrateSnapSettings(undefined).scaleId).toBe(ALL_NOTES);
  });
});
