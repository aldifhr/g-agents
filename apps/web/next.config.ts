import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * How long the rewrite proxy waits for the API before giving up.
 *
 * A group message calls every participant once per round, and each turn can
 * spend the whole provider timeout, so the default 30s proxy limit is too
 * short. This sits above the API's own provider timeout so the proxy is never
 * the component that cuts a legitimate request.
 */
const API_PROXY_TIMEOUT_MS = Number(process.env.AGENTCHAT_PROXY_TIMEOUT_MS?.trim() || 300_000);

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@agent-chat/shared"],
  experimental: {
    proxyTimeout: API_PROXY_TIMEOUT_MS,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const configured = process.env.AGENTCHAT_API_INTERNAL_URL?.trim();
    const apiUrl = (configured || "http://127.0.0.1:4000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
