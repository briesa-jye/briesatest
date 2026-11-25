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

/** A tool described the way an LLM sees it: name, description, JSON schema, and a runner. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  /** Validate the model's raw input and call the twin. Throws TwinError on bad input or API errors. */
  run(input: Record<string, unknown>): unknown;
}

/**
 * A stateful stand-in for a real business system. The agent only ever sees
 * `tools` (typed, for scripted agents) or `toolSpecs` (schemas, for LLM
 * agents); Briesa Verify reads `snapshot()` before and after to see what
 * actually changed.
 */
export interface Twin<State, Tools> {
  tools: Tools;
  toolSpecs: ToolSpec[];
  snapshot(): State;
  calls: CallRecord[];
}

/** What an agent says about its own run. Verify checks it against the state diff. */
export interface AgentReport {
  success: boolean;
  summary: string;
}

export type Agent<Tools> = (ctx: {
  task: string;
  tools: Tools;
  toolSpecs: ToolSpec[];
}) => Promise<AgentReport>;

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TwinError(400, `"${key}" must be a non-empty string`);
  }
  return value;
}

export function requireNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TwinError(400, `"${key}" must be a number`);
  }
  return value;
}

/**
 * Wrap twin operations so every call is recorded, a call budget is enforced
 * (429), and callers only ever get copies of internal state.
 */
export function createInstrumenter(calls: CallRecord[], rateLimit: number, onCall: () => void) {
  return <A extends unknown[], R>(tool: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      if (calls.length >= rateLimit) {
        calls.push({ tool, args, ok: false, error: "429 rate limit exceeded" });
        throw new TwinError(429, "rate limit exceeded");
      }
      onCall();
      try {
        const result = structuredClone(fn(...args));
        calls.push({ tool, args, ok: true });
        return result;
      } catch (error) {
        calls.push({
          tool,
          args,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
}
