import { runScenario } from "./runner.ts";
import type { RunResult } from "./runner.ts";
import type { Scenario } from "./scenario.ts";
import type { Agent } from "./twin.ts";

export interface BatchResult {
  scenarioId: string;
  title: string;
  runs: number;
  passes: number;
  passRate: number;
  /** 95% Wilson score interval for the true pass rate. Wide when `runs` is small. */
  interval: [number, number];
  /** Runs where the agent said it succeeded but the state diff disagreed. */
  falseClaims: number;
  crashes: number;
  /** How often each distinct failure happened, e.g. `missing: Order O-1 is refunded` → 3. */
  failureModes: Record<string, number>;
  results: RunResult[];
}

/** 95% Wilson score interval; behaves sensibly at 0% and 100% with few runs. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [Math.max(0, (centre - margin) / denominator), Math.min(1, (centre + margin) / denominator)];
}

function failureModesOf(results: RunResult[]): Record<string, number> {
  const modes: Record<string, number> = {};
  const bump = (key: string) => {
    modes[key] = (modes[key] ?? 0) + 1;
  };
  for (const result of results) {
    if (result.crashed) bump(`crashed: ${result.crashed}`);
    for (const m of result.missing) bump(`missing: ${m.description}`);
    // Count each path once per run, whether it was added, changed or removed.
    for (const path of new Set(result.collateral.map((c) => c.path))) bump(`unexpected: ${path}`);
  }
  return modes;
}

export interface RunManyOptions {
  runs: number;
  /** How many runs to execute at once. Each run gets its own fresh twin. Default 1. */
  concurrency?: number;
}

/** Run one scenario several times with the same agent and report the pass rate. */
export async function runMany<State, Tools>(
  scenario: Scenario<State, Tools>,
  agent: Agent<Tools>,
  options: RunManyOptions,
): Promise<BatchResult> {
  const runs = Math.max(1, Math.floor(options.runs));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));

  const results: RunResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < runs) {
      next += 1;
      results.push(await runScenario(scenario, agent));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, worker));

  const passes = results.filter((r) => r.passed).length;
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    runs,
    passes,
    passRate: passes / runs,
    interval: wilsonInterval(passes, runs),
    falseClaims: results.filter((r) => r.falseClaim).length,
    crashes: results.filter((r) => r.crashed !== undefined).length,
    failureModes: failureModesOf(results),
    results,
  };
}
