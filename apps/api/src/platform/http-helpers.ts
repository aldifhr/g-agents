import type { Context, Hono } from "hono";
import type { AppConfig } from "./config.js";
import type { Store } from "../database/store.js";

/**
 * Shared route plumbing: the typed Hono environment and the two guards every
 * mutating handler uses — a same-origin check and a safe JSON body reader.
 */

export type AppContext = {
  Variables: {
    store: Store;
    config: AppConfig;
  };
};

export type ApiApp = Hono<AppContext>;

/**
 * A mutating request must come from the app's own origin, so a page on another
 * site cannot drive the local API through the browser.
 */
export function isSameOrigin(config: AppConfig, request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return config.webOrigins.includes(origin);
}

/** Reads and parses a JSON body, returning a discriminated result. */
export async function readJson(
  context: Context<AppContext>,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const value = await context.req.json();
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}
