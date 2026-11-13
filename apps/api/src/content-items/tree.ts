// Pure tree rules for step 7.4 (cycles and depth). Rows are all items of one course.
import { ContentReasonCode, MAX_TREE_DEPTH } from "@itqan/shared";

export type TreeRow = { id: string; parentId: string | null; depth: number };

/** The item and every item under it, top-down. */
export function subtreeIds(rows: readonly TreeRow[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  }
  const out = [rootId];
  for (let i = 0; i < out.length; i++) out.push(...(children.get(out[i]!) ?? []));
  return out;
}

/** Levels from the item down to its deepest descendant: 1 when nothing is under it. */
export function subtreeHeight(rows: readonly TreeRow[], rootId: string): number {
  const ids = new Set(subtreeIds(rows, rootId));
  const depthOf = new Map(rows.map((r) => [r.id, r.depth]));
  let max = depthOf.get(rootId)!;
  for (const r of rows) if (ids.has(r.id)) max = Math.max(max, r.depth);
  return max - depthOf.get(rootId)! + 1;
}

/**
 * Where `itemId` lands if moved under `newParentId` (null = top of the course): its new depth,
 * or why the move is refused.
 */
export function planMove(
  rows: readonly TreeRow[],
  itemId: string,
  newParentId: string | null,
): { depth: number } | { reason: ContentReasonCode } {
  let depth = 1;
  if (newParentId) {
    if (subtreeIds(rows, itemId).includes(newParentId)) {
      return { reason: ContentReasonCode.TREE_CYCLE };
    }
    depth = rows.find((r) => r.id === newParentId)!.depth + 1;
  }
  if (depth + subtreeHeight(rows, itemId) - 1 > MAX_TREE_DEPTH) {
    return { reason: ContentReasonCode.TREE_TOO_DEEP };
  }
  return { depth };
}

/** Sibling ids in their new order after putting `itemId` at `position` (clamped to the end). */
export function placeAt(siblingIds: readonly string[], itemId: string, position?: number) {
  const rest = siblingIds.filter((id) => id !== itemId);
  const at = Math.min(position ?? rest.length, rest.length);
  return [...rest.slice(0, at), itemId, ...rest.slice(at)];
}
