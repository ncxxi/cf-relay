import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, mockUpstream, relay } from "../helpers";

afterEach(() => vi.unstubAllGlobals());

describe("transparent mode", () => {
  it("forwards method, headers, query and body", async () => {
    const calls = mockUpstream(
      () => new Response("created", { status: 201, headers: { "content-type": "text/plain" } }),
    );

    const response = await relay(
      new Request("https://relay.test/t/api.example.com/v1/items?q=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer x",
          "x-relay-timeout": "5000",
          "accept-encoding": "br",
        },
        body: '{"n":1}',
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("created");
    expect(response.headers.get("x-relay-status")).toBe("201");
    expect(response.headers.get("x-relay-url")).toBe("https://api.example.com/v1/items?q=1");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/items?q=1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer x");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.headers.get("x-relay-timeout")).toBeNull();
    expect(calls[0]!.headers.get("accept-encoding")).toBeNull();
    expect(calls[0]!.redirect).toBe("manual");
    expect(await calls[0]!.bodyText()).toBe('{"n":1}');
  });

  it("accepts a full url in the path and a target override header", async () => {
    const calls = mockUpstream(() => new Response("ok"));

    await relay(new Request("https://relay.test/t/https://api.example.com/full/path"));
    expect(calls[0]!.url).toBe("https://api.example.com/full/path");

    await relay(
      new Request("https://relay.test/t/ignored.example.com/", {
        headers: { "x-relay-target": "https://api.example.com/real" },
      }),
    );
    expect(calls[1]!.url).toBe("https://api.example.com/real");
    expect(calls[1]!.headers.get("x-relay-target")).toBeNull();
  });

  it("passes redirects through by default", async () => {
    mockUpstream(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/x" } }));

    const response = await relay(new Request("https://relay.test/t/api.example.com/old"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://elsewhere.example.com/x");
    expect(response.headers.get("x-relay-status")).toBe("302");
  });

  it("follows redirects when asked", async () => {
    const calls = mockUpstream((call) =>
      call.url.endsWith("/old")
        ? new Response(null, { status: 301, headers: { location: "/new" } })
        : new Response("moved", { headers: { "content-type": "text/plain" } }),
    );

    const response = await relay(
      new Request("https://relay.test/t/api.example.com/old", { headers: { "x-relay-follow": "1" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("moved");
    expect(calls.map((call) => call.url)).toEqual(["https://api.example.com/old", "https://api.example.com/new"]);
  });

  it("strips set-cookie unless cookies are requested", async () => {
    mockUpstream(() => {
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "session=1");
      return new Response("ok", { headers });
    });

    const stripped = await relay(new Request("https://relay.test/t/api.example.com/"));
    expect(stripped.headers.getSetCookie()).toEqual([]);

    const passed = await relay(
      new Request("https://relay.test/t/api.example.com/", { headers: { "x-relay-cookies": "pass" } }),
    );
    expect(passed.headers.getSetCookie()).toEqual(["session=1"]);
  });

  it("rejects incomplete or unknown paths", async () => {
    const bare = await relay(new Request("https://relay.test/t/"));
    expect(bare.status).toBe(400);
    expect(await errorCode(bare)).toBe("BAD_TARGET");

    const unknown = await relay(new Request("https://relay.test/nope"));
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe("NOT_FOUND");
  });
});
