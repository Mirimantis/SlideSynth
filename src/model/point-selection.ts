/**
 * The per-point multi-selection (BACKLOG 8.3; typed in 15.2).
 *
 * A selection maps curve id → the selected anchor indices on that curve's
 * pitch lane. It is immutable — every change returns a new selection — and
 * never holds an empty set, so `size` on the map is the number of curves with
 * selected points. This replaced `"<curveId>:<idx>"` string keys, which had to
 * be split and re-parsed at every use.
 *
 * Indices are not stable across point insertions/deletions — selection is
 * transient UI state, cleared or pruned when the underlying curves change.
 */

/** One anchor point: which curve, and its index in the pitch lane. */
export interface PointRef {
  curveId: string;
  index: number;
}

export type PointSelection = ReadonlyMap<string, ReadonlySet<number>>;

export const NO_POINTS: PointSelection = new Map();

/** Build a selection from point refs (duplicates collapse). */
export function pointSelectionOf(points: Iterable<PointRef>): PointSelection {
  return addPoints(NO_POINTS, points);
}

/** Total number of selected points across all curves. */
export function pointCount(sel: PointSelection): number {
  let n = 0;
  for (const indices of sel.values()) n += indices.size;
  return n;
}

export function hasPoint(sel: PointSelection, ref: PointRef): boolean {
  return sel.get(ref.curveId)?.has(ref.index) ?? false;
}

/** Every selected point, flattened. */
export function pointRefs(sel: PointSelection): PointRef[] {
  const out: PointRef[] = [];
  for (const [curveId, indices] of sel) {
    for (const index of indices) out.push({ curveId, index });
  }
  return out;
}

/** The one selected point, or null when zero or several are selected. */
export function onlyPoint(sel: PointSelection): PointRef | null {
  if (sel.size !== 1) return null;
  const [curveId, indices] = [...sel][0]!;
  return indices.size === 1 ? { curveId, index: [...indices][0]! } : null;
}

export function addPoints(sel: PointSelection, points: Iterable<PointRef>): PointSelection {
  const next = new Map<string, Set<number>>();
  for (const [curveId, indices] of sel) next.set(curveId, new Set(indices));
  for (const { curveId, index } of points) {
    let set = next.get(curveId);
    if (!set) { set = new Set(); next.set(curveId, set); }
    set.add(index);
  }
  return next;
}

export function togglePoint(sel: PointSelection, ref: PointRef): PointSelection {
  if (!hasPoint(sel, ref)) return addPoints(sel, [ref]);
  const next = new Map<string, ReadonlySet<number>>();
  for (const [curveId, indices] of sel) {
    if (curveId !== ref.curveId) { next.set(curveId, indices); continue; }
    const rest = new Set(indices);
    rest.delete(ref.index);
    if (rest.size > 0) next.set(curveId, rest);
  }
  return next;
}

/** Drop every point on the given curves (e.g. when those curves are removed). */
export function withoutCurves(sel: PointSelection, curveIds: ReadonlySet<string>): PointSelection {
  let changed = false;
  const next = new Map<string, ReadonlySet<number>>();
  for (const [curveId, indices] of sel) {
    if (curveIds.has(curveId)) changed = true;
    else next.set(curveId, indices);
  }
  return changed ? next : sel;
}
