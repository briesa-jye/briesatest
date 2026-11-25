import type { Spec } from "./verify.ts";
import type { Twin } from "./twin.ts";

/** A task for an agent, the world it starts in, and what must (and must not) change. */
export interface Scenario<State, Tools> {
  id: string;
  title: string;
  /** The instruction handed to the agent. */
  task: string;
  /** Builds a fresh twin in its starting state for every run. */
  twin: () => Twin<State, Tools>;
  spec: Spec;
}
