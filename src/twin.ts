/** An error the twin raises the way the real API would (status code + message). */
export class TwinError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TwinError";
    this.status = status;
  }
}

export interface CallRecord {
  tool: string;
  args: unknown[];
  ok: boolean;
  error?: string;
}

/**
 * A stateful stand-in for a real business system. The agent only ever sees
 * `tools`; Briesa Verify reads `snapshot()` before and after to see what
 * actually changed.
 */
export interface Twin<State, Tools> {
  tools: Tools;
  snapshot(): State;
  calls: CallRecord[];
}

/** What an agent says about its own run. Verify checks it against the state diff. */
export interface AgentReport {
  success: boolean;
  summary: string;
}

export type Agent<Tools> = (ctx: { task: string; tools: Tools }) => Promise<AgentReport>;
