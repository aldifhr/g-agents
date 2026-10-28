"use client";

import { useEffect, useState } from "react";
import type { Agent, AgentProvider, ProviderModelsResponse, TestProviderResponse } from "@agent-chat/shared";
import { ApiError, apiErrorMessage, apiFetch } from "@/lib/api";
import { Button, Field, TextInput } from "@/components/ui/form";

/**
 * Per-agent LLM settings: base URL, model, API key.
 *
 * The stored key is never returned by the API, so the form shows whether one
 * is set and replaces it only when the user types a new one. "Fetch models"
 * and "Test connection" use the typed key when present, otherwise the stored
 * one — the same precedence the server applies.
 */
export function ProviderModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"save" | "models" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void apiFetch<AgentProvider>(`/api/agents/${encodeURIComponent(agent.id)}/provider`)
      .then((settings) => {
        if (cancelled) return;
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setHasKey(settings.hasApiKey);
      })
      .catch((caught) => {
        if (!cancelled) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const body = {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      };
      const result = await apiFetch<{ settings: AgentProvider }>(
        `/api/agents/${encodeURIComponent(agent.id)}/provider`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      setHasKey(result.settings.hasApiKey);
      setApiKey("");
      setMessage("Saved. This agent will use these settings on its next reply.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the settings.");
    } finally {
      setBusy(null);
    }
  }

  async function fetchModels() {
    setBusy("models");
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<ProviderModelsResponse>(
        `/api/agents/${encodeURIComponent(agent.id)}/provider/models`,
        {
          method: "POST",
          body: JSON.stringify({
            baseUrl: baseUrl.trim(),
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          }),
        },
      );
      setModels(result.models);
      if (result.models.length === 0) setMessage("The provider returned no models.");
    } catch (caught) {
      setModels([]);
      setError(caught instanceof ApiError ? caught.message : "Could not list the models.");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<TestProviderResponse>(
        `/api/agents/${encodeURIComponent(agent.id)}/provider/test`,
        {
          method: "POST",
          body: JSON.stringify({
            baseUrl: baseUrl.trim(),
            model: model.trim(),
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          }),
        },
      );
      setMessage(result.ok ? `Connection works (model: ${result.model}).` : "The test failed.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The test failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) {
    return <p className="py-4 text-center text-sm text-faint">Loading settings…</p>;
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <Field
        label="Base URL"
        hint="Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq, Ollama, LM Studio…"
      >
        <TextInput
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
        />
      </Field>

      <Field label="Model">
        <div className="flex gap-2">
          <TextInput
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gpt-4o-mini"
            list="provider-models"
            className="flex-1"
          />
          <datalist id="provider-models">
            {models.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <Button type="button" variant="ghost" onClick={fetchModels} disabled={busy !== null || !baseUrl.trim()}>
            {busy === "models" ? "…" : "Fetch models"}
          </Button>
        </div>
      </Field>

      <Field
        label="API key"
        hint={hasKey ? "A key is stored. Type a new one to replace it." : "Stored encrypted on this machine only."}
      >
        <TextInput
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={hasKey ? "••••••••••••" : "sk-…"}
          type="password"
          autoComplete="off"
        />
      </Field>

      {models.length > 0 && (
        <div className="rounded-[10px] border border-border bg-surface-2 p-2.5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            {models.length} models available
          </p>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {models.slice(0, 40).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setModel(item)}
                className="rounded-md bg-surface px-2 py-1 text-[10px] text-muted transition-colors hover:text-foreground"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {message && <p className="text-xs text-success">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={testConnection} disabled={busy !== null}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
