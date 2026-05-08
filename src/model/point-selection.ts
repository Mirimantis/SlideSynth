/**
 * Helpers for the per-point multi-selection (BACKLOG 8.3). Point keys are
 * `<curveId>:<idx>` strings so identity comparisons work natively in `Set`s.
 *
 * Indices are not stable across point insertions/deletions — selection is
 * transient UI state, pruned when the underlying composition mutates.
 */

export function pointKey(curveId: string, idx: number): string {
  return `${curveId}:${idx}`;
}

export function parsePointKey(key: string): { curveId: string; idx: number } {
  const sep = key.lastIndexOf(':');
  if (sep < 0) return { curveId: key, idx: -1 };
  return {
    curveId: key.slice(0, sep),
    idx: Number(key.slice(sep + 1)),
  };
}

/** Group a flat point-key set by curve id into `Map<curveId, Set<idx>>`. */
export function pointKeysByCurve(keys: Iterable<string>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const key of keys) {
    const { curveId, idx } = parsePointKey(key);
    if (idx < 0) continue;
    let set = out.get(curveId);
    if (!set) { set = new Set(); out.set(curveId, set); }
    set.add(idx);
  }
  return out;
}
