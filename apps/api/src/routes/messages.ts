import { firstIssueMessage, sendMessageSchema } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import type { Orchestrator } from "../chat/orchestrator.js";
import { ProviderError } from "../provider/provider.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Sending a message.
 *
 * The send only lands when the room can actually answer it: the members and
 * their LLMs are checked before anything is stored, and a run that produces no
 * reply at all is rolled back completely. A message that no agent answered is
 * never left behind — the caller gets an error and retries instead.
 */
export function createMessageRoutes(
  app: ApiApp,
  store: Store,
  config: AppConfig,
  orchestrator: Orchestrator,
) {
  app.post("/api/conversations/:id/messages", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }

    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);

    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = sendMessageSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid message.") }, 400);
    }

    // Before storing: the room must have an active member with a working LLM.
    // A send that cannot be answered fails here, leaving no trace.
    try {
      await orchestrator.prepare(conversation);
    } catch (error) {
      if (error instanceof ProviderError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }

    const previousUpdatedAt = conversation.updatedAt;
    const userMessage = await store.addMessage({
      conversationId: conversation.id,
      sender: "user",
      agentId: null,
      author: "You",
      text: parsed.data.text,
    });

    // Re-read so the run sees the message that was just stored.
    const current = (await store.getConversation(conversation.id))!;
    const { replies, errors, interrupted } = await orchestrator.run(current);

    // Nothing answered: undo the send entirely so history stays clean and the
    // client can offer a retry instead of a message nobody will ever answer.
    if (replies.length === 0) {
      await store.rollbackUserMessage(conversation.id, userMessage.id, previousUpdatedAt);
      const reason = interrupted
        ? "The run was stopped before any agent replied."
        : errors[0] ?? "No agent could reply.";
      return context.json({ error: reason }, 502);
    }

    return context.json({
      userMessage,
      replies,
      errors,
      interrupted,
      revision: await store.getRevision(),
    });
  });

  /**
   * Stops the run in flight for a conversation.
   *
   * The pending POST settles with `interrupted: true` and the replies that
   * already landed are kept. A stop with nothing running is a no-op, not an
   * error.
   */
  app.post("/api/conversations/:id/stop", (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const stopped = orchestrator.stopRun(context.req.param("id"));
    return context.json({ stopped });
  });
}
