import { z } from "zod";

/**
 * Provider URL safety.
 *
 * The base URL is operator-supplied, so it is checked before every outbound
 * call: only http/https, and only hosts the operator has not flagged as unsafe.
 * A gateway on this machine is legitimate, so loopback is allowed by default.
 */

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

export function classifyProviderUrl(raw: string): UrlVerdict {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "The provider base URL is empty." };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "The provider base URL is not a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "The provider base URL must use http:// or https://." };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal")) {
    return { ok: false, reason: "That host is not reachable as a provider." };
  }

  return { ok: true };
}

export const providerUrlSchema = z
  .string()
  .trim()
  .refine((value) => classifyProviderUrl(value).ok, "The provider base URL is not valid.");
