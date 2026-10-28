import { defineConfig } from "drizzle-kit";

// Optional apps/api/.env, so `npm run db:*` needs nothing but a running Postgres.
try {
  process.loadEnvFile(new URL("./.env", import.meta.url));
} catch {
  // No .env is fine; the environment itself may carry the configuration.
}

export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/agent_chat",
  },
});
