import { afterEach, describe, expect, it, vi } from "vitest";
import { mockUpstream, relay } from "../helpers";

afterEach(() => vi.unstubAllGlobals());

describe("compat mode", () => {
  it("relays GET requests via ?url", async () => {
    const calls = mockUpstream(() => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));

    const response = await relay(new Request("https://relay.test/?url=https%3A%2F%2Fapi.example.com%2Fdata"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe('{"ok":true}');

    expect(calls[0]!.url).toBe("https://api.example.com/data");
    expect(calls[0]!.method).toBe("GET");
  });

  it("relays raw POST bodies via ?url", async () => {
    const calls = mockUpstream(() => new Response("ok"));

    const response = await relay(
      new Request("https://relay.test/?url=https://api.example.com/ingest", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([9, 8, 7]),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("content-type")).toBe("application/octet-stream");
    expect(await calls[0]!.bodyBytes()).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("supports query-encoded bodies", async () => {
    const calls = mockUpstream(() => new Response("ok"));

    await relay(new Request("https://relay.test/?url=https://api.example.com/hook&method=POST&body=hello"));
    expect(calls[0]!.method).toBe("POST");
    expect(await calls[0]!.bodyText()).toBe("hello");
  });

  it("maps cache options onto the fetch cf field", async () => {
    const calls = mockUpstream(() => new Response("ok"));

    await relay(new Request("https://relay.test/?url=https://api.example.com/cached&cache=60&cache_all=1"));
    expect(calls[0]!.cf).toEqual({ cacheTtl: 60, cacheEverything: true });
  });

  it("answers CORS preflight requests", async () => {
    const response = await relay(
      new Request("https://relay.test/", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com", "access-control-request-method": "POST" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("serves health and help", async () => {
    const health = await relay(new Request("https://relay.test/_health"));
    expect(health.status).toBe(200);
    expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });

    const help = await relay(new Request("https://relay.test/"));
    expect(help.status).toBe(200);
    expect((await help.json()) as { relay: string }).toMatchObject({ relay: "cf-relay" });
  });
});
