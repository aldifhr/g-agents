import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { pgTable, text, integer, boolean, index, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AppConfig } from "../platform/config.js";

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  color: text("color").notNull().default("violet"),
  initials: text("initials").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const agentProviders = pgTable("agent_providers", {
  agentId: text("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull().default(""),
  model: text("model").notNull().default(""),
  encryptedApiKey: text("encrypted_api_key").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  check("conversations_kind_check", sql`${table.kind} IN ('dm', 'group')`),
  index("conversations_updated").on(table.updatedAt),
]);

export const conversationAgents = pgTable("conversation_agents", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.agentId] }),
  index("conversation_agents_agent").on(table.agentId),
]);

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  sender: text("sender").notNull(),
  author: text("author").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("messages_sender_check", sql`${table.sender} IN ('user', 'agent')`),
  index("messages_conversation_created").on(table.conversationId, table.createdAt),
]);

export const spaceMeta = pgTable("space_meta", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
}, (table) => [check("space_meta_id_check", sql`${table.id} = 1`)]);

export const schema = { agents, agentProviders, conversations, conversationAgents, messages, spaceMeta };

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
