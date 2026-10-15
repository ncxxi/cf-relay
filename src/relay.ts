import { RelayError } from "./errors";
import type { RelayBody, RelayRequest } from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface RelayResult {
  response: Response;
  finalUrl: string;
  upstreamMs: number;
}

export async function performRelay(relay: RelayRequest): Promise<RelayResult> {
  const maxAttempts = relay.stream === null ? relay.options.retry.attempts + 1 : 1;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      const started = performance.now();
      const outcome = await attemptRelay(relay);
      const upstreamMs = Math.round(performance.now() - started);

      if (attempt < maxAttempts && relay.options.retry.statuses.includes(outcome.response.status)) {
        await outcome.response.body?.cancel();
        await sleep(backoffDelay(relay, attempt));
        continue;
      }
      return { ...outcome, upstreamMs };
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      await sleep(backoffDelay(relay, attempt));
    }
  }
}

async function attemptRelay(relay: RelayRequest): Promise<Omit<RelayResult, "upstreamMs">> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, relay.options.timeoutMs);

  try {
    return await relayChain(relay, controller.signal);
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (timedOut) {
      throw new RelayError("UPSTREAM_TIMEOUT", `upstream timed out after ${relay.options.timeoutMs}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RelayError("UPSTREAM_UNREACHABLE", `upstream fetch failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function relayChain(relay: RelayRequest, signal: AbortSignal): Promise<Omit<RelayResult, "upstreamMs">> {
  if (!relay.options.followRedirects) {
    const response = await single(relay, relay.target, relay.method, relay.body ?? relay.stream, "manual", signal, relay.headers);
    return { response, finalUrl: relay.target.href };
  }

  if (relay.stream !== null) {
    const response = await single(relay, relay.target, relay.method, relay.stream, "follow", signal, relay.headers);
    return { response, finalUrl: response.url !== "" ? response.url : relay.target.href };
  }

  return followRedirects(relay, signal);
}

async function followRedirects(relay: RelayRequest, signal: AbortSignal): Promise<Omit<RelayResult, "upstreamMs">> {
  const headers = new Headers(relay.headers);
  let url = relay.target;
  let method = relay.method;
  let body = relay.body;

  for (let hop = 0; ; hop += 1) {
    const response = await single(relay, url, method, body, "manual", signal, headers);
    const location = response.headers.get("location");

    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
      return { response, finalUrl: url.href };
    }
    if (hop >= relay.options.maxRedirects) {
      await response.body?.cancel();
      throw new RelayError("TOO_MANY_REDIRECTS", `exceeded ${relay.options.maxRedirects} redirects`);
    }

    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
      method = "GET";
      body = null;
    }

    await response.body?.cancel();
    url = next;
  }
}

function single(
  relay: RelayRequest,
  url: URL,
  method: string,
  body: RelayBody | ReadableStream<Uint8Array> | null,
  redirect: "manual" | "follow",
  signal: AbortSignal,
  headers: Headers,
): Promise<Response> {
  const init: RequestInit = { method, headers, redirect, signal };
  if (body !== null) init.body = body;
  if (relay.options.cache) {
    init.cf = { cacheTtl: relay.options.cache.ttl, cacheEverything: relay.options.cache.everything };
  }
  return fetch(url, init);
}

function isRetryable(error: unknown): boolean {
  return error instanceof RelayError && (error.code === "UPSTREAM_TIMEOUT" || error.code === "UPSTREAM_UNREACHABLE");
}

function backoffDelay(relay: RelayRequest, attempt: number): number {
  return Math.min(relay.options.retry.backoffMs * 2 ** (attempt - 1), 10_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
