import assert from "node:assert/strict";
import { test } from "node:test";
import { diff } from "./diff.ts";
import { matchPath } from "./paths.ts";
import { verify } from "./verify.ts";

test("diff reports added, removed and changed leaves", () => {
  const before = { a: { x: 1, y: 2 }, gone: true };
  const after = { a: { x: 1, y: 3 }, fresh: "hi" };
  assert.deepEqual(diff(before, after), [
    { path: "a.y", kind: "changed", before: 2, after: 3 },
    { path: "fresh", kind: "added", before: undefined, after: "hi" },
    { path: "gone", kind: "removed", before: true, after: undefined },
  ]);
});

test("diff of identical state is empty", () => {
  assert.deepEqual(diff({ a: { b: [1, 2] } }, { a: { b: [1, 2] } }), []);
});

test("matchPath supports * and **", () => {
  assert.equal(matchPath("refunds.*.amount", "refunds.R-1.amount"), true);
  assert.equal(matchPath("refunds.*.amount", "refunds.R-1.orderId"), false);
  assert.equal(matchPath("refunds.*", "refunds.R-1.amount"), false);
  assert.equal(matchPath("refunds.**", "refunds.R-1.amount"), true);
  assert.equal(matchPath("tickets.T-1.status", "tickets.T-1.status"), true);
});

test("verify flags missing outcomes and collateral damage", () => {
  const changes = diff({ a: 1, b: 1 }, { a: 2, b: 2 });
  const verdict = verify(changes, {
    required: [{ description: "a becomes 2", path: "a", equals: 2 }],
    allowed: [],
  });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.missing, []);
  assert.deepEqual(
    verdict.collateral.map((c) => c.path),
    ["b"],
  );

  const missing = verify(changes, {
    required: [{ description: "a becomes 9", path: "a", equals: 9 }],
    allowed: ["b"],
  });
  assert.equal(missing.passed, false);
  assert.equal(missing.missing.length, 1);
});
