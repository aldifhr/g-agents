import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  pgTable,
  text,
  integer,
  boolean,
  index,
  primaryKey,
  check,
  timestamp,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AppConfig } from "../platform/config.js";

/**
 * Timestamp convention: every instant is a `timestamptz`, so ordering and
 * range queries are correct across time zones and DST. The API still serializes
 * them to ISO-8601 strings at the boundary, so the wire format the web client
 * sees is unchanged.
 */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A model connection: one OpenAI-compatible endpoint plus the key to reach it.
 *
 * Providers are their own table so several agents can share one connection and
 * so a key is configured once, not per agent. An agent points at a provider
 * with `provider_id` and names the `model` to use on it.
 */
export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  encryptedApiKey: text("encrypted_api_key").notNull().default(""),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * A persona: a reusable character preset. An agent may adopt one, so a
 * "Reviewer" persona is written once and applied to several agents.
 */
export const personas = pgTable("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  color: text("color").notNull().default("violet"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * An agent: an identity bound to a provider and a model.
 *
 * `settings` is free-form JSON for per-agent knobs (temperature, tool policy
 * overrides, and so on) that do not deserve a column each. The persona fields
 * are denormalized onto the agent so an agent is self-contained even if its
 * persona is later edited or removed.
 */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  color: text("color").notNull().default("violet"),
  initials: text("initials").notNull(),
  active: boolean("active").notNull().default(true),
  providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
  model: text("model").notNull().default(""),
  personaId: text("persona_id").references(() => personas.id, { onDelete: "set null" }),
  /** Per-agent settings as JSON; empty object when unset. */
  settings: jsonb("settings").notNull().default({}),
  /**
   * Tool permissions: a JSON array of tool names the agent may call.
   * Empty means every registered tool is allowed.
   */
  tools: text("tools").notNull().default(""),
  createdAt: instant("created_at").notNull().defaultNow(),
});

/**
 * A conversation: a DM or a group.
 *
 * `turn_policy` names how turns are decided (`single` for a DM, `mentions` or
 * `rounds` for a group), so the orchestrator reads the policy from the room
 * rather than inferring it from `kind` alone. A room with several agents is one
 * thing; whether they all speak or only the ones you call is a setting on it.
 */
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  turnPolicy: text("turn_policy").notNull().default("single"),
  /** "You" for the user, or an agent's name, when a room was created by one. */
  createdBy: text("created_by").notNull().default("You"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [
  check("conversations_kind_check", sql`${table.kind} IN ('dm', 'group')`),
  check("conversations_turn_policy_check", sql`${table.turnPolicy} IN ('single', 'mentions', 'rounds')`),
  index("conversations_updated").on(table.updatedAt),
]);

/**
 * Room membership plus the per-member policy for that room: whether the member
 * may speak, and whether it may act (call tools) here. Membership is a
 * relationship, not just a join row.
 */
export const conversationAgents = pgTable("conversation_agents", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  canSpeak: boolean("can_speak").notNull().default(true),
  canAct: boolean("can_act").notNull().default(true),
  joinedAt: instant("joined_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.agentId] }),
  index("conversation_agents_agent").on(table.agentId),
]);

/**
 * A message: one turn in a conversation.
 *
 * `parts` is the ordered content of the turn as JSON — text, tool calls, tool
 * results, reasoning — so a message can carry more than a flat string. The
 * plain `text` column is kept as a denormalized, indexable rendering of the
 * parts for search and previews. `run_id` ties the turn to the run that
 * produced it; `status` marks whether the turn is complete or still streaming.
 */
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  /** `user` | `agent` | `system`. */
  senderType: text("sender_type").notNull(),
  author: text("author").notNull(),
  /** Ordered content parts as JSON: [{ type: "text", text }, ...]. */
  parts: jsonb("parts").notNull().default([]),
  /** Denormalized plain text of the parts, for search and previews. */
  text: text("text").notNull().default(""),
  /** `complete` | `streaming` | `error`. */
  status: text("status").notNull().default("complete"),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("messages_sender_check", sql`${table.senderType} IN ('user', 'agent', 'system')`),
  check("messages_status_check", sql`${table.status} IN ('complete', 'streaming', 'error')`),
  index("messages_conversation_created").on(table.conversationId, table.createdAt),
  index("messages_run").on(table.runId),
]);

/**
 * Run context: one execution of the orchestrator, from a user send to the last
 * agent reply. This is the anchor every other run-scoped record points at.
 *
 * It is deliberately separate from conversation history. History is what the
 * user reads back later; a run is what happened while one piece of work was in
 * flight — which agents spoke, which tools fired, why it ended. A run outlives
 * the request that started it, so a crash mid-run leaves a `running` row that
 * can be reconciled on the next boot instead of vanishing with the process.
 */
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  /** The user message that triggered the run; null if it was rolled back. */
  triggerMessageId: text("trigger_message_id"),
  /** `running` | `done` | `error` | `interrupted`. */
  status: text("status").notNull().default("running"),
  /** The agent turn currently in flight, for a live view; null between turns. */
  activeAgentId: text("active_agent_id").references(() => agents.id, { onDelete: "set null" }),
  /** Operator-facing summary of how the run ended. */
  error: text("error").notNull().default(""),
  startedAt: instant("started_at").notNull().defaultNow(),
  endedAt: instant("ended_at"),
}, (table) => [
  check("runs_status_check", sql`${table.status} IN ('running', 'done', 'error', 'interrupted')`),
  index("runs_conversation_started").on(table.conversationId, table.startedAt),
]);

/**
 * One agent's execution inside a run: the per-agent unit of work.
 *
 * A group run has one `agent_runs` row per agent turn, so a single agent's
 * failure, latency, and token spend are attributable without digging through
 * the run as a whole. This is also where a task handoff lands: `task_id` names
 * the work this turn was advancing.
 */
export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  taskId: text("task_id"),
  /** `running` | `done` | `error` | `interrupted`. */
  status: text("status").notNull().default("running"),
  error: text("error").notNull().default(""),
  startedAt: instant("started_at").notNull().defaultNow(),
  endedAt: instant("ended_at"),
}, (table) => [
  check("agent_runs_status_check", sql`${table.status} IN ('running', 'done', 'error', 'interrupted')`),
  index("agent_runs_run").on(table.runId),
  index("agent_runs_agent").on(table.agentId),
]);

/**
 * One model call: the token and cost record.
 *
 * Recorded per call, not per run, so a router, a main agent, a reviewer, and a
 * retry are each attributable. `cost_micros` stores cost in millionths of a
 * unit to avoid floating-point money; null when the price is unknown.
 */
export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
  model: text("model").notNull().default(""),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  /** Cost in millionths of the provider's currency; null when unknown. */
  costMicros: bigint("cost_micros", { mode: "number" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  index("usage_events_run").on(table.runId),
  index("usage_events_agent_run").on(table.agentRunId),
]);

/**
 * A compressed summary of a conversation's earlier history.
 *
 * `covers_until_message_id` is the exclusive upper bound: the summary stands in
 * for every message up to and including that id, so a reader knows exactly what
 * the summary replaces and what is still verbatim.
 */
export const conversationSummaries = pgTable("conversation_summaries", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  coversUntilMessageId: text("covers_until_message_id"),
  summary: text("summary").notNull().default(""),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  index("conversation_summaries_conversation").on(table.conversationId, table.createdAt),
]);

/** A unit of work inside a group room: state, assignee, and provenance. */
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  status: text("status").notNull().default("pending"),
  assigneeAgentId: text("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
  /** The run that produced or last advanced this task; null for hand-created. */
  runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
  /** "You" for the user, or the agent's name. */
  createdBy: text("created_by").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [
  check("tasks_status_check", sql`${table.status} IN ('pending', 'in_progress', 'review', 'done')`),
  index("tasks_conversation").on(table.conversationId),
  index("tasks_run").on(table.runId),
]);

/**
 * Every tool call an agent makes: the audit log and the result store.
 * Input and output are kept as text (JSON for input, truncated text for
 * output) so a runaway tool can never bloat a row.
 *
 * `runId` ties a call to the run that made it, which is what lets a task's
 * artifacts be reconstructed later; `conversationId` stays for a cheap room
 * view that does not need to join through runs.
 */
export const toolCalls = pgTable("tool_calls", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  tool: text("tool").notNull(),
  input: text("input").notNull().default(""),
  output: text("output").notNull().default(""),
  ok: boolean("ok").notNull().default(true),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  index("tool_calls_conversation").on(table.conversationId),
  index("tool_calls_run").on(table.runId),
]);

/**
 * Project memory: the decisions, architecture, and rules that persist across
 * conversations. This is not a transcript and not a run — it is the durable
 * knowledge the operator wants every agent to start from.
 *
 * `scope` is `project` for the whole workspace or `conversation` for one room;
 * `kind` separates a decision from an architectural note from a standing rule.
 * A memory is either active or retired, never deleted, so the reasoning behind
 * a past choice stays readable.
 */
export const projectMemory = pgTable("project_memory", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("project"),
  /** Set only when `scope` is `conversation`. */
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  /** `decision` | `architecture` | `rule` | `note`. */
  kind: text("kind").notNull().default("note"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  /** Who recorded it: "You" or an agent's name. */
  createdBy: text("created_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [
  check("project_memory_scope_check", sql`${table.scope} IN ('project', 'conversation')`),
  check("project_memory_kind_check", sql`${table.kind} IN ('decision', 'architecture', 'rule', 'note')`),
  index("project_memory_scope").on(table.scope, table.conversationId),
]);

/**
 * Task artifacts: the concrete output a task produced — a report, a diff, a
 * log, a test result. Kept apart from tool calls because an artifact is a
 * curated deliverable, not raw execution noise: it is what a reviewer reads.
 *
 * `kind` names the shape (`report` | `diff` | `log` | `test_result` | `file`),
 * and `content` holds the payload. `runId` and `toolCallId` record provenance
 * so an artifact can always be traced back to the call that produced it.
 */
export const taskArtifacts = pgTable("task_artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
  toolCallId: text("tool_call_id").references(() => toolCalls.id, { onDelete: "set null" }),
  /** `report` | `diff` | `log` | `test_result` | `file`. */
  kind: text("kind").notNull(),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  check("task_artifacts_kind_check", sql`${table.kind} IN ('report', 'diff', 'log', 'test_result', 'file')`),
  index("task_artifacts_task").on(table.taskId),
  index("task_artifacts_conversation").on(table.conversationId),
  index("task_artifacts_run").on(table.runId),
]);

export const spaceMeta = pgTable("space_meta", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
}, (table) => [check("space_meta_id_check", sql`${table.id} = 1`)]);

export const schema = {
  providers,
  personas,
  agents,
  conversations,
  conversationAgents,
  messages,
  runs,
  agentRuns,
  usageEvents,
  conversationSummaries,
  tasks,
  toolCalls,
  projectMemory,
  taskArtifacts,
  spaceMeta,
};

/** Opens the Postgres pool through Drizzle and applies tracked migrations. */
export async function openDatabase(config: AppConfig) {
  mkdirSync(config.dataDirectory, { recursive: true });
  const client = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const migrationFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  await migrate(db, { migrationsFolder: migrationFolder });
  await db.insert(spaceMeta).values({ id: 1, revision: 0 }).onConflictDoNothing();
  return db;
}
