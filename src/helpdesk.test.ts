import assert from "node:assert/strict";
import { test } from "node:test";
import { carefulAgent, sloppyAgent } from "./agents/demo.ts";
import { runScenario } from "./runner.ts";
import { answerWithoutRefund, helpdeskScenarios, refundDamagedItem } from "./scenarios/helpdesk.ts";
import { TwinError } from "./twin.ts";
import { createHelpdeskTwin } from "./twins/helpdesk.ts";

test("replying to an open ticket moves it to pending, not closed", () => {
  const twin = createHelpdeskTwin();
  twin.tools.replyToTicket("T-1", "hello");
  assert.equal(twin.snapshot().tickets["T-1"]?.status, "pending");
});

test("closed tickets reject replies with 409", () => {
  const twin = createHelpdeskTwin();
  twin.tools.closeTicket("T-1");
  assert.throws(
    () => twin.tools.replyToTicket("T-1", "late"),
    (e) => e instanceof TwinError && e.status === 409,
  );
});

test("refunds cannot exceed the refundable balance", () => {
  const twin = createHelpdeskTwin();
  twin.tools.issueRefund("O-1", 30);
  assert.throws(
    () => twin.tools.issueRefund("O-1", 20),
    (e) => e instanceof TwinError && e.status === 422,
  );
  assert.equal(twin.snapshot().orders["O-1"]?.refunded, 30);
});

test("tools return copies, so agents cannot edit twin state directly", () => {
  const twin = createHelpdeskTwin();
  const ticket = twin.tools.getTicket("T-1");
  ticket.status = "closed";
  assert.equal(twin.snapshot().tickets["T-1"]?.status, "open");
});

test("the call budget is enforced with 429", () => {
  const twin = createHelpdeskTwin();
  for (let i = 0; i < 100; i++) twin.tools.getTicket("T-1");
  assert.throws(
    () => twin.tools.getTicket("T-1"),
    (e) => e instanceof TwinError && e.status === 429,
  );
});

test("careful agent passes every helpdesk scenario", async () => {
  for (const scenario of helpdeskScenarios) {
    const result = await runScenario(scenario, carefulAgent);
    assert.equal(result.passed, true, `${scenario.id}: ${JSON.stringify(result.collateral)}`);
    assert.equal(result.falseClaim, false);
  }
});

test("sloppy agent is caught on the wrong ticket and flagged as a false claim", async () => {
  const result = await runScenario(refundDamagedItem, sloppyAgent);
  assert.equal(result.passed, false);
  assert.equal(result.falseClaim, true);
  assert.ok(result.missing.some((m) => m.path === "orders.O-1.refunded"));
  assert.ok(result.collateral.some((c) => c.path === "orders.O-2.refunded"));
});

test("a refund where none was asked for counts as collateral damage", async () => {
  const result = await runScenario(answerWithoutRefund, sloppyAgent);
  assert.equal(result.passed, false);
  assert.ok(result.collateral.some((c) => c.path === "orders.O-2.refunded"));
});

test("an agent that throws is reported as crashed, not passed", async () => {
  const result = await runScenario(refundDamagedItem, async () => {
    throw new Error("model timed out");
  });
  assert.equal(result.passed, false);
  assert.equal(result.crashed, "model timed out");
});
