import { createMemorySchema, firstIssueMessage, updateMemorySchema } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Project memory: the decisions, architecture, and rules that persist.
 *
 * Unlike a message or a run, a memory is not tied to a moment — it is the
 * standing context every agent starts from. Reads accept a conversation to
 * return that room's memories plus the project-wide ones.
 */
export function createMemoryRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/memories", async (context) => {
    const conversationId = context.req.query("conversationId") ?? null;
    const includeProject = context.req.query("scope") !== "conversation";
    return context.json(
      { memories: await store.listMemories({ conversationId, includeProject }) },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.post("/api/memories", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = createMemorySchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid memory.") }, 400);
    }
    if (parsed.data.conversationId && !(await store.getConversation(parsed.data.conversationId))) {
      return context.json({ error: "Conversation not found." }, 400);
    }

    const memory = await store.createMemory(parsed.data, "You");
    return context.json({ memory, revision: await store.getRevision() }, 201);
  });

  app.patch("/api/memories/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = updateMemorySchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid memory.") }, 400);
    }

    const memory = await store.updateMemory(context.req.param("id"), parsed.data);
    if (!memory) return context.json({ error: "Memory not found." }, 404);
    return context.json({ memory, revision: await store.getRevision() });
  });

  app.delete("/api/memories/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const removed = await store.deleteMemory(context.req.param("id"));
    if (!removed) return context.json({ error: "Memory not found." }, 404);
    return context.json({ ok: true, revision: await store.getRevision() });
  });
}
