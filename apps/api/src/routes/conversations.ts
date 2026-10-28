import {
  createConversationSchema,
  firstIssueMessage,
  updateConversationSchema,
} from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/** Conversation CRUD and message history. */
export function createConversationRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/conversations", async (context) =>
    context.json({ conversations: await store.listConversations() }, 200, { "Cache-Control": "no-store" }),
  );

  app.get("/api/conversations/:id", async (context) => {
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);
    return context.json(
      { conversation, messages: await store.listMessages(conversation.id) },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.post("/api/conversations", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = createConversationSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid conversation.") }, 400);
    }

    // Every named agent must exist; a dangling id would create a room that can
    // never be answered.
    const existing = await Promise.all(parsed.data.agentIds.map((id) => store.getAgent(id)));
    const missing = parsed.data.agentIds.filter((_, index) => !existing[index]);
    if (missing.length > 0) {
      return context.json({ error: "One or more agents no longer exist." }, 400);
    }

    const conversation = await store.createConversation(parsed.data);
    return context.json({ conversation, revision: await store.getRevision() }, 201);
  });

  app.patch("/api/conversations/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = updateConversationSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid conversation.") }, 400);
    }

    const conversation = await store.updateConversation(context.req.param("id"), parsed.data);
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);
    return context.json({ conversation, revision: await store.getRevision() });
  });

  app.delete("/api/conversations/:id", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const removed = await store.deleteConversation(context.req.param("id"));
    if (!removed) return context.json({ error: "Conversation not found." }, 404);
    return context.json({ ok: true, revision: await store.getRevision() });
  });
}
