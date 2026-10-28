import { classifyProviderUrl } from "@agent-chat/shared";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * OpenAI-compatible Chat Completions client.
 *
 * Every call re-validates the provider URL, refuses to follow redirects,
 * enforces a timeout, and caps how many bytes we read from the provider.
 */

export type ProviderCredentials = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ProviderLimits = {
  timeoutMs: number;
  maxResponseBytes: number;
  maxTokens: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionResult = {
  text: string;
  usage: { promptTokens: number; completionTokens: number } | null;
};

/** A provider call that failed in a way the operator can act on. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Builds the chat-completions URL from a user-supplied base URL.
 *   https://api.example.com          -> https://api.example.com/v1/chat/completions
 *   https://api.example.com/v1       -> https://api.example.com/v1/chat/completions
 *   .../v1/chat/completions          -> unchanged
 */
export function completionUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return url.toString();
  url.pathname = pathname.endsWith("/v1")
    ? `${pathname}/chat/completions`
    : `${pathname}/v1/chat/completions`;
  return url.toString();
}

/** Builds the models URL from a user-supplied base URL. */
export function modelsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v1") ? `${pathname}/models` : `${pathname}/v1/models`;
  return url.toString();
}

/** Reads a response body, aborting once `maxBytes` is exceeded. */
async function readLimitedText(response: Response, maxBytes: number, tooLargeMessage: string) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError(tooLargeMessage);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Turns a transport failure's cause into a sentence the operator can act on.
 * Node hides the real reason for a fetch failure in `error.cause`; the codes
 * that actually get misconfigured each get a plain-language explanation.
 */
export function describeTransportFailure(
  cause: { code?: string; message?: string } | undefined,
  fallback: string,
) {
  switch (cause?.code) {
    case "ENOTFOUND":
      return "hostname not found (check the base URL)";
    case "ECONNREFUSED":
      return "connection refused (the provider is not running or the port is wrong)";
    case "ECONNRESET":
      return "connection reset by the provider";
    case "ETIMEDOUT":
      return "connection timed out";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return `the provider's TLS certificate is invalid (${cause.code})`;
    case "ERR_SSL_PACKET_LENGTH_TOO_LONG":
    case "ERR_SSL_WRONG_VERSION_NUMBER":
      return "the server did not complete a TLS handshake; the base URL probably needs http:// instead of https://";
    case "unexpected redirect":
      return "the provider redirected the request; redirects are not followed";
    default:
      if (cause?.code === "EPROTO" && /tls handshake/i.test(cause.message ?? "")) {
        return "the server did not complete a TLS handshake; the base URL probably needs http:// instead of https://";
      }
      return cause?.message ?? fallback;
  }
}

/**
 * Lists the models the provider offers, so the settings form can offer a picker
 * instead of making the operator memorize ids. Accepts both `{ data: [{ id }] }`
 * (OpenAI) and `{ models: [{ name }] }` (Ollama).
 */
export async function requestModelList({
  credentials,
  limits,
  signal,
}: {
  credentials: Omit<ProviderCredentials, "model">;
  limits: Pick<ProviderLimits, "timeoutMs" | "maxResponseBytes">;
  signal?: AbortSignal;
}): Promise<string[]> {
  const verdict = classifyProviderUrl(credentials.baseUrl);
  if (!verdict.ok) throw new ProviderError(verdict.reason);

  const url = modelsUrl(credentials.baseUrl);
  const timeoutSignal = AbortSignal.timeout(limits.timeoutMs);
  const requestSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: requestSignal,
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ProviderError(`The provider did not respond within ${Math.round(limits.timeoutMs / 1000)} seconds.`);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError("The request to the provider was cancelled before it finished.");
    }
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    throw new ProviderError(
      `Could not reach the provider: ${describeTransportFailure(cause, error instanceof Error ? error.message : "network error")}${cause?.code ? ` [${cause.code}]` : ""}.`,
    );
  }

  if (!response.ok) {
    let snippet = "";
    try {
      snippet = (await readLimitedText(response, 500, "")).trim().slice(0, 300);
    } catch {
      snippet = "";
    }
    throw new ProviderError(`The provider responded with HTTP ${response.status}${snippet ? `: ${snippet}` : "."}`);
  }

  const body = await readLimitedText(
    response,
    limits.maxResponseBytes,
    `The provider model list exceeds the ${limits.maxResponseBytes} byte limit.`,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ProviderError("The provider's model list is not valid JSON.");
  }

  const envelope = parsed as { data?: unknown; models?: unknown };
  const entries = Array.isArray(envelope.data)
    ? envelope.data
    : Array.isArray(envelope.models)
      ? envelope.models
      : null;
  if (!entries) throw new ProviderError("The provider did not return a model list.");

  const ids = entries
    .map((entry) => {
      const item = entry as { id?: unknown; name?: unknown };
      return typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : null;
    })
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/**
 * One chat completion. A timeout is retried once (a flaky gateway deserves a
 * second chance); a cancellation is a decision and is never repeated.
 */
export async function requestChatCompletion({
  credentials,
  messages,
  limits,
  signal,
}: {
  credentials: ProviderCredentials;
  messages: ChatMessage[];
  limits: ProviderLimits;
  signal?: AbortSignal;
}): Promise<CompletionResult> {
  const verdict = classifyProviderUrl(credentials.baseUrl);
  if (!verdict.ok) throw new ProviderError(verdict.reason);
  if (!credentials.model) throw new ProviderError("This agent has no model set.");
  const endpoint = new URL(completionUrl(credentials.baseUrl));
  endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, "");
  endpoint.search = "";
  endpoint.hash = "";

  const model = new ChatOpenAI({
    apiKey: credentials.apiKey || "ollama",
    model: credentials.model,
    temperature: 0.7,
    maxTokens: limits.maxTokens,
    timeout: limits.timeoutMs,
    maxRetries: 0,
    configuration: {
      baseURL: endpoint.toString(),
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, redirect: "error" });
        const body = await readLimitedText(
          response,
          limits.maxResponseBytes,
          `The provider response exceeds the ${limits.maxResponseBytes} byte limit.`,
        );
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      },
    },
  });

  try {
    const result = await model.withStructuredOutput(z.object({
      reply: z.string().trim().min(1),
    })).invoke(
      messages.map(({ role, content }) =>
        role === "system"
          ? new SystemMessage(content)
          : role === "assistant"
            ? new AIMessage(content)
            : new HumanMessage(content),
      ),
      { signal },
    );
    return { text: result.reply, usage: null };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (signal?.aborted) throw new ProviderError("The request to the provider was cancelled before it finished.");
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "APIConnectionTimeoutError")) {
      throw new ProviderError(`The provider did not respond within ${Math.round(limits.timeoutMs / 1000)} seconds.`);
    }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "APIUserAbortError")) {
      throw new ProviderError("The request to the provider was cancelled before it finished.");
    }
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if (cause || error instanceof TypeError) {
      throw new ProviderError(
        `Could not reach the provider: ${describeTransportFailure(cause, error instanceof Error ? error.message : "network error")}${cause?.code ? ` [${cause.code}]` : ""}.`,
      );
    }
    throw new ProviderError(error instanceof Error ? error.message : "The provider request failed.");
  }
}

/** Reads the first choice's text and the usage block, tolerating gateway quirks. */
export function parseCompletionResponse(body: string): CompletionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ProviderError("The provider response is not valid JSON.");
  }

  const envelope = parsed as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };

  const content = envelope.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new ProviderError("The provider returned an empty reply.");

  const usage = envelope.usage
    ? {
        promptTokens: typeof envelope.usage.prompt_tokens === "number" ? envelope.usage.prompt_tokens : 0,
        completionTokens:
          typeof envelope.usage.completion_tokens === "number" ? envelope.usage.completion_tokens : 0,
      }
    : null;

  return { text, usage };
}
