import {
  firstIssueMessage,
  providerModelsSchema,
  saveProviderSchema,
} from "@agent-chat/shared";
import { requestChatCompletion, requestModelList } from "../provider/provider.js";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { isSameOrigin, readJson, type ApiApp } from "../platform/http-helpers.js";

/**
 * Per-agent LLM settings.
 *
 * Each agent talks to its own OpenAI-compatible endpoint. The API key is stored
 * encrypted and never echoed back; the client only learns whether one is set.
 */
export function createProviderRoutes(app: ApiApp, store: Store, config: AppConfig) {
  app.get("/api/agents/:id/provider", async (context) => {
    const settings = await store.getAgentProvider(context.req.param("id"));
    if (!settings) return context.json({ error: "Agent not found." }, 404);
    return context.json(settings, 200, { "Cache-Control": "no-store" });
  });

  app.put("/api/agents/:id/provider", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The change request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = saveProviderSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid LLM settings.") }, 400);
    }

    const agentId = context.req.param("id");
    const settings = await store.saveAgentProvider(agentId, parsed.data);
    if (!settings) return context.json({ error: "Agent not found." }, 404);
    return context.json({ settings, revision: await store.getRevision() });
  });

  /** Lists the models this agent's provider offers, for the settings picker. */
  app.post("/api/agents/:id/provider/models", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = providerModelsSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid LLM settings.") }, 400);
    }

    const agentId = context.req.param("id");
    if (!(await store.getAgent(agentId))) return context.json({ error: "Agent not found." }, 404);

    const apiKey = parsed.data.apiKey || (await store.getAgentCredentials(agentId))?.apiKey;
    if (!apiKey) return context.json({ error: "An API key is required to list the models." }, 400);

    try {
      const models = await requestModelList({
        credentials: { baseUrl: parsed.data.baseUrl, apiKey },
        limits: {
          timeoutMs: config.providerTimeoutMs,
          maxResponseBytes: config.providerMaxResponseBytes,
        },
      });
      return context.json({ models });
    } catch (error) {
      console.error(`Listing models for agent ${agentId} failed.`, error);
      return context.json(
        { error: error instanceof Error ? error.message : "Could not list the models." },
        502,
      );
    }
  });

  /** Tests the agent's provider before it is saved. */
  app.post("/api/agents/:id/provider/test", async (context) => {
    if (!isSameOrigin(config, context.req.raw)) {
      return context.json({ error: "The request must come from this app." }, 403);
    }
    const body = await readJson(context);
    if (!body.ok) return context.json({ error: "Invalid JSON." }, 400);

    const parsed = saveProviderSchema.safeParse(body.value);
    if (!parsed.success) {
      return context.json({ error: firstIssueMessage(parsed.error, "Invalid LLM settings.") }, 400);
    }

    const agentId = context.req.param("id");
    if (!(await store.getAgent(agentId))) return context.json({ error: "Agent not found." }, 404);

    const apiKey = parsed.data.apiKey || (await store.getAgentCredentials(agentId))?.apiKey;
    if (!apiKey) return context.json({ error: "An API key is required to test the connection." }, 400);

    try {
      await requestChatCompletion({
        credentials: { baseUrl: parsed.data.baseUrl, model: parsed.data.model, apiKey },
        messages: [{ role: "user", content: "Reply with OK." }],
        limits: {
          timeoutMs: config.providerTimeoutMs,
          maxResponseBytes: config.providerMaxResponseBytes,
          maxTokens: 16,
        },
      });
      return context.json({ ok: true, model: parsed.data.model });
    } catch (error) {
      console.error(`Provider test failed for agent ${agentId}.`, error);
      return context.json(
        { ok: false, error: error instanceof Error ? error.message : "Provider test failed." },
        502,
      );
    }
  });
}
