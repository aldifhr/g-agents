import type { SpaceResponse } from "@agent-chat/shared";
import type { Store } from "../database/store.js";
import type { ApiApp } from "../platform/http-helpers.js";

/** The whole space in one read: every agent and every conversation. */
export function createSpaceRoutes(app: ApiApp, store: Store) {
  app.get("/api/space", async (context) => {
    const body: SpaceResponse = { space: await store.getSpace(), revision: await store.getRevision() };
    return context.json(body, 200, { "Cache-Control": "no-store" });
  });
}
