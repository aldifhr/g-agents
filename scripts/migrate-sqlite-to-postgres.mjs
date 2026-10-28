#!/usr/bin/env node
/**
 * One-time data migration: SQLite -> Postgres.
 *
 * Run this AFTER the schema migration has created the tables (start the API
 * once, or `npm run db:migrate --workspace @agent-chat/api`), then:
 *
 *   DATABASE_URL=postgres://user:pass@127.0.0.1:5432/agent_chat \
 *     node scripts/migrate-sqlite-to-postgres.mjs [path/to/agent-chat.sqlite]
 *
 * Rows are inserted with ON CONFLICT DO NOTHING, so re-running is safe.
 * The default SQLite path is apps/api/.data/agent-chat.sqlite.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = process.argv[2] ?? path.resolve(here, "../apps/api/.data/agent-chat.sqlite");

// Optional apps/api/.env, so the script needs nothing but a running Postgres.
try {
  process.loadEnvFile(path.resolve(here, "../apps/api/.env"));
} catch {
  // No .env is fine; the environment itself may carry the configuration.
}

const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/agent_chat";
const sqlite = new DatabaseSync(sqlitePath);
const sql = postgres(databaseUrl);

// Parents before children, so foreign keys never block an insert.
const tables = ["agents", "agent_providers", "conversations", "conversation_agents", "messages", "space_meta"];

let total = 0;
for (const table of tables) {
  const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
  if (rows.length === 0) {
    console.log(`${table}: nothing to copy`);
    continue;
  }
  const columns = Object.keys(rows[0]);
  const values = rows.map((row) => columns.map((column) => (column === "active" ? Boolean(row[column]) : row[column])));
  const placeholders = values
    .map((_, rowIndex) => `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(", ")})`)
    .join(", ");
  const result = await sql.unsafe(
    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    values.flat(),
  );
  total += result.count;
  console.log(`${table}: ${rows.length} rows read, ${result.count} inserted`);
}

console.log(`Done. ${total} rows inserted.`);
await sql.end();
sqlite.close();
