import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
/** `apps/api`, whether running from `src/platform/` or `dist/platform/`. */
const apiRoot = path.resolve(moduleDirectory, "..", "..");

export type AppConfig = {
  dataDirectory: string;
  /** Postgres connection string, e.g. postgres://user:pass@127.0.0.1:5432/agent_chat. */
  databaseUrl: string;
  encryptionKeyPath: string;
  /** Raw AGENTCHAT_ENCRYPTION_KEY value (base64, 32 bytes) or "" when unset. */
  encryptionKeyBase64: string;
  host: string;
  port: number;
  /** Exact browser origins allowed to call the API with credentials. */
  webOrigins: string[];
  bodyLimitBytes: number;
  providerTimeoutMs: number;
  providerMaxResponseBytes: number;
  /** Completion tokens requested per provider answer. */
  providerMaxTokens: number;
  /**
   * Maximum reply rounds in a group conversation. One round is every active
   * agent answering once; a second lets them react to each other. Zero disables
   * agent-to-agent replies entirely (one round only).
   */
  groupRounds: number;
  /** Hard cap on agent messages produced for one user message. */
  groupMaxTurns: number;
  /** Root every workspace tool is confined to; nothing outside is reachable. */
  sandboxRoot: string;
  /** Wall-clock cap for one tool execution, in milliseconds. */
  toolTimeoutMs: number;
  /** Command the tests tool runs inside the sandbox. */
  testCommand: string;
  /** Maximum model → tool → model round trips per agent turn. */
  toolMaxSteps: number;
};

function readInteger(raw: string | undefined, fallback: number, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readNonNegativeInteger(raw: string | undefined, fallback: number, name: string) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readOrigins(raw: string | undefined) {
  const fallback = "http://localhost:3000,http://127.0.0.1:3000";
  const source = raw === undefined || raw.trim() === "" ? fallback : raw;
  const origins = source
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error(`Invalid web origin: ${origin}`);
      }
      if (url.origin === "null" || !url.protocol.startsWith("http")) {
        throw new Error(`Web origin must be an http/https URL: ${origin}`);
      }
      return url.origin;
    });
  if (origins.includes("*")) {
    throw new Error("AGENTCHAT_WEB_ORIGINS must not use a wildcard.");
  }
  return [...new Set(origins)];
}

/** Loads configuration from the environment, throwing on anything invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDirectory = path.resolve(
    env.AGENTCHAT_DATA_DIR?.trim() || path.join(apiRoot, ".data"),
  );

  return {
    dataDirectory,
    databaseUrl: env.DATABASE_URL?.trim() || "postgres://postgres:postgres@127.0.0.1:5432/agent_chat",
    encryptionKeyPath: path.join(dataDirectory, "encryption.key"),
    encryptionKeyBase64: env.AGENTCHAT_ENCRYPTION_KEY?.trim() ?? "",
    host: env.API_HOST?.trim() || "127.0.0.1",
    port: readInteger(env.API_PORT, 4000, "API_PORT"),
    webOrigins: readOrigins(env.AGENTCHAT_WEB_ORIGINS),
    bodyLimitBytes: readInteger(env.AGENTCHAT_BODY_LIMIT_BYTES, 2_000_000, "AGENTCHAT_BODY_LIMIT_BYTES"),
    providerTimeoutMs: readInteger(env.AGENTCHAT_PROVIDER_TIMEOUT_MS, 45_000, "AGENTCHAT_PROVIDER_TIMEOUT_MS"),
    providerMaxResponseBytes: readInteger(env.AGENTCHAT_PROVIDER_MAX_BYTES, 1_000_000, "AGENTCHAT_PROVIDER_MAX_BYTES"),
    providerMaxTokens: readInteger(env.AGENTCHAT_PROVIDER_MAX_TOKENS, 4096, "AGENTCHAT_PROVIDER_MAX_TOKENS"),
    groupRounds: Math.min(readNonNegativeInteger(env.AGENTCHAT_GROUP_ROUNDS, 1, "AGENTCHAT_GROUP_ROUNDS"), 3),
    groupMaxTurns: Math.min(readInteger(env.AGENTCHAT_GROUP_MAX_TURNS, 8, "AGENTCHAT_GROUP_MAX_TURNS"), 20),
    sandboxRoot: path.resolve(env.AGENTCHAT_SANDBOX_DIR?.trim() || path.resolve(apiRoot, "..", "..")),
    toolTimeoutMs: readInteger(env.AGENTCHAT_TOOL_TIMEOUT_MS, 30_000, "AGENTCHAT_TOOL_TIMEOUT_MS"),
    testCommand: env.AGENTCHAT_TEST_COMMAND?.trim() || "npm test",
    toolMaxSteps: Math.min(readInteger(env.AGENTCHAT_TOOL_MAX_STEPS, 5, "AGENTCHAT_TOOL_MAX_STEPS"), 20),
  };
}
