import type { Track } from '../types';
import { generateId } from './tone';

export function createTrack(name: string, toneId: string): Track {
  return {
    id: generateId('track'),
    name,
    toneId,
    curves: [],
    muted: false,
    solo: false,
    volume: 0.8,
  };
}
