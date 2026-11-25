import assert from "node:assert/strict";
import { test } from "node:test";
import { carefulAgent, sloppyAgent } from "./agents/demo.ts";
import { runMany, wilsonInterval } from "./batch.ts";
import { refundDamagedItem } from "./scenarios/helpdesk.ts";
import type { Agent } from "./twin.ts";
import type { HelpdeskTools } from "./twins/helpdesk.ts";

test("a passing agent scores 100% and a failing one 0%", async () => {
  const good = await runMany(refundDamagedItem, carefulAgent, { runs: 5 });
  assert.equal(good.passes, 5);
  assert.equal(good.passRate, 1);
  assert.deepEqual(good.failureModes, {});

  const bad = await runMany(refundDamagedItem, sloppyAgent, { runs: 5 });
  assert.equal(bad.passes, 0);
  assert.equal(bad.falseClaims, 5);
  assert.equal(bad.failureModes["missing: Ticket T-1 is closed"], 5);
  assert.equal(bad.failureModes["unexpected: orders.O-2.refunded"], 5);
});

test("a flaky agent gets a pass rate in between, counted across concurrent runs", async () => {
  let n = 0;
  // Every third run does the work badly, like an LLM that sometimes slips.
  const flaky: Agent<HelpdeskTools> = (ctx) => (n++ % 3 === 2 ? sloppyAgent(ctx) : carefulAgent(ctx));

  const batch = await runMany(refundDamagedItem, flaky, { runs: 9, concurrency: 3 });
  assert.equal(batch.runs, 9);
  assert.equal(batch.results.length, 9);
  assert.equal(batch.passes, 6);
  assert.ok(Math.abs(batch.passRate - 6 / 9) < 1e-9);
  assert.ok(batch.interval[0] < batch.passRate && batch.passRate < batch.interval[1]);
});

test("every run gets a fresh twin, so one run cannot affect the next", async () => {
  const batch = await runMany(refundDamagedItem, carefulAgent, { runs: 3 });
  // A shared twin would reject the second refund (422) and fail runs 2 and 3.
  assert.equal(batch.passes, 3);
});

test("a crashing agent is counted as a crash and a failure", async () => {
  const batch = await runMany(
    refundDamagedItem,
    async () => {
      throw new Error("boom");
    },
    { runs: 2 },
  );
  assert.equal(batch.crashes, 2);
  assert.equal(batch.passes, 0);
  assert.equal(batch.failureModes["crashed: boom"], 2);
});

test("wilson interval is wide for few runs and narrows with more", () => {
  const [lowFew] = wilsonInterval(3, 3);
  const [lowMany] = wilsonInterval(30, 30);
  assert.ok(lowFew < lowMany);
  assert.ok(lowFew > 0.3 && lowFew < 0.5);
  const [low, high] = wilsonInterval(0, 5);
  assert.equal(low, 0);
  assert.ok(high > 0.3 && high < 0.5);
  assert.deepEqual(wilsonInterval(0, 0), [0, 1]);
});
