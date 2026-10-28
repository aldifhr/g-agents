import { generateText, isStepCount, tool, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderCredentials, ProviderLimits } from "../provider/provider.js";
import { completionUrl, ProviderError } from "../provider/provider.js";

/**
 * The tool-calling loop.
 *
 * One turn is a conversation with the model that runs until the model stops
 * asking for tools: it requests a tool, the tool executes here, the result
 * goes back, and the model continues. `maxSteps` is the hard ceiling, so a
 * model that keeps asking can never spin forever.
 *
 * Every executed tool is recorded — that record is both the audit log and the
 * result store, written by the caller. A tool that throws does not fail the
 * turn: its error is captured as the tool result and handed back to the model,
 * which can correct itself on the next step.
 */

/** One executed tool call, ready to be persisted. */
export type ToolCallRecord = {
  tool: string;
  input: string;
  output: string;
  ok: boolean;
  durationMs: number;
};

export type ToolLoopResult = {
  text: string;
  toolCalls: ToolCallRecord[];
  /** Token usage across every step of the loop; null when the provider omits it. */
  usage: { promptTokens: number; completionTokens: number } | null;
};

/** Caps how much of a tool result is kept, so one huge output cannot bloat a row. */
const MAX_RECORDED_OUTPUT = 20_000;

function recordOutput(value: unknown): string {
  const text = typeof value === "string" ? value : safeStringify(value);
  return text.length > MAX_RECORDED_OUTPUT ? `${text.slice(0, MAX_RECORDED_OUTPUT)}\n… truncated` : text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Wraps a tool so every execution is timed and recorded.
 *
 * The wrapper rebuilds the tool with the same description and schema; only the
 * execute path changes, so the model sees an identical tool. A thrown error is
 * recorded as a failed call and re-thrown so the SDK can surface it to the
 * model as the tool result.
 */
function withAudit(name: string, definition: ToolSet[string], records: ToolCallRecord[]): ToolSet[string] {
  const execute = definition.execute as
    | ((input: unknown, options: unknown) => unknown | Promise<unknown>)
    | undefined;
  if (!execute) return definition;
  return tool({
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (input: unknown, options: unknown) => {
      const started = Date.now();
      try {
        const output = await execute(input, options);
        records.push({
          tool: name,
          input: safeStringify(input),
          output: recordOutput(output),
          ok: true,
          durationMs: Date.now() - started,
        });
        return output;
      } catch (error) {
        records.push({
          tool: name,
          input: safeStringify(input),
          output: error instanceof Error ? error.message : String(error),
          ok: false,
          durationMs: Date.now() - started,
        });
        throw error;
      }
    },
  });
}

/** The base URL the model expects: everything up to and including /v1. */
function modelBaseUrl(baseUrl: string): string {
  const endpoint = new URL(completionUrl(baseUrl));
  endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export async function runToolLoop({
  credentials,
  messages,
  tools,
  limits,
  maxSteps,
  signal,
}: {
  credentials: ProviderCredentials;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tools: ToolSet;
  limits: Pick<ProviderLimits, "timeoutMs" | "maxTokens">;
  maxSteps: number;
  signal?: AbortSignal;
}): Promise<ToolLoopResult> {
  const provider = createOpenAICompatible({
    name: "gagents",
    baseURL: modelBaseUrl(credentials.baseUrl),
    apiKey: credentials.apiKey || "ollama",
  });

  const records: ToolCallRecord[] = [];
  const audited: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    audited[name] = withAudit(name, definition, records);
  }

  try {
    const result = await generateText({
      model: provider.languageModel(credentials.model),
      system: messages.find((message) => message.role === "system")?.content,
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content })),
      tools: audited,
      stopWhen: isStepCount(maxSteps),
      abortSignal: signal,
      maxOutputTokens: limits.maxTokens,
    });

    const usage = result.totalUsage
      ? {
          promptTokens: result.totalUsage.inputTokens ?? 0,
          completionTokens: result.totalUsage.outputTokens ?? 0,
        }
      : null;
    return { text: result.text, toolCalls: records, usage };
  } catch (error) {
    // A cancelled turn is the operator's decision, not a provider failure.
    if (signal?.aborted) throw new ProviderError("The request to the provider was cancelled before it finished.");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(error instanceof Error ? error.message : "The provider request failed.");
  }
}
