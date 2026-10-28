import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  Agent,
  AgentColor,
  AgentProvider,
  Conversation,
  ConversationKind,
  Message,
  SpaceData,
} from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "../platform/crypto.js";
import { agents, agentProviders, conversationAgents, conversations, messages, openDatabase, spaceMeta } from "./schema.js";

type Database = Awaited<ReturnType<typeof openDatabase>>;

/** The data layer. Drizzle owns typed queries; routes never touch SQL. */
function toAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    systemPrompt: row.systemPrompt,
    color: row.color as AgentColor,
    initials: row.initials,
    active: row.active,
    createdAt: row.createdAt,
  };
}

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

  async listAgents(): Promise<Agent[]> {
    const rows = await this.db.select().from(agents).orderBy(asc(agents.createdAt), asc(agents.id));
    return rows.map(toAgent);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, id));
    const row = rows[0];
    return row ? toAgent(row) : null;
  }

  async createAgent(input: { name: string; role: string; systemPrompt: string; color: AgentColor }): Promise<Agent> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.insert(agents).values({ id, ...input, initials: initialsFrom(input.name), active: true, createdAt });
    await this.bumpRevision();
    return (await this.getAgent(id))!;
  }

  async updateAgent(
    id: string,
    patch: Partial<Pick<Agent, "name" | "role" | "systemPrompt" | "color" | "active">>,
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
      await tx.update(conversations).set({ updatedAt: previousUpdatedAt }).where(eq(conversations.id, conversationId));
      await tx.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
    });
  }

  async getAgentProvider(agentId: string): Promise<AgentProvider | null> {
    if (!(await this.getAgent(agentId))) return null;
    const rows = await this.db.select().from(agentProviders).where(eq(agentProviders.agentId, agentId));
    const row = rows[0];
    return {
      agentId,
      baseUrl: row?.baseUrl ?? "",
      model: row?.model ?? "",
      hasApiKey: Boolean(row?.encryptedApiKey),
    };
  }

  async getAgentCredentials(agentId: string): Promise<{ baseUrl: string; model: string; apiKey: string } | null> {
    const rows = await this.db.select().from(agentProviders).where(eq(agentProviders.agentId, agentId));
    const row = rows[0];
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: row.encryptedApiKey ? decryptSecret(this.encryptionKey, row.encryptedApiKey) : "",
    };
  }

  async saveAgentProvider(agentId: string, input: { baseUrl: string; model: string; apiKey?: string }): Promise<AgentProvider | null> {
    if (!(await this.getAgent(agentId))) return null;
    const existing = await this.db.select({ key: agentProviders.encryptedApiKey })
      .from(agentProviders).where(eq(agentProviders.agentId, agentId));
    const encryptedApiKey = input.apiKey === undefined
      ? existing[0]?.key ?? ""
      : input.apiKey ? encryptSecret(this.encryptionKey, input.apiKey) : "";

    await this.db.insert(agentProviders).values({
      agentId,
      baseUrl: input.baseUrl,
      model: input.model,
      encryptedApiKey,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: agentProviders.agentId,
      set: { baseUrl: input.baseUrl, model: input.model, encryptedApiKey, updatedAt: new Date().toISOString() },
    });
    await this.bumpRevision();
    return this.getAgentProvider(agentId);
  }

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
      kind: row.kind === "group" ? "group" : "dm",
      title: row.title,
      agentIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastMessage: last[0] ? toMessage(last[0]) : null,
    };
  }

  async createConversation(input: { kind: ConversationKind; title: string; agentIds: string[] }): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = input.title || (await this.deriveTitle(input.kind, input.agentIds));
    await this.db.transaction(async (tx) => {
      await tx.insert(conversations).values({ id, kind: input.kind, title, createdAt: now, updatedAt: now });
      for (const agentId of input.agentIds) {
        await tx.insert(conversationAgents).values({ conversationId: id, agentId });
      }
    });
    await this.bumpRevision();
    return (await this.getConversation(id))!;
  }

  private async deriveTitle(kind: ConversationKind, agentIds: string[]): Promise<string> {
    if (kind === "dm") return (agentIds[0] ? (await this.getAgent(agentIds[0]))?.name : undefined) ?? "Direct message";
    const agents = await Promise.all(agentIds.map((id) => this.getAgent(id)));
    const names = agents.map((agent) => agent?.name).filter((name): name is string => Boolean(name));
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

  async listMessages(conversationId: string, limit = 200): Promise<Message[]> {
    const rows = await this.db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  async addMessage(input: {
    conversationId: string;
    sender: "user" | "agent";
    agentId: string | null;
    author: string;
    text: string;
  }): Promise<Message> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.insert(messages).values({ id, ...input, createdAt });
      await tx.update(conversations).set({ updatedAt: createdAt }).where(eq(conversations.id, input.conversationId));
      await tx.update(spaceMeta).set({ revision: sql`${spaceMeta.revision} + 1` }).where(eq(spaceMeta.id, 1));
    });
    return { id, ...input, createdAt };
  }
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sender: row.sender === "user" ? "user" : "agent",
    agentId: row.agentId,
    author: row.author,
    text: row.text,
    createdAt: row.createdAt,
  };
}

/** Two letters from a name, for the avatar when the caller does not set them. */
export function initialsFrom(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}
