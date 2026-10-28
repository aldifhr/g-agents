import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Store } from "./database/store.js";
import { loadConfig } from "./platform/config.js";

// Optional apps/api/.env, so `npm run dev` needs nothing but a running Postgres.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env is fine; the environment itself may carry the configuration.
}

/**
 * Process entry point: load config, open the store, start the server.
 *
 * A misconfigured environment or an unreachable database fails here, loudly,
 * instead of surfacing as a 500 on the first request.
 */
const config = loadConfig();
const store = await Store.create(config);

// A run left `running` by a crash can never finish; close it at boot so a
// stale row never blocks the single-flight guard for its conversation.
const reconciled = await store.reconcileRunningRuns();
if (reconciled > 0) {
  console.log(`Reconciled ${reconciled} interrupted run(s) left by a previous process.`);
}

const app = createApp(store, config);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`GAgents API listening on http://${config.host}:${info.port}`);
});

function shutdown() {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
