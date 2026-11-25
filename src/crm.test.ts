import assert from "node:assert/strict";
import { test } from "node:test";
import { carefulCrmAgent, sloppyCrmAgent } from "./agents/crm-demo.ts";
import { runScenario } from "./runner.ts";
import { crmScenarios, quoteExistingContact, winDeal } from "./scenarios/crm.ts";
import { TwinError } from "./twin.ts";
import { createCrmTwin } from "./twins/crm.ts";

const status = (code: number) => (e: unknown) => e instanceof TwinError && e.status === code;

test("duplicate emails are rejected case-insensitively", () => {
  const twin = createCrmTwin();
  assert.throws(() => twin.tools.createContact("Jordan", "JORDAN@globex.com", "Globex"), status(409));
});

test("findContactByEmail returns null when there is no match", () => {
  const twin = createCrmTwin();
  assert.equal(twin.tools.findContactByEmail("nobody@example.com"), null);
  assert.equal(twin.tools.findContactByEmail("Priya@Acme.com")?.id, "C-1");
});

test("deals cannot skip stages", () => {
  const twin = createCrmTwin();
  assert.throws(() => twin.tools.updateDealStage("D-2", "proposal"), status(422));
  twin.tools.updateDealStage("D-2", "qualified");
  assert.equal(twin.snapshot().deals["D-2"]?.stage, "qualified");
});

test("a deal needs an amount before it can be won", () => {
  const twin = createCrmTwin();
  assert.throws(() => twin.tools.updateDealStage("D-1", "won"), status(422));
  twin.tools.updateDealAmount("D-1", 500);
  twin.tools.updateDealStage("D-1", "won");
  assert.equal(twin.snapshot().deals["D-1"]?.stage, "won");
});

test("won deals are closed for good", () => {
  const twin = createCrmTwin();
  twin.tools.updateDealAmount("D-1", 500);
  twin.tools.updateDealStage("D-1", "won");
  assert.throws(() => twin.tools.updateDealAmount("D-1", 1), status(409));
});

test("a contact with open deals cannot be deleted", () => {
  const twin = createCrmTwin();
  assert.throws(() => twin.tools.deleteContact("C-1"), status(409));
});

test("tool specs validate raw model input", () => {
  const twin = createCrmTwin();
  const spec = twin.toolSpecs.find((s) => s.name === "update_deal_amount");
  assert.ok(spec);
  assert.throws(() => spec.run({ id: "D-1", amount: "lots" }), status(400));
  assert.throws(() => spec.run({ amount: 5 }), status(400));
});

test("careful agent passes every CRM scenario", async () => {
  for (const scenario of crmScenarios) {
    const result = await runScenario(scenario, carefulCrmAgent);
    assert.equal(result.passed, true, `${scenario.id}: ${JSON.stringify(result.missing)}`);
  }
});

test("sloppy agent swallows an error and falsely claims the deal is won", async () => {
  const result = await runScenario(winDeal, sloppyCrmAgent);
  assert.equal(result.passed, false);
  assert.equal(result.falseClaim, true);
  assert.ok(result.missing.some((m) => m.path === "deals.D-1.stage"));
});

test("sloppy agent creates a duplicate contact", async () => {
  const result = await runScenario(quoteExistingContact, sloppyCrmAgent);
  assert.equal(result.passed, false);
  assert.ok(result.collateral.some((c) => c.path.startsWith("contacts.C-3")));
});
