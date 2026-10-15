import { contentTypeEssence, encodeBase64, isJsonType, isTextType, readAllLimited } from "./body";
import type { Config } from "./config";
import { RelayError } from "./errors";
import { applyCors, forwardResponseHeaders, responseHeadersObject } from "./headers";
import type { RelayResult } from "./relay";
import type { RelayRequest, ResponseType } from "./types";
import { VERSION } from "./version";

export interface RequestMeta {
  id: string;
  colo: string;
}

export function healthResponse(request: Request, config: Config, meta: RequestMeta): Response {
  const headers = jsonHeaders(request, config);
  headers.set("x-relay-id", meta.id);
  const body = { ok: true, version: VERSION, colo: meta.colo, time: new Date().toISOString() };
  return new Response(JSON.stringify(body), { headers });
}

export function helpResponse(request: Request, config: Config): Response {
  const headers = jsonHeaders(request, config);
  const body = {
    relay: "cf-relay",
    version: VERSION,
    usage: {
      envelope: "POST / with JSON body { url, method?, headers?, body?, encoding?, options? }",
      compat: "GET /?url=https://example.com&method=GET",
      transparent: "POST /t/api.example.com/v1/items?query=1",
    },
  };
  return new Response(JSON.stringify(body, null, 2), { headers });
}

export function preflightResponse(request: Request, config: Config): Response {
  const headers = new Headers();
  applyCors(headers, request, config.corsOrigins);
  headers.set("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ?? "authorization, content-type, x-relay-key",
  );
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

export function rawResponse(
  result: RelayResult,
  relay: RelayRequest,
  request: Request,
  config: Config,
  meta: RequestMeta,
  totalMs: number,
): Response {
  const headers = forwardResponseHeaders(result.response.headers, relay.options.cookies);
  headers.set("x-relay-id", meta.id);
  headers.set("x-relay-colo", meta.colo);
  headers.set("x-relay-status", String(result.response.status));
  headers.set("x-relay-url", result.finalUrl);
  headers.set("x-relay-ms", String(Math.round(totalMs)));
  applyCors(headers, request, config.corsOrigins);

  return new Response(result.response.body, {
    status: result.response.status,
    statusText: result.response.statusText,
    headers,
  });
}

export async function envelopeResponse(
  result: RelayResult,
  relay: RelayRequest,
  request: Request,
  config: Config,
  meta: RequestMeta,
  totalMs: number,
): Promise<Response> {
  const bytes = await readAllLimited(result.response.body, config.maxBodyBytes, "upstream response");
  const mediaType = contentTypeEssence(result.response.headers.get("content-type"));
  const converted = convertBody(bytes, mediaType, relay.options.responseType);

  const envelope: Record<string, unknown> = {
    ok: true,
    status: result.response.status,
    url: result.finalUrl,
    headers: responseHeadersObject(result.response.headers),
    body: converted.body,
    encoding: converted.encoding,
  };

  const cookies = result.response.headers.getSetCookie();
  if (cookies.length > 0) envelope.cookies = cookies;

  if (relay.options.meta) {
    envelope.timing = { upstreamMs: result.upstreamMs, totalMs: Math.round(totalMs) };
    envelope.relay = { id: meta.id, colo: meta.colo, version: VERSION };
  }

  const headers = jsonHeaders(request, config);
  headers.set("x-relay-id", meta.id);
  headers.set("x-relay-status", String(result.response.status));
  const status = result.response.status === 204 || result.response.status === 304 ? 200 : result.response.status;
  return new Response(JSON.stringify(envelope), { status, headers });
}

export function errorResponse(
  error: unknown,
  request: Request,
  config: Config,
  meta: RequestMeta,
  totalMs: number,
): Response {
  const relayError =
    error instanceof RelayError
      ? error
      : new RelayError("INTERNAL", error instanceof Error ? error.message : "internal error");

  const headers = jsonHeaders(request, config);
  headers.set("x-relay-id", meta.id);
  headers.set("x-relay-colo", meta.colo);
  headers.set("x-relay-ms", String(Math.round(totalMs)));
  if (relayError.code === "RATE_LIMITED") {
    headers.set("retry-after", String(config.rateLimit?.windowSec ?? 60));
  }

  const body = {
    ok: false,
    error: { code: relayError.code, message: relayError.message },
    relay: { id: meta.id, colo: meta.colo },
  };
  return new Response(JSON.stringify(body), { status: relayError.status, headers });
}

function jsonHeaders(request: Request, config: Config): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  applyCors(headers, request, config.corsOrigins);
  return headers;
}

function convertBody(
  bytes: Uint8Array,
  mediaType: string,
  responseType: ResponseType,
): { body: unknown; encoding: "utf8" | "base64" } {
  const text = () => new TextDecoder().decode(bytes);

  if (responseType === "base64") return { body: encodeBase64(bytes), encoding: "base64" };
  if (responseType === "text" || (responseType === "auto" && isTextType(mediaType))) {
    return { body: text(), encoding: "utf8" };
  }
  if (responseType === "json" || (responseType === "auto" && isJsonType(mediaType))) {
    const decoded = text();
    if (decoded === "") return { body: null, encoding: "utf8" };
    try {
      return { body: JSON.parse(decoded), encoding: "utf8" };
    } catch {
      return { body: decoded, encoding: "utf8" };
    }
  }
  return { body: encodeBase64(bytes), encoding: "base64" };
}
