import type { Store } from "../database/store.js";
import type { ApiApp } from "../platform/http-helpers.js";

/**
 * Run context reads.
 *
 * A run is the record of one execution of the orchestrator. These endpoints
 * expose it read-only: the run list for a room, and one run with the tool
 * calls and artifacts it produced. Runs are created and closed by the
 * orchestrator, never by a client.
 */
export function createRunRoutes(app: ApiApp, store: Store) {
  app.get("/api/conversations/:id/runs", async (context) => {
    const conversation = await store.getConversation(context.req.param("id"));
    if (!conversation) return context.json({ error: "Conversation not found." }, 404);
    return context.json({ runs: await store.listRuns(conversation.id) }, 200, { "Cache-Control": "no-store" });
  });

  app.get("/api/runs/:runId", async (context) => {
    const run = await store.getRun(context.req.param("runId"));
    if (!run) return context.json({ error: "Run not found." }, 404);
    const [toolCalls, artifacts] = await Promise.all([
      store.listRunToolCalls(run.id),
      store.listArtifacts({ runId: run.id }),
    ]);
    return context.json({ run, toolCalls, artifacts }, 200, { "Cache-Control": "no-store" });
  });
}
