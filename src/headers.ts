import type { CookieMode } from "./types";

export const CONTROL_PREFIX = "x-relay-";

const REQUEST_SKIP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-worker",
  "cf-visitor",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

const RESPONSE_SKIP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function forwardRequestHeaders(source: Headers): Headers {
  const out = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (REQUEST_SKIP.has(lower) || lower.startsWith(CONTROL_PREFIX)) continue;
    out.append(lower, value);
  }
  return out;
}

export function forwardResponseHeaders(source: Headers, cookies: CookieMode): Headers {
  const out = new Headers();
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (RESPONSE_SKIP.has(lower)) continue;
    if (lower === "set-cookie" && cookies === "strip") continue;
    out.append(lower, value);
  }
  return out;
}

const EXPOSE_HEADERS = "x-relay-id, x-relay-colo, x-relay-ms, x-relay-status, x-relay-url";

export function responseHeadersObject(source: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (RESPONSE_SKIP.has(lower) || lower === "set-cookie") continue;
    out[lower] = out[lower] ? `${out[lower]}, ${value}` : value;
  }
  return out;
}

export function applyCors(headers: Headers, request: Request, corsOrigins: string[] | "*"): void {
  const origin = request.headers.get("origin");
  if (corsOrigins === "*") {
    headers.set("access-control-allow-origin", "*");
  } else if (origin !== null && corsOrigins.includes(origin.toLowerCase())) {
    headers.set("access-control-allow-origin", origin);
    headers.append("vary", "origin");
  }
  headers.set("access-control-expose-headers", EXPOSE_HEADERS);
}
