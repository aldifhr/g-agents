import { z } from "zod";

/**
 * Request validation, shared by the API routes.
 *
 * The same schemas guard every mutating endpoint, so a bad body fails with one
 * clear message instead of reaching the database.
 */

export const agentColorSchema = z.enum(["violet", "mint", "peach", "sky", "rose", "amber"]);

export const createAgentSchema = z.object({
  name: z.string().trim().min(1, "An agent needs a name.").max(60),
  role: z.string().trim().max(60).default(""),
  systemPrompt: z.string().trim().max(8000).default(""),
  color: agentColorSchema.default("violet"),
  /** Tool names this agent may call; empty means all of them. */
  tools: z.array(z.string().min(1)).max(32).default([]),
});

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.string().trim().max(60).optional(),
  systemPrompt: z.string().trim().max(8000).optional(),
  color: agentColorSchema.optional(),
  active: z.boolean().optional(),
  tools: z.array(z.string().min(1)).max(32).optional(),
});

export const conversationKindSchema = z.enum(["dm", "group"]);

export const taskStatusSchema = z.enum(["pending", "in_progress", "review", "done"]);

export const createConversationSchema = z
  .object({
    kind: conversationKindSchema,
    title: z.string().trim().max(80).default(""),
    agentIds: z.array(z.string().min(1)).min(1, "Pick at least one agent."),
  })
  .transform((value, ctx) => {
    const ids = [...new Set(value.agentIds)];
    if (value.kind === "dm" && ids.length !== 1) {
      ctx.addIssue({ code: "custom", message: "A direct message has exactly one agent." });
      return z.NEVER;
    }
    return { ...value, agentIds: ids };
  });

export const updateConversationSchema = z.object({
  title: z.string().trim().max(80).optional(),
  agentIds: z.array(z.string().min(1)).min(1).optional(),
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1, "Write a message first.").max(20_000),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "A task needs a title.").max(200),
  detail: z.string().trim().max(4000).default(""),
  assigneeAgentId: z.string().min(1).nullable().default(null),
  runId: z.string().min(1).nullable().default(null),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(4000).optional(),
  status: taskStatusSchema.optional(),
  assigneeAgentId: z.string().min(1).nullable().optional(),
});

/** Project memory. */
export const memoryScopeSchema = z.enum(["project", "conversation"]);
export const memoryKindSchema = z.enum(["decision", "architecture", "rule", "note"]);

export const createMemorySchema = z
  .object({
    scope: memoryScopeSchema.default("project"),
    conversationId: z.string().min(1).nullable().default(null),
    kind: memoryKindSchema.default("note"),
    title: z.string().trim().min(1, "A memory needs a title.").max(200),
    body: z.string().trim().max(20_000).default(""),
  })
  .transform((value, ctx) => {
    if (value.scope === "conversation" && !value.conversationId) {
      ctx.addIssue({ code: "custom", message: "A conversation-scoped memory needs a conversationId." });
      return z.NEVER;
    }
    if (value.scope === "project" && value.conversationId) {
      return { ...value, conversationId: null };
    }
    return value;
  });

export const updateMemorySchema = z.object({
  kind: memoryKindSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(20_000).optional(),
  active: z.boolean().optional(),
});

/** Task artifacts. */
export const artifactKindSchema = z.enum(["report", "diff", "log", "test_result", "file"]);

export const createArtifactSchema = z.object({
  taskId: z.string().min(1).nullable().default(null),
  runId: z.string().min(1).nullable().default(null),
  toolCallId: z.string().min(1).nullable().default(null),
  kind: artifactKindSchema,
  title: z.string().trim().max(200).default(""),
  content: z.string().max(200_000).default(""),
});

/**
 * A base URL is either empty (not configured yet) or an absolute http(s) URL.
 * The provider client re-checks it before every call; this is the first gate.
 */
const baseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === "" || /^https?:\/\//i.test(value), "The base URL must start with http:// or https://.");

export const saveProviderSchema = z.object({
  baseUrl: baseUrlSchema,
  model: z.string().trim().max(200).default(""),
  apiKey: z.string().max(400).optional(),
});

export const providerModelsSchema = z.object({
  baseUrl: baseUrlSchema,
  apiKey: z.string().max(400).optional(),
});

/** Turns a Zod error into the first human-readable message it carries. */
export function firstIssueMessage(error: z.ZodError, fallback: string) {
  const issue = error.issues[0];
  return issue?.message ?? fallback;
}
