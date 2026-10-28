import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  Agent,
  AgentColor,
  AgentProvider,
  AgentRun,
  ArtifactKind,
  Conversation,
  ConversationKind,
  ConversationSummary,
  Memory,
  MemoryKind,
  MemoryScope,
  Message,
  MessagePart,
  MessageSender,
  MessageStatus,
  Persona,
  Provider,
  Run,
  RunStatus,
  SpaceData,
  Task,
  TaskArtifact,
  TaskStatus,
  ToolCall,
  TurnPolicy,
  UsageEvent,
} from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "../platform/crypto.js";
import type { ToolCallRecord } from "../chat/tool-loop.js";
import {
  agentRuns,
  agents,
  conversationAgents,
  conversations,
  conversationSummaries,
  messages,
  openDatabase,
  personas,
  projectMemory,
  providers,
  runs,
  spaceMeta,
  taskArtifacts,
  tasks,
  toolCalls,
  usageEvents,
} from "./schema.js";

type Database = Awaited<ReturnType<typeof openDatabase>>;

/** Postgres returns `Date` for timestamptz; the wire format is ISO-8601. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isoRequired(value: Date): string {
  return value.toISOString();
}

/** The stored permission is a JSON array; an empty column means every tool. */
function parseToolPermission(stored: string): string[] {
  if (!stored.trim()) return ["*"];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : ["*"];
  } catch {
    return ["*"];
  }
}

/** Narrows a stored kind to the domain union, defaulting to `dm` on drift. */
function toConversationKind(stored: string): ConversationKind {
  return stored === "group" ? "group" : "dm";
}

function toTurnPolicy(stored: string): TurnPolicy {
  return stored === "mentions" || stored === "rounds" ? stored : "single";
}

function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    systemPrompt: row.systemPrompt,
    color: row.color as AgentColor,
    initials: row.initials,
    active: row.active,
    providerId: row.providerId,
    model: row.model,
    personaId: row.personaId,
    tools: parseToolPermission(row.tools),
    createdAt: isoRequired(row.createdAt),
  };
}

function toProvider(row: typeof providers.$inferSelect): Provider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.encryptedApiKey),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

function toPersona(row: typeof personas.$inferSelect): Persona {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    systemPrompt: row.systemPrompt,
    color: row.color as AgentColor,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    runId: row.runId,
    sender: row.senderType as MessageSender,
    agentId: row.agentId,
    author: row.author,
    parts: Array.isArray(row.parts) ? (row.parts as MessagePart[]) : [],
    text: row.text,
    status: row.status as MessageStatus,
    createdAt: isoRequired(row.createdAt),
  };
}

function toRun(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    status: row.status as RunStatus,
    activeAgentId: row.activeAgentId,
    error: row.error,
    startedAt: isoRequired(row.startedAt),
    endedAt: iso(row.endedAt),
  };
}

function toAgentRun(row: typeof agentRuns.$inferSelect): AgentRun {
  return {
    id: row.id,
    runId: row.runId,
    agentId: row.agentId,
    taskId: row.taskId,
    status: row.status as RunStatus,
    error: row.error,
    startedAt: isoRequired(row.startedAt),
    endedAt: iso(row.endedAt),
  };
}

function toUsageEvent(row: typeof usageEvents.$inferSelect): UsageEvent {
  return {
    id: row.id,
    runId: row.runId,
    agentRunId: row.agentRunId,
    providerId: row.providerId,
    model: row.model,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    costMicros: row.costMicros,
    createdAt: isoRequired(row.createdAt),
  };
}

function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    conversationId: row.conversationId,
    title: row.title,
    detail: row.detail,
    status: row.status as TaskStatus,
    assigneeAgentId: row.assigneeAgentId,
    runId: row.runId,
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

function toMemory(row: typeof projectMemory.$inferSelect): Memory {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    conversationId: row.conversationId,
    kind: row.kind as MemoryKind,
    title: row.title,
    body: row.body,
    createdBy: row.createdBy,
    active: row.active,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

function toArtifact(row: typeof taskArtifacts.$inferSelect): TaskArtifact {
  return {
    id: row.id,
    taskId: row.taskId,
    conversationId: row.conversationId,
    runId: row.runId,
    toolCallId: row.toolCallId,
    kind: row.kind as ArtifactKind,
    title: row.title,
    content: row.content,
    createdAt: isoRequired(row.createdAt),
  };
}

function toToolCall(row: typeof toolCalls.$inferSelect): ToolCall {
  return {
    id: row.id,
    conversationId: row.conversationId,
    runId: row.runId,
    tool: row.tool,
    input: row.input,
    output: row.output,
    ok: row.ok,
    durationMs: row.durationMs,
    createdAt: isoRequired(row.createdAt),
  };
}

function toSummary(row: typeof conversationSummaries.$inferSelect): ConversationSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    coversUntilMessageId: row.coversUntilMessageId,
    summary: row.summary,
    tokenCount: row.tokenCount,
    createdAt: isoRequired(row.createdAt),
  };
}

/** The data layer. Drizzle owns typed queries; routes never touch SQL. */
export class Store {
  private constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  /** Connects, applies migrations, loads the encryption key. Fails loudly here. */
  static async create(config: AppConfig): Promise<Store> {
    const db = await openDatabase(config);
    const encryptionKey = loadEncryptionKey({
      keyPath: config.encryptionKeyPath,
      base64: config.encryptionKeyBase64,
    });
    return new Store(db, encryptionKey);
  }

  async close() {
    await this.db.$client.end();
  }

  async getRevision(): Promise<number> {
    const rows = await this.db.select({ revision: spaceMeta.revision }).from(spaceMeta).where(eq(spaceMeta.id, 1));
    return rows[0]?.revision ?? 0;
  }

  private async bumpRevision() {
    await this.db.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
  }

  async getSpace(): Promise<SpaceData> {
    return { agents: await this.listAgents(), conversations: await this.listConversations() };
  }

  // --- Providers -----------------------------------------------------------

  async listProviders(): Promise<Provider[]> {
    const rows = await this.db.select().from(providers).orderBy(asc(providers.createdAt), asc(providers.id));
    return rows.map(toProvider);
  }

  async getProvider(id: string): Promise<Provider | null> {
    const rows = await this.db.select().from(providers).where(eq(providers.id, id));
    const row = rows[0];
    return row ? toProvider(row) : null;
  }

  async createProvider(input: { name: string; baseUrl: string; apiKey?: string }): Promise<Provider> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(providers).values({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      encryptedApiKey: input.apiKey ? encryptSecret(this.encryptionKey, input.apiKey) : "",
      createdAt: now,
      updatedAt: now,
    });
    await this.bumpRevision();
    return (await this.getProvider(id))!;
  }

  async updateProvider(
    id: string,
    patch: { name?: string; baseUrl?: string; apiKey?: string },
  ): Promise<Provider | null> {
    const existing = await this.db.select({ key: providers.encryptedApiKey }).from(providers).where(eq(providers.id, id));
    if (existing.length === 0) return null;
    const encryptedApiKey = patch.apiKey === undefined
      ? existing[0]!.key
      : patch.apiKey ? encryptSecret(this.encryptionKey, patch.apiKey) : "";
    const set: Record<string, unknown> = { encryptedApiKey, updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
    await this.db.update(providers).set(set).where(eq(providers.id, id));
    await this.bumpRevision();
    return this.getProvider(id);
  }

  async deleteProvider(id: string): Promise<boolean> {
    const deleted = await this.db.delete(providers).where(eq(providers.id, id)).returning({ id: providers.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }

  // --- Personas ------------------------------------------------------------

  async listPersonas(): Promise<Persona[]> {
    const rows = await this.db.select().from(personas).orderBy(asc(personas.createdAt), asc(personas.id));
    return rows.map(toPersona);
  }

  async getPersona(id: string): Promise<Persona | null> {
    const rows = await this.db.select().from(personas).where(eq(personas.id, id));
    const row = rows[0];
    return row ? toPersona(row) : null;
  }

  async createPersona(input: {
    name: string;
    role: string;
    systemPrompt: string;
    color: AgentColor;
  }): Promise<Persona> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(personas).values({ id, ...input, createdAt: now, updatedAt: now });
    await this.bumpRevision();
    return (await this.getPersona(id))!;
  }

  async updatePersona(
    id: string,
    patch: Partial<Pick<Persona, "name" | "role" | "systemPrompt" | "color">>,
  ): Promise<Persona | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.systemPrompt !== undefined) set.systemPrompt = patch.systemPrompt;
    if (patch.color !== undefined) set.color = patch.color;
    const updated = await this.db.update(personas).set(set).where(eq(personas.id, id)).returning({ id: personas.id });
    if (updated.length === 0) return null;
    await this.bumpRevision();
    return this.getPersona(id);
  }

  async deletePersona(id: string): Promise<boolean> {
    const deleted = await this.db.delete(personas).where(eq(personas.id, id)).returning({ id: personas.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }

  // --- Agents --------------------------------------------------------------

  async listAgents(): Promise<Agent[]> {
    const rows = await this.db.select().from(agents).orderBy(asc(agents.createdAt), asc(agents.id));
    return rows.map(toAgent);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, id));
    const row = rows[0];
    return row ? toAgent(row) : null;
  }

  async createAgent(input: {
    name: string;
    role: string;
    systemPrompt: string;
    color: AgentColor;
    tools?: string[];
    providerId?: string | null;
    model?: string;
    personaId?: string | null;
  }): Promise<Agent> {
    const id = randomUUID();
    await this.db.insert(agents).values({
      id,
      name: input.name,
      role: input.role,
      systemPrompt: input.systemPrompt,
      color: input.color,
      initials: initialsFrom(input.name),
      active: true,
      providerId: input.providerId ?? null,
      model: input.model ?? "",
      personaId: input.personaId ?? null,
      settings: {},
      tools: input.tools && input.tools.length > 0 ? JSON.stringify(input.tools) : "",
      createdAt: new Date(),
    });
    await this.bumpRevision();
    return (await this.getAgent(id))!;
  }

  async updateAgent(
    id: string,
    patch: Partial<Pick<Agent, "name" | "role" | "systemPrompt" | "color" | "active" | "tools" | "providerId" | "model" | "personaId">>,
  ): Promise<Agent | null> {
    const current = await this.getAgent(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.db.update(agents).set({
      name: next.name,
      role: next.role,
      systemPrompt: next.systemPrompt,
      color: next.color,
      initials: initialsFrom(next.name),
      active: next.active,
      providerId: next.providerId,
      model: next.model,
      personaId: next.personaId,
      tools: next.tools.length > 0 ? JSON.stringify(next.tools) : "",
    }).where(eq(agents.id, id));
    await this.bumpRevision();
    return this.getAgent(id);
  }

  async deleteAgent(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const deleted = await tx.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id });
      if (deleted.length === 0) return false;
      // A room left with no members can never be answered; drop it too. This
      // also sweeps rooms orphaned by earlier deletions.
      const occupied = new Set(
        (await tx.selectDistinct({ conversationId: conversationAgents.conversationId }).from(conversationAgents))
          .map((row) => row.conversationId),
      );
      const all = await tx.select({ id: conversations.id }).from(conversations);
      const orphanIds = all.map((row) => row.id).filter((conversationId) => !occupied.has(conversationId));
      if (orphanIds.length > 0) {
        await tx.delete(conversations).where(inArray(conversations.id, orphanIds));
      }
      await tx.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
      return true;
    });
  }

  /**
   * Undoes a user message whose run produced no reply at all.
   *
   * The message is stored before the run so the agents can see it; when every
   * agent fails, nothing about the send is kept — not the message, not the
   * bumped `updatedAt`. The caller passes the previous `updatedAt` back in.
   */
  async rollbackUserMessage(conversationId: string, messageId: string, previousUpdatedAt: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.id, messageId));
      await tx.update(conversations).set({ updatedAt: new Date(previousUpdatedAt) }).where(eq(conversations.id, conversationId));
      await tx.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
    });
  }

  // --- Agent provider settings (resolved against the shared provider) ------

  /**
   * One agent's connection as the settings form sees it.
   *
   * The provider row holds the base URL and key; the model lives on the agent.
   * An agent with no provider reads as unconfigured, not as an error.
   */
  async getAgentProvider(agentId: string): Promise<AgentProvider | null> {
    const agent = await this.getAgent(agentId);
    if (!agent) return null;
    if (!agent.providerId) return { agentId, baseUrl: "", model: agent.model, hasApiKey: false };
    const provider = await this.getProvider(agent.providerId);
    return {
      agentId,
      baseUrl: provider?.baseUrl ?? "",
      model: agent.model,
      hasApiKey: Boolean(provider?.hasApiKey),
    };
  }

  async getAgentCredentials(agentId: string): Promise<{ baseUrl: string; model: string; apiKey: string } | null> {
    const agent = await this.getAgent(agentId);
    if (!agent || !agent.providerId) return null;
    const rows = await this.db.select().from(providers).where(eq(providers.id, agent.providerId));
    const row = rows[0];
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      model: agent.model,
      apiKey: row.encryptedApiKey ? decryptSecret(this.encryptionKey, row.encryptedApiKey) : "",
    };
  }

  /**
   * Saves one agent's connection: the provider's URL and key, and the model.
   *
   * The provider row is created on first save and reused after, so an agent's
   * settings are self-contained from the form's point of view while the key is
   * still stored once per connection.
   */
  async saveAgentProvider(
    agentId: string,
    input: { baseUrl: string; model: string; apiKey?: string },
  ): Promise<AgentProvider | null> {
    const agent = await this.getAgent(agentId);
    if (!agent) return null;

    let providerId = agent.providerId;
    if (providerId) {
      await this.updateProvider(providerId, { baseUrl: input.baseUrl, apiKey: input.apiKey });
    } else {
      const created = await this.createProvider({
        name: `${agent.name} provider`,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      });
      providerId = created.id;
    }
    await this.db.update(agents).set({ providerId, model: input.model }).where(eq(agents.id, agentId));
    await this.bumpRevision();
    return this.getAgentProvider(agentId);
  }

  // --- Conversations -------------------------------------------------------

  async listConversations(): Promise<Conversation[]> {
    const rows = await this.db.select().from(conversations).orderBy(desc(conversations.updatedAt), desc(conversations.id));
    const members = await this.db.select().from(conversationAgents);
    const membersByConversation = new Map<string, string[]>();
    for (const member of members) {
      const list = membersByConversation.get(member.conversationId) ?? [];
      list.push(member.agentId);
      membersByConversation.set(member.conversationId, list);
    }
    return Promise.all(rows.map((row) => this.mapConversation(row, membersByConversation.get(row.id) ?? [])));
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = await this.db.select().from(conversations).where(eq(conversations.id, id));
    const row = rows[0];
    return row ? this.mapConversation(row, await this.memberIds(id)) : null;
  }

  private async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db.select({ agentId: conversationAgents.agentId })
      .from(conversationAgents).where(eq(conversationAgents.conversationId, conversationId));
    return rows.map((row) => row.agentId);
  }

  private async mapConversation(row: typeof conversations.$inferSelect, agentIds: string[]): Promise<Conversation> {
    const last = await this.db.select().from(messages).where(eq(messages.conversationId, row.id))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
    return {
      id: row.id,
      kind: toConversationKind(row.kind),
      title: row.title,
      turnPolicy: toTurnPolicy(row.turnPolicy),
      createdBy: row.createdBy,
      agentIds,
      createdAt: isoRequired(row.createdAt),
      updatedAt: isoRequired(row.updatedAt),
      lastMessage: last[0] ? toMessage(last[0]) : null,
    };
  }

  async createConversation(input: {
    kind: ConversationKind;
    title: string;
    agentIds: string[];
    createdBy?: string;
  }): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date();
    const title = input.title || (await this.deriveTitle(input.kind, input.agentIds));
    await this.db.transaction(async (tx) => {
      await tx.insert(conversations).values({
        id,
        kind: input.kind,
        title,
        turnPolicy: defaultTurnPolicy(input.kind),
        createdBy: input.createdBy ?? "You",
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
      for (const agentId of input.agentIds) {
        await tx.insert(conversationAgents).values({ conversationId: id, agentId });
      }
    });
    await this.bumpRevision();
    return (await this.getConversation(id))!;
  }

  private async deriveTitle(kind: ConversationKind, agentIds: string[]): Promise<string> {
    if (kind === "dm") return (agentIds[0] ? (await this.getAgent(agentIds[0]))?.name : undefined) ?? "Direct message";
    const loaded = await Promise.all(agentIds.map((id) => this.getAgent(id)));
    const names = loaded.map((agent) => agent?.name).filter((name): name is string => Boolean(name));
    if (names.length === 0) return "New group";
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
  }

  async updateConversation(id: string, patch: { title?: string; agentIds?: string[] }): Promise<Conversation | null> {
    if (!(await this.getConversation(id))) return null;
    await this.db.transaction(async (tx) => {
      if (patch.title !== undefined) await tx.update(conversations).set({ title: patch.title }).where(eq(conversations.id, id));
      if (patch.agentIds) {
        await tx.delete(conversationAgents).where(eq(conversationAgents.conversationId, id));
        for (const agentId of new Set(patch.agentIds)) {
          await tx.insert(conversationAgents).values({ conversationId: id, agentId });
        }
      }
    });
    await this.bumpRevision();
    return this.getConversation(id);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const deleted = await this.db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }

  // --- Messages ------------------------------------------------------------

  async listMessages(conversationId: string, limit = 200): Promise<Message[]> {
    const rows = await this.db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  async addMessage(input: {
    conversationId: string;
    sender: MessageSender;
    agentId: string | null;
    author: string;
    text: string;
    parts?: MessagePart[];
    status?: MessageStatus;
    runId?: string | null;
  }): Promise<Message> {
    const id = randomUUID();
    const createdAt = new Date();
    const parts = input.parts ?? [{ type: "text", text: input.text } satisfies MessagePart];
    const status = input.status ?? "complete";
    const runId = input.runId ?? null;
    await this.db.transaction(async (tx) => {
      await tx.insert(messages).values({
        id,
        conversationId: input.conversationId,
        runId,
        agentId: input.agentId,
        senderType: input.sender,
        author: input.author,
        parts,
        text: input.text,
        status,
        createdAt,
      });
      await tx.update(conversations).set({ updatedAt: createdAt }).where(eq(conversations.id, input.conversationId));
      await tx.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
    });
    return {
      id,
      conversationId: input.conversationId,
      runId,
      sender: input.sender,
      agentId: input.agentId,
      author: input.author,
      parts,
      text: input.text,
      status,
      createdAt: createdAt.toISOString(),
    };
  }

  // --- Runs (run context) --------------------------------------------------

  /**
   * Opens a run. Called before the first agent turn so every tool call and
   * artifact has a run to point at from the moment it is written.
   */
  async startRun(conversationId: string, triggerMessageId: string | null): Promise<Run> {
    const id = randomUUID();
    const startedAt = new Date();
    await this.db.insert(runs).values({
      id,
      conversationId,
      triggerMessageId,
      status: "running",
      activeAgentId: null,
      error: "",
      startedAt,
      endedAt: null,
    });
    return {
      id,
      conversationId,
      triggerMessageId,
      status: "running",
      activeAgentId: null,
      error: "",
      startedAt: startedAt.toISOString(),
      endedAt: null,
    };
  }

  /** Marks which agent is speaking, so a live view can show the current turn. */
  async setRunActiveAgent(runId: string, agentId: string | null) {
    await this.db.update(runs).set({ activeAgentId: agentId }).where(eq(runs.id, runId));
  }

  /** Closes a run with its terminal status and an operator-facing summary. */
  async finishRun(runId: string, status: Exclude<RunStatus, "running">, error = "") {
    await this.db.update(runs).set({
      status,
      error,
      activeAgentId: null,
      endedAt: new Date(),
    }).where(eq(runs.id, runId));
  }

  async getRun(runId: string): Promise<Run | null> {
    const rows = await this.db.select().from(runs).where(eq(runs.id, runId));
    const row = rows[0];
    return row ? toRun(row) : null;
  }

  async listRuns(conversationId: string, limit = 50): Promise<Run[]> {
    const rows = await this.db.select().from(runs)
      .where(eq(runs.conversationId, conversationId))
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .limit(limit);
    return rows.map(toRun);
  }

  /**
   * Reconciles runs left `running` by a crash or restart.
   *
   * A run whose process is gone can never finish, so it is closed as
   * interrupted at boot. Without this a stale `running` row would block the
   * single-flight guard forever.
   */
  async reconcileRunningRuns(): Promise<number> {
    const closed = await this.db.update(runs)
      .set({ status: "interrupted", error: "Interrupted by a server restart.", endedAt: new Date() })
      .where(eq(runs.status, "running"))
      .returning({ id: runs.id });
    return closed.length;
  }

  // --- Agent runs (per-agent execution) ------------------------------------

  async startAgentRun(runId: string, agentId: string | null, taskId: string | null = null): Promise<AgentRun> {
    const id = randomUUID();
    const startedAt = new Date();
    await this.db.insert(agentRuns).values({
      id,
      runId,
      agentId,
      taskId,
      status: "running",
      error: "",
      startedAt,
      endedAt: null,
    });
    return {
      id,
      runId,
      agentId,
      taskId,
      status: "running",
      error: "",
      startedAt: startedAt.toISOString(),
      endedAt: null,
    };
  }

  async finishAgentRun(agentRunId: string, status: Exclude<RunStatus, "running">, error = "") {
    await this.db.update(agentRuns).set({ status, error, endedAt: new Date() }).where(eq(agentRuns.id, agentRunId));
  }

  async listAgentRuns(runId: string): Promise<AgentRun[]> {
    const rows = await this.db.select().from(agentRuns)
      .where(eq(agentRuns.runId, runId))
      .orderBy(asc(agentRuns.startedAt), asc(agentRuns.id));
    return rows.map(toAgentRun);
  }

  // --- Usage (token and cost) ----------------------------------------------

  /** Records one model call: the token and cost ledger. */
  async recordUsage(input: {
    runId: string | null;
    agentRunId: string | null;
    providerId: string | null;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    costMicros?: number | null;
  }): Promise<UsageEvent> {
    const id = randomUUID();
    const createdAt = new Date();
    const totalTokens = input.totalTokens ?? input.promptTokens + input.completionTokens;
    await this.db.insert(usageEvents).values({
      id,
      runId: input.runId,
      agentRunId: input.agentRunId,
      providerId: input.providerId,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens,
      costMicros: input.costMicros ?? null,
      createdAt,
    });
    return {
      id,
      runId: input.runId,
      agentRunId: input.agentRunId,
      providerId: input.providerId,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens,
      costMicros: input.costMicros ?? null,
      createdAt: createdAt.toISOString(),
    };
  }

  async listUsageForRun(runId: string): Promise<UsageEvent[]> {
    const rows = await this.db.select().from(usageEvents)
      .where(eq(usageEvents.runId, runId))
      .orderBy(asc(usageEvents.createdAt), asc(usageEvents.id));
    return rows.map(toUsageEvent);
  }

  /** Totals for one run: tokens and cost, summed across every model call. */
  async summarizeRunUsage(runId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; costMicros: number }> {
    const rows = await this.db.select({
      promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)::int`,
      costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
    }).from(usageEvents).where(eq(usageEvents.runId, runId));
    const row = rows[0];
    return {
      promptTokens: Number(row?.promptTokens ?? 0),
      completionTokens: Number(row?.completionTokens ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
      costMicros: Number(row?.costMicros ?? 0),
    };
  }

  // --- Conversation summaries (context compression) ------------------------

  async listSummaries(conversationId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.select().from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conversationId))
      .orderBy(asc(conversationSummaries.createdAt), asc(conversationSummaries.id));
    return rows.map(toSummary);
  }

  async createSummary(input: {
    conversationId: string;
    coversUntilMessageId: string | null;
    summary: string;
    tokenCount: number;
  }): Promise<ConversationSummary> {
    const id = randomUUID();
    const createdAt = new Date();
    await this.db.insert(conversationSummaries).values({ id, ...input, createdAt });
    await this.bumpRevision();
    return {
      id,
      conversationId: input.conversationId,
      coversUntilMessageId: input.coversUntilMessageId,
      summary: input.summary,
      tokenCount: input.tokenCount,
      createdAt: createdAt.toISOString(),
    };
  }

  // --- Tasks ---------------------------------------------------------------

  async listTasks(conversationId: string): Promise<Task[]> {
    const rows = await this.db.select().from(tasks)
      .where(eq(tasks.conversationId, conversationId))
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    return rows.map(toTask);
  }

  async getTask(taskId: string): Promise<Task | null> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    const row = rows[0];
    return row ? toTask(row) : null;
  }

  async createTask(
    conversationId: string,
    input: { title: string; detail: string; assigneeAgentId: string | null; runId?: string | null },
    createdBy: string,
  ): Promise<Task> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(tasks).values({
      id,
      conversationId,
      title: input.title,
      detail: input.detail,
      assigneeAgentId: input.assigneeAgentId,
      runId: input.runId ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
    await this.bumpRevision();
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, id));
    return toTask(rows[0]!);
  }

  async updateTask(
    taskId: string,
    patch: { title?: string; detail?: string; status?: TaskStatus; assigneeAgentId?: string | null },
  ): Promise<Task | null> {
    const existing = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (existing.length === 0) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.detail !== undefined) set.detail = patch.detail;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.assigneeAgentId !== undefined) set.assigneeAgentId = patch.assigneeAgentId;
    await this.db.update(tasks).set(set).where(eq(tasks.id, taskId));
    await this.bumpRevision();
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    return toTask(rows[0]!);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const deleted = await this.db.delete(tasks).where(eq(tasks.id, taskId)).returning({ id: tasks.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }

  // --- Tool audit -----------------------------------------------------------

  /** Persists one executed tool call: the audit trail and the result store. */
  async recordToolCall(
    conversationId: string | null,
    agentId: string | null,
    record: ToolCallRecord,
    runId: string | null = null,
  ): Promise<ToolCall> {
    const id = randomUUID();
    const createdAt = new Date();
    const input = record.input.slice(0, 4000);
    const output = record.output.slice(0, 20_000);
    await this.db.insert(toolCalls).values({
      id,
      conversationId,
      runId,
      agentId,
      tool: record.tool,
      input,
      output,
      ok: record.ok,
      durationMs: record.durationMs,
      createdAt,
    });
    return {
      id,
      conversationId,
      runId,
      tool: record.tool,
      input,
      output,
      ok: record.ok,
      durationMs: record.durationMs,
      createdAt: createdAt.toISOString(),
    };
  }

  async listToolCalls(conversationId: string): Promise<ToolCall[]> {
    const rows = await this.db.select().from(toolCalls)
      .where(eq(toolCalls.conversationId, conversationId))
      .orderBy(desc(toolCalls.createdAt))
      .limit(200);
    return rows.map(toToolCall);
  }

  async listRunToolCalls(runId: string): Promise<ToolCall[]> {
    const rows = await this.db.select().from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .orderBy(asc(toolCalls.createdAt), asc(toolCalls.id));
    return rows.map(toToolCall);
  }

  // --- Project memory ------------------------------------------------------

  async listMemories(options: { conversationId?: string | null; includeProject?: boolean } = {}): Promise<Memory[]> {
    const rows = await this.db.select().from(projectMemory).orderBy(desc(projectMemory.updatedAt), desc(projectMemory.id));
    const includeProject = options.includeProject ?? true;
    return rows
      .filter((row) => {
        if (row.scope === "project") return includeProject;
        return options.conversationId != null && row.conversationId === options.conversationId;
      })
      .map(toMemory);
  }

  /** The memories active for one conversation: its own plus every project one. */
  async listActiveMemoriesForConversation(conversationId: string): Promise<Memory[]> {
    const rows = await this.db.select().from(projectMemory)
      .where(eq(projectMemory.active, true))
      .orderBy(asc(projectMemory.createdAt), asc(projectMemory.id));
    return rows
      .filter((row) => row.scope === "project" || row.conversationId === conversationId)
      .map(toMemory);
  }

  async createMemory(
    input: { scope: MemoryScope; conversationId: string | null; kind: MemoryKind; title: string; body: string },
    createdBy: string,
  ): Promise<Memory> {
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(projectMemory).values({
      id,
      scope: input.scope,
      conversationId: input.conversationId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      createdBy,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await this.bumpRevision();
    return (await this.getMemory(id))!;
  }

  async getMemory(id: string): Promise<Memory | null> {
    const rows = await this.db.select().from(projectMemory).where(eq(projectMemory.id, id));
    const row = rows[0];
    return row ? toMemory(row) : null;
  }

  async updateMemory(
    id: string,
    patch: { kind?: MemoryKind; title?: string; body?: string; active?: boolean },
  ): Promise<Memory | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.active !== undefined) set.active = patch.active;
    const updated = await this.db.update(projectMemory).set(set).where(eq(projectMemory.id, id)).returning({ id: projectMemory.id });
    if (updated.length === 0) return null;
    await this.bumpRevision();
    return this.getMemory(id);
  }

  async deleteMemory(id: string): Promise<boolean> {
    const deleted = await this.db.delete(projectMemory).where(eq(projectMemory.id, id)).returning({ id: projectMemory.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }

  // --- Task artifacts ------------------------------------------------------

  async listArtifacts(options: { taskId?: string; runId?: string; conversationId?: string }): Promise<TaskArtifact[]> {
    const conditions = [];
    if (options.taskId !== undefined) conditions.push(eq(taskArtifacts.taskId, options.taskId));
    if (options.runId !== undefined) conditions.push(eq(taskArtifacts.runId, options.runId));
    if (options.conversationId !== undefined) conditions.push(eq(taskArtifacts.conversationId, options.conversationId));
    const query = this.db.select().from(taskArtifacts);
    const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query)
      .orderBy(desc(taskArtifacts.createdAt), desc(taskArtifacts.id));
    return rows.map(toArtifact);
  }

  async createArtifact(input: {
    taskId: string | null;
    conversationId: string;
    runId: string | null;
    toolCallId: string | null;
    kind: ArtifactKind;
    title: string;
    content: string;
  }): Promise<TaskArtifact> {
    const id = randomUUID();
    const createdAt = new Date();
    await this.db.insert(taskArtifacts).values({ id, ...input, createdAt });
    await this.bumpRevision();
    return { id, ...input, createdAt: createdAt.toISOString() };
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const deleted = await this.db.delete(taskArtifacts).where(eq(taskArtifacts.id, id)).returning({ id: taskArtifacts.id });
    if (deleted.length > 0) await this.bumpRevision();
    return deleted.length > 0;
  }
}

/** The default turn policy for a room kind. */
function defaultTurnPolicy(kind: ConversationKind): TurnPolicy {
  return kind === "dm" ? "single" : "rounds";
}

/** Two letters from a name, for the avatar when the caller does not set them. */
export function initialsFrom(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}
