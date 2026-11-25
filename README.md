# Briesa Verify

Proves what an AI agent actually did, not just what it said.

Agents run against **stateful digital twins** of business software (helpdesk, CRM…). Briesa Verify snapshots the twin before and after, diffs the state, and checks the diff against a scenario spec:

- **required**: outcomes that must have happened ("order O-1 refunded in full")
- **allowed**: side effects that are fine (a new email record, an `updatedAt` bump)
- everything else is **collateral damage** ("order O-2 was refunded too")

It also flags **false claims**: the agent reported success, but the state disagrees.

Because LLM agents vary run to run, every scenario can be run N times and reported as a **pass rate** with a 95% confidence interval and a tally of the most common failure modes.

## Run it

Needs Node 24+ (runs TypeScript directly, no build step).

```bash
npm install
npm test             # unit, twin and scenario tests (no network)
npm run typecheck
npm run demo         # scripted careful vs sloppy agents on both twins
npm run demo -- --runs 10 --concurrency 5
```

### Run a real Claude agent

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run demo -- --live --runs 5 --concurrency 3
npm run demo -- --live --model claude-sonnet-5-5 --runs 5
```

`--live` adds a `claude` row for every scenario. **It makes billed API calls** (runs × scenarios × turns). The default model is `claude-opus-5-5`.

The model is given only the task text and the twin's tools (plus a `report_result` tool for its own verdict). It never sees the scenario spec. Tool errors (409, 422, 429…) go back to it as `is_error` results, so it can recover or not, exactly as in production.

## Layout

| Path | What it does |
| --- | --- |
| `src/twin.ts` | `Twin`, `Agent`, `ToolSpec`, `TwinError`, shared call instrumentation |
| `src/twins/helpdesk.ts` | Helpdesk + refunds twin (409 on closed tickets, 422 on over-refunds, 429 rate limit, reply → "pending") |
| `src/twins/crm.ts` | CRM twin (email de-dupe, deals advance one stage at a time, amount required to win, won/lost are final, no deleting contacts with open deals) |
| `src/diff.ts` | Snapshot diff into leaf-level `Change`s |
| `src/verify.ts` | Required / allowed / collateral check |
| `src/scenario.ts`, `src/scenarios/` | Scenario definitions per twin |
| `src/runner.ts` | Runs one agent on one scenario, returns a `RunResult` |
| `src/batch.ts` | `runMany`: N runs, pass rate, Wilson interval, failure-mode tally |
| `src/adapters/claude.ts` | `claudeAgent` (tool-use loop over a twin's `toolSpecs`) and `anthropicCall` (the real API call) |
| `src/agents/` | Scripted stand-in agents (no API keys needed) |
| `src/cli.ts` | Demo report |

## Adding a twin

1. Model the system as state keyed by id (not arrays), so diff paths stay stable.
2. Write typed tool functions wrapped with `createInstrumenter`, and reproduce the quirks real integrations have that agents get wrong.
3. Describe the tools as `ToolSpec`s so LLM agents can use them.
4. Write scenarios with `required` and `allowed` paths, and a careful and a sloppy scripted agent as controls: the careful one must pass or the twin/spec is wrong.

## Notes

- `claudeAgent` takes its network call as an argument, so the loop is fully tested with a scripted fake model. The live path (`anthropicCall`) has not been exercised in CI because it needs a key.
- With the default settings, `anthropicCall` asks the API to fall back to another model if a request is declined by safety classifiers (`fallbacks: "default"`). Pass `fallbacks: false` to turn that off.

## Next steps

1. Compare two agent versions (or two models) head to head: regression runs.
2. Persist runs and add a results dashboard (Supabase + Next.js), once the engine proves useful.
3. An OpenAI adapter next to the Claude one.
4. Go deep on a third twin, and check each twin's fidelity against the real API.
