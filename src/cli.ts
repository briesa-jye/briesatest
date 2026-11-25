import { parseArgs } from "node:util";
import { DEFAULT_MODEL, anthropicCall, claudeAgent } from "./adapters/claude.ts";
import { carefulCrmAgent, sloppyCrmAgent } from "./agents/crm-demo.ts";
import { carefulAgent, sloppyAgent } from "./agents/demo.ts";
import { runMany } from "./batch.ts";
import type { BatchResult } from "./batch.ts";
import type { Change } from "./diff.ts";
import type { Scenario } from "./scenario.ts";
import { crmScenarios } from "./scenarios/crm.ts";
import { helpdeskScenarios } from "./scenarios/helpdesk.ts";
import type { Agent } from "./twin.ts";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    concurrency: { type: "string", default: "1" },
    live: { type: "boolean", default: false },
    model: { type: "string", default: DEFAULT_MODEL },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: npm run demo -- [options]

  --runs N          run every scenario N times per agent and report pass rates (default 1)
  --concurrency N   how many runs to execute at once (default 1)
  --live            also run a real Claude agent (needs ANTHROPIC_API_KEY; makes billed API calls)
  --model ID        model for --live (default ${DEFAULT_MODEL})`);
  process.exit(0);
}

const runs = Math.max(1, Number.parseInt(values.runs, 10) || 1);
const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 1);

interface Job {
  agentName: string;
  control: boolean;
  run: () => Promise<BatchResult>;
}

/** Pair a scenario with an agent. Generic so each twin keeps its own tool types. */
const job = <S, T>(agentName: string, control: boolean, scenario: Scenario<S, T>, agent: Agent<T>): Job => ({
  agentName,
  control,
  run: () => runMany(scenario, agent, { runs, concurrency }),
});

const jobs: Job[] = [];
for (const scenario of helpdeskScenarios) {
  jobs.push(job("careful-agent", true, scenario, carefulAgent));
  jobs.push(job("sloppy-agent", false, scenario, sloppyAgent));
}
for (const scenario of crmScenarios) {
  jobs.push(job("careful-agent", true, scenario, carefulCrmAgent));
  jobs.push(job("sloppy-agent", false, scenario, sloppyCrmAgent));
}
if (values.live) {
  const live = claudeAgent({ call: anthropicCall(), model: values.model });
  for (const scenario of helpdeskScenarios) jobs.push(job(`claude`, false, scenario, live));
  for (const scenario of crmScenarios) jobs.push(job(`claude`, false, scenario, live));
}

const show = (value: unknown) => (value === undefined ? "∅" : JSON.stringify(value));
const describe = (c: Change) => `${c.path}: ${show(c.before)} → ${show(c.after)}`;
const percent = (x: number) => `${Math.round(x * 100)}%`;

function printSingle(agentName: string, batch: BatchResult): void {
  const result = batch.results[0];
  if (!result) return;
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${agentName.padEnd(14)} ${result.scenarioId}`);
  if (result.falseClaim) {
    console.log(`      agent claimed success: "${result.report?.summary}", but the state says otherwise`);
  }
  if (result.crashed) console.log(`      crashed: ${result.crashed}`);
  for (const m of result.missing) console.log(`      missing:    ${m.description}`);
  for (const c of result.collateral) console.log(`      unexpected: ${describe(c)}`);
}

function printMany(agentName: string, batch: BatchResult): void {
  const [low, high] = batch.interval;
  const mark = batch.passes === batch.runs ? "PASS" : "FAIL";
  console.log(
    `${mark}  ${agentName.padEnd(14)} ${batch.scenarioId.padEnd(24)} ` +
      `${batch.passes}/${batch.runs} (${percent(batch.passRate)}, 95% CI ${percent(low)}–${percent(high)})`,
  );
  if (batch.falseClaims > 0) {
    console.log(`      ${batch.falseClaims}/${batch.runs} runs claimed success when the state said otherwise`);
  }
  const modes = Object.entries(batch.failureModes).sort((a, b) => b[1] - a[1]);
  for (const [mode, count] of modes.slice(0, 4)) console.log(`      ${count}× ${mode}`);
}

console.log(`Briesa Verify demo: ${runs} run${runs === 1 ? "" : "s"} per scenario\n`);
let controlFailed = false;
let lastScenario = "";
for (const j of jobs) {
  let batch: BatchResult;
  try {
    batch = await j.run();
  } catch (error) {
    console.log(`ERROR ${j.agentName}: ${error instanceof Error ? error.message : String(error)}`);
    if (j.agentName === "claude") {
      console.log("      Is ANTHROPIC_API_KEY set? Skipping the remaining live runs.");
      break;
    }
    throw error;
  }
  if (batch.scenarioId !== lastScenario && lastScenario !== "") console.log();
  lastScenario = batch.scenarioId;
  if (runs === 1) printSingle(j.agentName, batch);
  else printMany(j.agentName, batch);
  // Control agents must always pass: if they don't, the twin or the spec is wrong.
  if (j.control && batch.passes !== batch.runs) controlFailed = true;
}

process.exitCode = controlFailed ? 1 : 0;
