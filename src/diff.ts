import { isDeepStrictEqual } from "node:util";

export interface Change {
  /** Dot-separated path to a leaf value, e.g. `orders.O-1.refunded`. */
  path: string;
  kind: "added" | "removed" | "changed";
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Flatten nested objects into leaf paths. Arrays are leaves; empty objects are skipped. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.set(prefix, value);
}

/**
 * Compare two state snapshots and list every leaf that was added, removed or
 * changed. Records should be keyed by id (not arrays) so paths stay stable.
 */
export function diff(before: unknown, after: unknown): Change[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, "", a);
  flatten(after, "", b);

  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changes: Change[] = [];
  for (const path of paths) {
    const hasBefore = a.has(path);
    const hasAfter = b.has(path);
    if (hasBefore && !hasAfter) {
      changes.push({ path, kind: "removed", before: a.get(path), after: undefined });
    } else if (!hasBefore && hasAfter) {
      changes.push({ path, kind: "added", before: undefined, after: b.get(path) });
    } else if (!isDeepStrictEqual(a.get(path), b.get(path))) {
      changes.push({ path, kind: "changed", before: a.get(path), after: b.get(path) });
    }
  }
  return changes;
}
