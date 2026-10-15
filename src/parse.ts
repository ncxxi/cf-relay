import { decodeBase64, readAllLimited } from "./body";
import type { Config } from "./config";
import { RelayError } from "./errors";
import { forwardRequestHeaders } from "./headers";
import type { RelayBody, RelayOptions, RelayRequest, ResponseType, RouteKind } from "./types";

const MAX_TIMEOUT_MS = 300_000;
const MAX_REDIRECTS = 20;
const MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];
const RESPONSE_TYPES: readonly ResponseType[] = ["auto", "json", "text", "base64", "stream"];

export function baseOptions(config: Config, route: RouteKind): RelayOptions {
  return {
    timeoutMs: config.timeoutMs,
    followRedirects: route === "envelope",
    maxRedirects: 5,
    responseType: "auto",
    meta: false,
    cookies: "strip",
    retry: { attempts: 0, backoffMs: 250, statuses: [...DEFAULT_RETRY_STATUSES] },
    cache: null,
  };
}

export function parseTarget(value: string): URL {
  try {
    return new URL(value.trim());
  } catch {
    throw new RelayError("BAD_TARGET", `invalid target url "${value}"`);
  }
}

export function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new RelayError("BAD_REQUEST", `invalid method "${value}"`);
  if (method === "CONNECT" || method === "TRACE") {
    throw new RelayError("METHOD_NOT_ALLOWED", `${method} is not relayed`);
  }
  return method;
}

export async function buildEnvelopeRequest(request: Request, url: URL, config: Config): Promise<RelayRequest> {
  const raw = await readAllLimited(request.body, config.maxBodyBytes, "request body");

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new RelayError("BAD_REQUEST", "envelope body is not valid JSON");
  }
  if (!isRecord(data)) throw new RelayError("BAD_REQUEST", "envelope must be a JSON object");

  const targetValue = pickString(data.url) ?? url.searchParams.get("url");
  if (targetValue === null) throw new RelayError("BAD_REQUEST", "missing target url");
  const target = parseTarget(targetValue);

  const options = baseOptions(config, "envelope");
  applyQueryOptions(options, url);
  applyEnvelopeOptions(options, data.options);

  const body = buildEnvelopeBody(data.body, data.encoding, url);
  const methodValue = pickString(data.method) ?? url.searchParams.get("method");
  const method = methodValue !== null ? normalizeMethod(methodValue) : body.value === null ? "GET" : "POST";
  assertBodyAllowed(method, body.value);

  const headers = new Headers();
  applyHeaderObject(headers, data.headers);
  if (body.value !== null && body.contentType !== null && !headers.has("content-type")) {
    headers.set("content-type", body.contentType);
  }

  return { route: "envelope", target, method, headers, body: body.value, stream: null, options };
}

export function buildCompatRequest(request: Request, url: URL, config: Config): RelayRequest {
  const targetValue = url.searchParams.get("url");
  if (targetValue === null) throw new RelayError("BAD_TARGET", "missing url query parameter");
  const target = parseTarget(targetValue);

  const options = baseOptions(config, "compat");
  applyQueryOptions(options, url);
  applyControlHeaders(options, request.headers);

  const headers = forwardRequestHeaders(request.headers);
  const queryBody = buildQueryBody(url);

  const methodValue = url.searchParams.get("method");
  const method = normalizeMethod(methodValue ?? (queryBody !== null ? "POST" : request.method));
  assertBodyAllowed(method, queryBody);
  if (queryBody !== null) {
    return { route: "compat", target, method, headers, body: queryBody, stream: null, options };
  }
  return { route: "compat", target, method, headers, body: null, stream: request.body, options };
}

export function buildTransparentRequest(request: Request, url: URL, config: Config): RelayRequest {
  const rest = url.pathname.slice("/t/".length) + url.search;
  const override = request.headers.get("x-relay-target");
  const targetValue = override !== null && override.trim() !== "" ? override.trim() : rest;
  if (targetValue === "") throw new RelayError("BAD_TARGET", "missing target in path");
  const target = parseTarget(/^https?:\/\//i.test(targetValue) ? targetValue : `https://${targetValue}`);

  const options = baseOptions(config, "transparent");
  applyControlHeaders(options, request.headers);

  const method = normalizeMethod(request.method);
  const headers = forwardRequestHeaders(request.headers);
  const stream = method === "GET" || method === "HEAD" ? null : request.body;

  return { route: "transparent", target, method, headers, body: null, stream, options };
}

export function applyQueryOptions(options: RelayOptions, url: URL): void {
  const query = url.searchParams;

  const timeout = numberParam(query, "timeout");
  if (timeout !== undefined) options.timeoutMs = clamp(timeout, 1, MAX_TIMEOUT_MS);

  const type = query.get("type");
  if (isResponseType(type)) options.responseType = type;

  const follow = boolParam(query, "follow");
  if (follow !== undefined) options.followRedirects = follow;

  const redirects = numberParam(query, "redirects");
  if (redirects !== undefined) options.maxRedirects = clamp(redirects, 0, MAX_REDIRECTS);

  const cookies = query.get("cookies");
  if (cookies === "strip" || cookies === "pass") options.cookies = cookies;

  const retry = numberParam(query, "retry");
  if (retry !== undefined) options.retry.attempts = clamp(retry, 0, MAX_RETRY_ATTEMPTS);

  applyCacheOptions(options, query.get("cache"), query.get("cache_all"));
}

export function applyControlHeaders(options: RelayOptions, headers: Headers): void {
  const timeout = headers.get("x-relay-timeout");
  if (timeout !== null && Number.isFinite(Number(timeout))) {
    options.timeoutMs = clamp(Number(timeout), 1, MAX_TIMEOUT_MS);
  }

  const follow = headers.get("x-relay-follow");
  if (follow !== null) options.followRedirects = truthy(follow);

  const redirects = headers.get("x-relay-max-redirects");
  if (redirects !== null && Number.isFinite(Number(redirects))) {
    options.maxRedirects = clamp(Number(redirects), 0, MAX_REDIRECTS);
  }

  const retry = headers.get("x-relay-retry");
  if (retry !== null && Number.isFinite(Number(retry))) {
    options.retry.attempts = clamp(Number(retry), 0, MAX_RETRY_ATTEMPTS);
  }

  const cookies = headers.get("x-relay-cookies");
  if (cookies === "strip" || cookies === "pass") options.cookies = cookies;

  applyCacheOptions(options, headers.get("x-relay-cache"), headers.get("x-relay-cache-all"));
}

function applyEnvelopeOptions(options: RelayOptions, value: unknown): void {
  if (!isRecord(value)) return;

  if (typeof value.timeoutMs === "number") options.timeoutMs = clamp(value.timeoutMs, 1, MAX_TIMEOUT_MS);
  if (typeof value.followRedirects === "boolean") options.followRedirects = value.followRedirects;
  if (typeof value.maxRedirects === "number") options.maxRedirects = clamp(value.maxRedirects, 0, MAX_REDIRECTS);
  if (isResponseType(value.responseType)) options.responseType = value.responseType;
  if (typeof value.meta === "boolean") options.meta = value.meta;
  if (value.cookies === "strip" || value.cookies === "pass") options.cookies = value.cookies;

  if (isRecord(value.retry)) {
    if (typeof value.retry.attempts === "number") {
      options.retry.attempts = clamp(value.retry.attempts, 0, MAX_RETRY_ATTEMPTS);
    }
    if (typeof value.retry.backoffMs === "number") {
      options.retry.backoffMs = clamp(value.retry.backoffMs, 0, 10_000);
    }
    if (Array.isArray(value.retry.statuses)) {
      const statuses = value.retry.statuses.filter(
        (status): status is number => typeof status === "number" && status >= 100 && status <= 599,
      );
      if (statuses.length > 0) options.retry.statuses = statuses;
    }
  }

  if (isRecord(value.cache)) {
    const ttl = typeof value.cache.ttl === "number" ? clamp(value.cache.ttl, 1, 31_536_000) : 0;
    if (ttl > 0) options.cache = { ttl, everything: value.cache.everything === true };
  }
}

function applyCacheOptions(options: RelayOptions, ttl: string | null, everything: string | null): void {
  if (ttl === null) return;
  const seconds = Number(ttl);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    options.cache = null;
    return;
  }
  options.cache = { ttl: clamp(seconds, 1, 31_536_000), everything: everything !== null && truthy(everything) };
}

function buildEnvelopeBody(
  body: unknown,
  encoding: unknown,
  url: URL,
): { value: RelayBody; contentType: string | null } {
  const raw = body !== undefined && body !== null ? body : url.searchParams.get("body");
  if (raw === undefined || raw === null || raw === "") return { value: null, contentType: null };

  if (typeof raw === "object") {
    return { value: JSON.stringify(raw), contentType: "application/json" };
  }

  const value = String(raw);
  const requested = typeof encoding === "string" ? encoding : url.searchParams.get("encoding");
  if (requested === "base64") return { value: decodeBase64OrThrow(value), contentType: null };
  return { value, contentType: null };
}

function buildQueryBody(url: URL): RelayBody {
  const raw = url.searchParams.get("body");
  if (raw === null || raw === "") return null;
  const encoding = url.searchParams.get("encoding");
  if (encoding === "base64") return decodeBase64OrThrow(raw);
  return raw;
}

function decodeBase64OrThrow(value: string): Uint8Array {
  try {
    return decodeBase64(value);
  } catch {
    throw new RelayError("BAD_REQUEST", "body is not valid base64");
  }
}

function applyHeaderObject(headers: Headers, value: unknown): void {
  if (!isRecord(value)) return;
  try {
    for (const [name, headerValue] of Object.entries(value)) {
      if (Array.isArray(headerValue)) {
        for (const item of headerValue) headers.append(name, String(item));
      } else if (headerValue !== null && headerValue !== undefined) {
        headers.set(name, String(headerValue));
      }
    }
  } catch {
    throw new RelayError("BAD_REQUEST", "invalid header name or value");
  }
}

function assertBodyAllowed(method: string, body: RelayBody): void {
  if (body !== null && (method === "GET" || method === "HEAD")) {
    throw new RelayError("BAD_REQUEST", `${method} requests cannot carry a body`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isResponseType(value: unknown): value is ResponseType {
  return typeof value === "string" && RESPONSE_TYPES.includes(value as ResponseType);
}

function numberParam(query: URLSearchParams, name: string): number | undefined {
  const value = query.get(name);
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function boolParam(query: URLSearchParams, name: string): boolean | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

function truthy(value: string): boolean {
  return value === "1" || value === "true";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}
