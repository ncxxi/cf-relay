import { createExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../src/index";
import type { RelayEnv } from "../src/types";

export const baseEnv: RelayEnv = { CORS_ORIGINS: "*" };

export function testEnv(overrides: RelayEnv = {}): RelayEnv {
  return { ...baseEnv, ...overrides };
}

export function relay(request: Request, env: RelayEnv = testEnv()): Promise<Response> {
  return worker.fetch(request, env, createExecutionContext());
}

export function jsonRequest(url: string, data: unknown, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, method: init.method ?? "POST", headers, body: JSON.stringify(data) });
}

export interface UpstreamCall {
  url: string;
  method: string;
  headers: Headers;
  redirect: string | undefined;
  cf: unknown;
  signal: AbortSignal | null;
  bodyText(): Promise<string>;
  bodyBytes(): Promise<Uint8Array>;
}

export function mockUpstream(handler: (call: UpstreamCall) => Response | Promise<Response>): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const rawBody = init.body ?? null;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: UpstreamCall = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers: new Headers(init.headers),
      redirect: init.redirect,
      cf: init.cf,
      signal: init.signal ?? null,
      bodyText: async () => (rawBody === null ? "" : new Response(rawBody).text()),
      bodyBytes: async () =>
        rawBody === null ? new Uint8Array(0) : new Uint8Array(await new Response(rawBody).arrayBuffer()),
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

export async function envelopeBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export async function errorCode(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: { code?: unknown } };
  return body.error?.code;
}

export function abortOnSignal(call: UpstreamCall): Promise<Response> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
  });
}
