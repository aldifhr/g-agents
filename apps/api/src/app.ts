import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AppConfig } from "./platform/config.js";
import type { Store } from "./database/store.js";
import { Orchestrator } from "./chat/orchestrator.js";
import { RunEventBus } from "./chat/run-events.js";
import { RunWorker } from "./chat/run-worker.js";
import { ToolRegistry } from "./tools/registry.js";
import { type AppContext, type ApiApp } from "./platform/http-helpers.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createMemoryRoutes } from "./routes/memory.js";
import { createMessageRoutes } from "./routes/messages.js";
import { createProviderRoutes } from "./routes/provider.js";
import { createRunRoutes } from "./routes/runs.js";
import { createSpaceRoutes } from "./routes/space.js";
import { createStreamRoutes } from "./routes/stream.js";
import { createTaskRoutes } from "./routes/tasks.js";

/**
 * Hono application.
 *
 * Security posture (single local user, no auth):
 *  - binds to localhost by default;
 *  - CORS allows only explicitly configured dev origins, with credentials;
 *  - mutating routes require a same-origin browser request;
 *  - every body is size-limited and schema-validated.
 */
export function createApp(store: Store, config: AppConfig) {
  const app: ApiApp = new Hono<AppContext>();
  const tools = new ToolRegistry(config);
  const events = new RunEventBus();
  const orchestrator = new Orchestrator(store, config, tools, events);
  const worker = new RunWorker(orchestrator);

  app.use("*", async (context, next) => {
    context.set("store", store);
    context.set("config", config);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (config.webOrigins.includes(origin) ? origin : undefined),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use(
    "*",
    bodyLimit({
      maxSize: config.bodyLimitBytes,
      onError: (context) =>
        context.json({ error: `Request body exceeds the ${config.bodyLimitBytes} byte limit.` }, 413),
    }),
  );

  app.onError((error, context) => {
    console.error(`${context.req.method} ${context.req.path} failed.`, error);
    return context.json({ error: "A GAgents server error occurred." }, 500);
  });

  app.notFound((context) => context.json({ error: "Endpoint not found." }, 404));

  app.get("/health", (context) =>
    context.json({ status: "ok", service: "gagents-api" }, 200, { "Cache-Control": "no-store" }),
  );

  /** The tool catalog, so the agent settings form offers real checkboxes. */
  app.get("/api/tools", (context) =>
    context.json({ tools: tools.describeAll() }, 200, { "Cache-Control": "no-store" }),
  );

  createAgentRoutes(app, store, config);
  createConversationRoutes(app, store, config);
  createMessageRoutes(app, store, config, orchestrator, worker);
  createProviderRoutes(app, store, config);
  createSpaceRoutes(app, store);
  createRunRoutes(app, store);
  createStreamRoutes(app, store, events);
  createTaskRoutes(app, store, config);
  createMemoryRoutes(app, store, config);
  createArtifactRoutes(app, store, config);

  return app;
}

export type AgentChatApp = ReturnType<typeof createApp>;
