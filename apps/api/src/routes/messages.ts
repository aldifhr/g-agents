import { firstIssueMessage, sendMessageSchema } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { ConversationBusyError, type Orchestrator } from "../chat/orchestrator.js";
import type { RunWorker } from "../chat/run-worker.js";
import { ProviderError } from "../provider/provider.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Sending a message.
 *
 * The send only lands when the room can actually answer it: the members and
 * their LLMs are checked before anything is stored, and a run that produces no
 * reply at all is rolled back completely. A message that no agent answered is
 * never left behind — the caller gets an error and retries instead.
 *
 * Two modes:
 *   - sync (default): the run happens inside the request and the replies come
 *     back in the response. Right for a quick DM.
 *   - async (`?mode=async`): the run is handed to the worker and the request
 *     returns 202 at once with the run id. The client follows the run's event
 *     stream for progress. Right for a long audit that would outlive the
 *     connection.
 */
export function createMessageRoutes(
  app: ApiApp,
  store: Store,
  config: AppConfig,
  orchestrator: Orchestrator,
  worker: RunWorker,
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
    // In a chat room the mentions pick who answers, so the text goes along.
    try {
      await orchestrator.prepare(conversation, parsed.data.text);
    } catch (error) {
      if (error instanceof ProviderError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }

    const async = context.req.query("mode") === "async";

    // A room that is already running rejects the second send outright: two
    // runs sharing a transcript would each read a half-written history and
    // append replies the other never saw. The client waits or stops first.
    const busy = async ? orchestrator.isRunning(conversation.id) || worker.isBusy(conversation.id) : orchestrator.isRunning(conversation.id);
    if (busy) {
      return context.json(
        { error: "This conversation is already running. Wait for it to finish or stop it first." },
        409,
      );
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

    // Async: hand the run to the worker and return at once. The run id is the
    // handle the client uses to follow progress over the event stream.
    if (async) {
      const accepted = worker.enqueue({ conversation: current, triggerMessageId: userMessage.id });
      if (!accepted) {
        await store.rollbackUserMessage(conversation.id, userMessage.id, previousUpdatedAt);
        return context.json({ error: "This conversation is already running." }, 409);
      }
      return context.json({ userMessage, runId: null, queued: true, revision: await store.getRevision() }, 202);
    }

    let replies, errors, interrupted, runId;
    try {
      ({ replies, errors, interrupted, runId } = await orchestrator.run(current, {
        triggerMessageId: userMessage.id,
      }));
    } catch (error) {
      // The busy guard can still fire on a race that slipped between the check
      // above and the run's own lock. The send is rolled back so history stays
      // clean, and the caller is told to retry.
      if (error instanceof ConversationBusyError) {
        await store.rollbackUserMessage(conversation.id, userMessage.id, previousUpdatedAt);
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }

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
      runId,
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
