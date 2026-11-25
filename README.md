# Briesa Verify

Proves what an AI agent actually did, not just what it said.

Agents run against **stateful digital twins** of business software (helpdesk, payments, CRM…). Briesa Verify snapshots the twin before and after, diffs the state, and checks the diff against a scenario spec:

- **required**: outcomes that must have happened ("order O-1 refunded in full")
- **allowed**: side effects that are fine (a new email record, an `updatedAt` bump)
- everything else is **collateral damage** ("order O-2 was refunded too")

It also flags **false claims**: the agent reported success, but the state disagrees.

## Run it

Needs Node 24+ (runs TypeScript directly, no build step).

```bash
npm install
npm test          # unit + scenario tests
npm run typecheck
npm run demo      # careful agent vs sloppy agent on the helpdesk twin
```

## Layout

| Path | What it does |
| --- | --- |
| `src/twin.ts` | `Twin`, `Agent` and `TwinError` types |
| `src/twins/helpdesk.ts` | Helpdesk + refunds twin with realistic quirks (409 on closed tickets, 422 on over-refunds, 429 rate limit, reply → "pending") |
| `src/diff.ts` | Snapshot diff into leaf-level `Change`s |
| `src/verify.ts` | Required / allowed / collateral check |
| `src/scenario.ts`, `src/scenarios/` | Scenario definitions |
| `src/runner.ts` | Runs one agent on one scenario, returns a `RunResult` |
| `src/agents/demo.ts` | Scripted stand-in agents (no API keys needed) |
| `src/cli.ts` | Demo report |

## Next steps

1. Real agent adapters: Anthropic and OpenAI tool-use loops that expose a twin's tools to a model.
2. Go deep on one more twin (CRM or email) and check fidelity against the real API.
3. Run each scenario N times and report pass rate, since LLM agents are non-deterministic.
4. Regression runs: compare results between agent versions.
5. Persist runs and add a results dashboard (Supabase + Next.js), once the engine proves useful.

State records must be keyed by id (not arrays) so diff paths stay stable.
