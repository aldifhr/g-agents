import {
  createAgentSchema,
  firstIssueMessage,
  updateAgentSchema,
} from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/** Agent CRUD. */
export function createAgentRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/agents", async (context) =>
    context.json({ agents: await store.listAgents() }, 200, { "Cache-Control": "no-store" }),
  );

  app.post("/api/agents", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = createAgentSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid agent.") }, 400);
    }

    const agent = await store.createAgent(parsed.data);
    return context.json({ agent, revision: await store.getRevision() }, 201);
  });

  app.patch("/api/agents/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = updateAgentSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid agent.") }, 400);
    }

    const agent = await store.updateAgent(context.req.param("id"), parsed.data);
    if (!agent) return context.json({ error: "Agent not found." }, 404);
    return context.json({ agent, revision: await store.getRevision() });
  });

  app.delete("/api/agents/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const removed = await store.deleteAgent(context.req.param("id"));
    if (!removed) return context.json({ error: "Agent not found." }, 404);
    return context.json({ ok: true, revision: await store.getRevision() });
  });
}
