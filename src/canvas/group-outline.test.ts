import { describe, it, expect } from 'vitest';
import { createTrack } from '../model/track';
import { createLane, createLanePoint } from '../model/lane';
import type { BezierCurve } from '../types';
import { outlinedGroups } from './group-outline';

function curve(id: string, groupId: string | null = null): BezierCurve {
  const lane = createLane('pitch');
  lane.points = [createLanePoint(0, 6000), createLanePoint(2, 6150)];
  return { id, lanes: [lane], groupId };
}

describe('group outlines (BACKLOG 13.12 / 16.5)', () => {
  const track = createTrack('Lead', 'tone');
  track.curves = [curve('a', 'g1'), curve('b', 'g1'), curve('c', 'g2'), curve('d', 'g2'), curve('solo')];
  const ids = (groups: ReturnType<typeof outlinedGroups>) => groups.map(g => g.members.map(c => c.id).join(''));

  it('outlines nothing when no member is hovered or selected', () => {
    expect(outlinedGroups(track, new Set(['solo']), 'solo')).toEqual([]);
  });

  it('outlines the whole group of a hovered member, labelled', () => {
    const groups = outlinedGroups(track, new Set(), 'b');
    expect(ids(groups)).toEqual(['ab']);
    expect(groups[0]!.labelled).toBe(true);
  });

  it('outlines selected groups without a label', () => {
    const groups = outlinedGroups(track, new Set(['c', 'd']), 'a');
    expect(ids(groups).sort()).toEqual(['ab', 'cd']);
    expect(groups.find(g => g.members[0]!.id === 'c')!.labelled).toBe(false);
  });
});
