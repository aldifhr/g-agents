import { streamSSE } from "hono/streaming";
import type { RunEventBus } from "../chat/run-events.js";
import type { Store } from "../database/store.js";
import type { ApiApp } from "../platform/http-helpers.js";

/**
 * Realtime run progress over Server-Sent Events.
 *
 * A run is long: several agents, several provider calls, tool executions in
 * between. The client should not have to wait for the whole thing. This route
 * subscribes to the run's event channel, which replays what already happened
 * and then follows the live tail — so a client that connects late, or
 * reconnects after a drop, still gets a coherent picture.
 *
 * The stream closes when the run finishes, or when the client disconnects.
 */
export function createStreamRoutes(app: ApiApp, store: Store, events: RunEventBus) {
  app.get("/api/runs/:runId/stream", async (context) => {
    const runId = context.req.param("runId");
    const run = await store.getRun(runId);
    if (!run) return context.json({ error: "Run not found." }, 404);

    return streamSSE(context, async (stream) => {
      // A finished run has no live tail; send its terminal state and close.
      if (run.status !== "running") {
        await stream.writeSSE({ event: "run.finished", data: JSON.stringify({ runId, status: run.status }) });
        return;
      }

      let done: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        done = resolve;
      });

      const unsubscribe = events.subscribe(runId, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        if (event.type === "run.finished") done();
      });

      // A client disconnect ends the stream; the run itself keeps going.
      stream.onAbort(() => {
        unsubscribe();
        done();
      });

      await closed;
      unsubscribe();
    });
  });
}
