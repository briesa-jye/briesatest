import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentReport, ToolSpec } from "../twin.ts";

/**
 * Gives a Claude model a twin's tools and lets it run until it calls
 * `report_result`. The model never sees the verification spec, only the task.
 *
 * The network call is injected (`ModelCall`) so the loop can be tested with a
 * scripted fake; `anthropicCall()` is the real implementation.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";
const REPORT_TOOL_NAME = "report_result";

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface ToolUseBlock extends ContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
}

export interface ModelTool {
  name: string;
  description: string;
  input_schema: ToolSpec["inputSchema"];
}

export interface ModelRequest {
  model: string;
  max_tokens: number;
  system: string;
  tools: ModelTool[];
  messages: ModelMessage[];
}

export interface ModelResponse {
  stop_reason: string | null;
  content: ContentBlock[];
}

export type ModelCall = (request: ModelRequest) => Promise<ModelResponse>;

export interface ClaudeAgentOptions {
  call: ModelCall;
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
}

const SYSTEM_PROMPT = [
  "You are an operations agent working inside a company's business systems.",
  "Use the provided tools to complete the task you are given.",
  `When you are finished, call ${REPORT_TOOL_NAME} with whether the task was fully completed and a one-sentence summary.`,
].join(" ");

const REPORT_TOOL: ModelTool = {
  name: REPORT_TOOL_NAME,
  description: "Call this once when you are done, to report whether the task was fully completed.",
  input_schema: {
    type: "object",
    properties: {
      success: { type: "boolean", description: "True only if the whole task was completed" },
      summary: { type: "string", description: "One sentence on what you did" },
    },
    required: ["success", "summary"],
  },
};

const isToolUse = (block: ContentBlock): block is ToolUseBlock =>
  block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string";

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textOf = (content: ContentBlock[]): string =>
  content
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("")
    .trim();

const fail = (summary: string): AgentReport => ({ success: false, summary });

function parseReport(input: unknown): AgentReport {
  const record = asRecord(input);
  return {
    success: record.success === true,
    summary: typeof record.summary === "string" ? record.summary : "",
  };
}

export function claudeAgent(options: ClaudeAgentOptions): Agent<unknown> {
  const { call, model = DEFAULT_MODEL, maxTurns = 20, maxTokens = 8000 } = options;

  return async ({ task, toolSpecs }) => {
    const specs = new Map(toolSpecs.map((spec) => [spec.name, spec]));
    const tools: ModelTool[] = [
      ...toolSpecs.map((s) => ({
        name: s.name,
        description: s.description,
        input_schema: s.inputSchema,
      })),
      REPORT_TOOL,
    ];
    const messages: ModelMessage[] = [{ role: "user", content: task }];

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await call({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      if (response.stop_reason === "refusal") return fail("The model refused the task.");
      if (response.stop_reason === "max_tokens") return fail("The model ran out of output tokens.");

      // Pass the whole content back, thinking blocks included, unchanged.
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(isToolUse);
      if (toolUses.length === 0) {
        return fail(textOf(response.content) || "The model stopped without reporting a result.");
      }

      let report: AgentReport | undefined;
      const results: ToolResultBlock[] = [];
      for (const use of toolUses) {
        if (use.name === REPORT_TOOL_NAME) {
          report = parseReport(use.input);
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Recorded." });
          continue;
        }
        const spec = specs.get(use.name);
        if (!spec) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Unknown tool: ${use.name}`,
            is_error: true,
          });
          continue;
        }
        try {
          const output = spec.run(asRecord(use.input));
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(output ?? null),
          });
        } catch (error) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: error instanceof Error ? error.message : String(error),
            is_error: true,
          });
        }
      }

      if (report) return report;
      // All results go back together in one user message.
      messages.push({ role: "user", content: results });
    }

    return fail(`The model did not finish within ${maxTurns} turns.`);
  };
}

export interface AnthropicCallOptions {
  client?: Anthropic;
  /** Let the API re-run a safety-declined request on a fallback model. On by default. */
  fallbacks?: boolean;
}

/** The real call: reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment. */
export function anthropicCall(options: AnthropicCallOptions = {}): ModelCall {
  const client = options.client ?? new Anthropic();
  const fallbacks = options.fallbacks ?? true;

  return async (request) => {
    const params = fallbacks
      ? { ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
      : request;
    const response = await client.beta.messages.create(params as never);
    return response as unknown as ModelResponse;
  };
}
