import { isDeepStrictEqual } from "node:util";
import type { Change } from "./diff.ts";
import { matchPath } from "./paths.ts";

/** Something that MUST appear in the state diff for the task to count as done. */
export interface Requirement {
  description: string;
  /** Path pattern, e.g. `orders.O-1.refunded` or `refunds.*.amount`. */
  path: string;
  kind?: Change["kind"];
  /** If set, the change's new value must equal this. */
  equals?: unknown;
}

export interface Spec {
  required: Requirement[];
  /** Path patterns that may change without counting as collateral damage. */
  allowed: string[];
}

export interface Verdict {
  passed: boolean;
  /** Required outcomes that never happened. */
  missing: Requirement[];
  /** Changes that were neither required nor allowed. */
  collateral: Change[];
}

export function verify(changes: Change[], spec: Spec): Verdict {
  const matched = new Set<Change>();
  const missing: Requirement[] = [];

  for (const req of spec.required) {
    const hits = changes.filter(
      (c) =>
        matchPath(req.path, c.path) &&
        (req.kind === undefined || c.kind === req.kind) &&
        (req.equals === undefined || isDeepStrictEqual(c.after, req.equals)),
    );
    if (hits.length === 0) missing.push(req);
    for (const hit of hits) matched.add(hit);
  }

  const collateral = changes.filter(
    (c) => !matched.has(c) && !spec.allowed.some((pattern) => matchPath(pattern, c.path)),
  );

  return { passed: missing.length === 0 && collateral.length === 0, missing, collateral };
}
