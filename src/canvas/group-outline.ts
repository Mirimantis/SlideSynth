import type { BezierCurve, Track } from '../types';
import type { Viewport } from './viewport';
import { computeMultiCurveBBox } from '../model/curve';

/**
 * Group outlines (BACKLOG 13.12 / 16.5): the members of a group share one
 * outline whenever any member is hovered or selected, so a Prism chord or a
 * freehand group reads as one thing rather than as loose curves.
 */

const PAD = 8; // px outside the members' bounds, clear of the transform box handles

export interface OutlinedGroup {
  members: BezierCurve[];
  /** Only a hovered, unselected group is labelled; a selected one has the
   *  transform box and the Selection panel to say what it is. */
  labelled: boolean;
}

/** The groups on `track` that have a hovered or selected member. */
export function outlinedGroups(
  track: Track,
  selectedIds: ReadonlySet<string>,
  hoverId: string | null,
): OutlinedGroup[] {
  const byGroup = new Map<string, BezierCurve[]>();
  for (const c of track.curves) {
    if (!c.groupId) continue;
    const list = byGroup.get(c.groupId);
    if (list) list.push(c);
    else byGroup.set(c.groupId, [c]);
  }
  const out: OutlinedGroup[] = [];
  for (const members of byGroup.values()) {
    const selected = members.some(c => selectedIds.has(c.id));
    const hovered = members.some(c => c.id === hoverId);
    if (selected || hovered) out.push({ members, labelled: !selected });
  }
  return out;
}

export function renderGroupOutlines(ctx: CanvasRenderingContext2D, vp: Viewport, groups: readonly OutlinedGroup[]): void {
  for (const { members, labelled } of groups) {
    const bbox = computeMultiCurveBBox(members);
    const tl = vp.worldToScreen(bbox.minX, bbox.maxY);
    const br = vp.worldToScreen(bbox.maxX, bbox.minY);
    const x = tl.sx - PAD;
    const y = tl.sy - PAD;
    const w = br.sx - tl.sx + PAD * 2;
    const h = br.sy - tl.sy + PAD * 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 202, 40, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    if (labelled) {
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(255, 202, 40, 0.9)';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Group · ${members.length}`, x + 2, y - 2);
    }
    ctx.restore();
  }
}
