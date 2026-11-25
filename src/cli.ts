import { carefulAgent, sloppyAgent } from "./agents/demo.ts";
import { runScenario } from "./runner.ts";
import type { RunResult } from "./runner.ts";
import { helpdeskScenarios } from "./scenarios/helpdesk.ts";
import type { Change } from "./diff.ts";

const show = (value: unknown) => (value === undefined ? "∅" : JSON.stringify(value));
const describe = (c: Change) => `${c.path}: ${show(c.before)} → ${show(c.after)}`;

function print(agentName: string, result: RunResult): void {
  const mark = result.passed ? "PASS" : "FAIL";
  console.log(`${mark}  ${agentName.padEnd(15)} ${result.scenarioId}`);
  if (result.falseClaim) {
    console.log(`      agent claimed success: "${result.report?.summary}" — state says otherwise`);
  }
  if (result.crashed) console.log(`      crashed: ${result.crashed}`);
  for (const m of result.missing) console.log(`      missing:    ${m.description}`);
  for (const c of result.collateral) console.log(`      unexpected: ${describe(c)}`);
}

const agents = [
  { name: "careful-agent", agent: carefulAgent },
  { name: "sloppy-agent", agent: sloppyAgent },
];

console.log("Briesa Verify — helpdesk twin demo\n");
let carefulFailed = false;
for (const scenario of helpdeskScenarios) {
  for (const { name, agent } of agents) {
    const result = await runScenario(scenario, agent);
    print(name, result);
    if (name === "careful-agent" && !result.passed) carefulFailed = true;
  }
  console.log();
}

// The careful agent is the control: if it fails, the twin or the spec is wrong.
process.exitCode = carefulFailed ? 1 : 0;
