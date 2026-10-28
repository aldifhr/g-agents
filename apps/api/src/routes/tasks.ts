import { createTaskSchema, firstIssueMessage, updateTaskSchema } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Tasks: the durable unit of work inside a room.
 *
 * A task is what survives a run — it carries the state a handoff needs (who is
 * assigned, where it stands) and is the anchor a task artifact hangs off. A
 * task may be created by hand or by a run; either way it outlives the run.
 */
export function createTaskRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/conversations/:id/tasks", async (context) => {
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);
    return context.json({ tasks: await store.listTasks(conversation.id) }, 200, { "Cache-Control": "no-store" });
  });

  app.post("/api/conversations/:id/tasks", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);

    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = createTaskSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid task.") }, 400);
    }

    // A named assignee must exist, or the task can never be handed off.
    if (parsed.data.assigneeAgentId && !(await store.getAgent(parsed.data.assigneeAgentId))) {
      return context.json({ error: "The assigned agent no longer exists." }, 400);
    }
    if (parsed.data.runId && !(await store.getRun(parsed.data.runId))) {
      return context.json({ error: "The referenced run no longer exists." }, 400);
    }

    const task = await store.createTask(conversation.id, parsed.data, "You");
    return context.json({ task, revision: await store.getRevision() }, 201);
  });

  app.patch("/api/tasks/:taskId", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = updateTaskSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid task.") }, 400);
    }
    if (parsed.data.assigneeAgentId && !(await store.getAgent(parsed.data.assigneeAgentId))) {
      return context.json({ error: "The assigned agent no longer exists." }, 400);
    }

    const task = await store.updateTask(context.req.param("taskId"), parsed.data);
    if (!task) return context.json({ error: "Task not found." }, 404);
    return context.json({ task, revision: await store.getRevision() });
  });

  app.delete("/api/tasks/:taskId", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const removed = await store.deleteTask(context.req.param("taskId"));
    if (!removed) return context.json({ error: "Task not found." }, 404);
    return context.json({ ok: true, revision: await store.getRevision() });
  });
}
