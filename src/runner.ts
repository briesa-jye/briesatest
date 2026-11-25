import { diff } from "./diff.ts";
import type { Change } from "./diff.ts";
import type { Scenario } from "./scenario.ts";
import type { Agent, AgentReport, CallRecord } from "./twin.ts";
import { verify } from "./verify.ts";
import type { Requirement } from "./verify.ts";

export interface RunResult {
  scenarioId: string;
  title: string;
  /** True only if every required outcome happened and nothing else changed. */
  passed: boolean;
  /** The agent said it succeeded but the state diff says otherwise. */
  falseClaim: boolean;
  report?: AgentReport;
  /** Set if the agent threw instead of returning a report. */
  crashed?: string;
  missing: Requirement[];
  collateral: Change[];
  changes: Change[];
  calls: CallRecord[];
}

export async function runScenario<State, Tools>(
  scenario: Scenario<State, Tools>,
  agent: Agent<Tools>,
): Promise<RunResult> {
  const twin = scenario.twin();
  const before = twin.snapshot();

  let report: AgentReport | undefined;
  let crashed: string | undefined;
  try {
    report = await agent({ task: scenario.task, tools: twin.tools });
  } catch (error) {
    crashed = error instanceof Error ? error.message : String(error);
  }

  const changes = diff(before, twin.snapshot());
  const verdict = verify(changes, scenario.spec);
  const passed = verdict.passed && crashed === undefined;

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    passed,
    falseClaim: report?.success === true && !passed,
    report,
    crashed,
    missing: verdict.missing,
    collateral: verdict.collateral,
    changes,
    calls: twin.calls,
  };
}
