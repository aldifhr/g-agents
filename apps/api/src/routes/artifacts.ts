import { createArtifactSchema, firstIssueMessage } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Task artifacts: the concrete output a task produced.
 *
 * A report, a diff, a log, a test result — the thing a reviewer reads. Kept
 * separate from tool calls because the raw execution noise and the curated
 * deliverable are different objects with different lifetimes.
 */
export function createArtifactRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/conversations/:id/artifacts", async (context) => {
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);
    return context.json(
      { artifacts: await store.listArtifacts({ conversationId: conversation.id }) },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.get("/api/tasks/:taskId/artifacts", async (context) => {
    return context.json(
      { artifacts: await store.listArtifacts({ taskId: context.req.param("taskId") }) },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.post("/api/conversations/:id/artifacts", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);

    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = createArtifactSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid artifact.") }, 400);
    }
    if (parsed.data.taskId && !(await store.getTask(parsed.data.taskId))) {
      return context.json({ error: "Task not found." }, 400);
    }
    if (parsed.data.runId && !(await store.getRun(parsed.data.runId))) {
      return context.json({ error: "Run not found." }, 400);
    }

    const artifact = await store.createArtifact({
      taskId: parsed.data.taskId,
      conversationId: conversation.id,
      runId: parsed.data.runId,
      toolCallId: parsed.data.toolCallId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      content: parsed.data.content,
    });
    return context.json({ artifact, revision: await store.getRevision() }, 201);
  });

  app.delete("/api/artifacts/:artifactId", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const removed = await store.deleteArtifact(context.req.param("artifactId"));
    if (!removed) return context.json({ error: "Artifact not found." }, 404);
    return context.json({ ok: true, revision: await store.getRevision() });
  });
}
