import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeAgent } from "./adapters/claude.ts";
import type { ContentBlock, ModelCall, ModelRequest, ModelResponse } from "./adapters/claude.ts";
import { runScenario } from "./runner.ts";
import { winDeal } from "./scenarios/crm.ts";
import { refundDamagedItem } from "./scenarios/helpdesk.ts";

const toolUse = (id: string, name: string, input: unknown): ContentBlock => ({
  type: "tool_use",
  id,
  name,
  input,
});

const turn = (...content: ContentBlock[]): ModelResponse => ({ stop_reason: "tool_use", content });

/** A fake model that replays scripted responses and records what it was sent. */
function scripted(responses: ModelResponse[]) {
  const requests: ModelRequest[] = [];
  const call: ModelCall = async (request) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  };
  return { call, requests };
}

const report = (id: string, success: boolean, summary: string) =>
  turn(toolUse(id, "report_result", { success, summary }));

test("a scripted model that does the job passes verification", async () => {
  const { call, requests } = scripted([
    turn(toolUse("a", "get_ticket", { id: "T-1" })),
    turn(toolUse("b", "get_order", { id: "O-1" })),
    turn(toolUse("c", "issue_refund", { order_id: "O-1", amount: 40 })),
    turn(
      toolUse("d", "reply_to_ticket", { ticket_id: "T-1", body: "Refunded, sorry!" }),
      toolUse("e", "close_ticket", { id: "T-1" }),
    ),
    report("f", true, "Refunded and closed."),
  ]);

  const result = await runScenario(refundDamagedItem, claudeAgent({ call }));
  assert.equal(result.passed, true, JSON.stringify([result.missing, result.collateral]));
  assert.equal(result.report?.summary, "Refunded and closed.");

  // The model sees the task, the twin's tools, and the report tool: not the spec.
  const first = requests[0];
  assert.ok(first);
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.messages[0]?.content, refundDamagedItem.task);
  const names = first.tools.map((t) => t.name);
  assert.ok(names.includes("issue_refund") && names.includes("report_result"));
  assert.ok(!JSON.stringify(first).includes("collateral"));
});

test("parallel tool calls come back together in one user message", async () => {
  const { call, requests } = scripted([
    turn(toolUse("a", "get_ticket", { id: "T-1" }), toolUse("b", "get_order", { id: "O-1" })),
    report("c", true, "ok"),
  ]);
  await runScenario(refundDamagedItem, claudeAgent({ call }));

  const second = requests[1];
  assert.ok(second);
  const last = second.messages.at(-1);
  assert.equal(last?.role, "user");
  const blocks = last?.content as { tool_use_id: string }[];
  assert.deepEqual(
    blocks.map((b) => b.tool_use_id),
    ["a", "b"],
  );
});

test("twin errors go back to the model as is_error results it can recover from", async () => {
  const { call, requests } = scripted([
    turn(toolUse("a", "update_deal_stage", { id: "D-1", stage: "won" })), // 422: no amount yet
    turn(toolUse("b", "update_deal_amount", { id: "D-1", amount: 12000 })),
    turn(toolUse("c", "update_deal_stage", { id: "D-1", stage: "won" })),
    turn(toolUse("d", "add_note", { deal_id: "D-1", body: "Verbally agreed." })),
    report("e", true, "Won."),
  ]);

  const result = await runScenario(winDeal, claudeAgent({ call }));
  assert.equal(result.passed, true, JSON.stringify([result.missing, result.collateral]));

  const afterError = requests[1]?.messages.at(-1)?.content as {
    is_error?: boolean;
    content: string;
  }[];
  assert.equal(afterError[0]?.is_error, true);
  assert.match(afterError[0]?.content ?? "", /needs an amount/);
});

test("a model that claims success without doing the work is flagged as a false claim", async () => {
  const { call } = scripted([report("a", true, "All done!")]);
  const result = await runScenario(refundDamagedItem, claudeAgent({ call }));
  assert.equal(result.passed, false);
  assert.equal(result.falseClaim, true);
});

test("unknown tools and malformed input are reported back, not thrown", async () => {
  const { call, requests } = scripted([
    turn(toolUse("a", "launch_missiles", {}), toolUse("b", "issue_refund", { order_id: "O-1" })),
    report("c", false, "Could not finish."),
  ]);
  const result = await runScenario(refundDamagedItem, claudeAgent({ call }));
  assert.equal(result.crashed, undefined);
  assert.equal(result.report?.success, false);

  const results = requests[1]?.messages.at(-1)?.content as { is_error?: boolean; content: string }[];
  assert.match(results[0]?.content ?? "", /Unknown tool/);
  assert.match(results[1]?.content ?? "", /"amount" must be a number/);
});

test("a refusal is reported as an unsuccessful run, not a crash", async () => {
  const { call } = scripted([{ stop_reason: "refusal", content: [] }]);
  const result = await runScenario(refundDamagedItem, claudeAgent({ call }));
  assert.equal(result.report?.success, false);
  assert.match(result.report?.summary ?? "", /refused/);
  assert.equal(result.passed, false);
});

test("a model that stops talking without reporting is a failed run", async () => {
  const { call } = scripted([
    { stop_reason: "end_turn", content: [{ type: "text", text: "I think that's everything." }] },
  ]);
  const result = await runScenario(refundDamagedItem, claudeAgent({ call }));
  assert.equal(result.report?.success, false);
  assert.equal(result.report?.summary, "I think that's everything.");
});

test("the loop gives up after maxTurns", async () => {
  const forever: ModelCall = async () => turn(toolUse("x", "list_open_tickets", {}));
  const result = await runScenario(refundDamagedItem, claudeAgent({ call: forever, maxTurns: 3 }));
  assert.equal(result.report?.success, false);
  assert.match(result.report?.summary ?? "", /3 turns/);
});

test("assistant content, thinking blocks included, is passed back unchanged", async () => {
  const thinking: ContentBlock = { type: "thinking", thinking: "", signature: "sig" };
  const { call, requests } = scripted([
    turn(thinking, toolUse("a", "list_open_tickets", {})),
    report("b", true, "ok"),
  ]);
  await runScenario(refundDamagedItem, claudeAgent({ call }));
  const assistant = requests[1]?.messages.find((m) => m.role === "assistant");
  assert.deepEqual((assistant?.content as ContentBlock[])[0], thinking);
});
