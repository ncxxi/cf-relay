import { afterEach, describe, expect, it, vi } from "vitest";
import { abortOnSignal, envelopeBody, errorCode, jsonRequest, mockUpstream, relay, testEnv } from "../helpers";

afterEach(() => vi.unstubAllGlobals());

const target = "https://api.example.com/thing";

describe("envelope mode", () => {
  it("relays GET requests and returns a JSON envelope", async () => {
    const calls = mockUpstream(() => Response.json({ hello: "world" }));

    const response = await relay(jsonRequest("https://relay.test/", { url: target }));
    expect(response.status).toBe(200);

    const envelope = await envelopeBody(response);
    expect(envelope).toMatchObject({ ok: true, status: 200, url: target, encoding: "utf8" });
    expect(envelope.body).toEqual({ hello: "world" });
    expect((envelope.headers as Record<string, string>)["content-type"]).toContain("application/json");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(target);
  });

  it("infers POST from a body and forwards headers", async () => {
    const calls = mockUpstream(
      () => new Response("created", { status: 201, headers: { "content-type": "text/plain" } }),
    );

    const response = await relay(
      jsonRequest("https://relay.test/", {
        url: target,
        headers: { authorization: "Bearer abc" },
        body: { name: "Ada" },
      }),
    );

    expect(response.status).toBe(201);
    const envelope = await envelopeBody(response);
    expect(envelope.body).toBe("created");

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer abc");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(await calls[0]!.bodyText()).toBe('{"name":"Ada"}');
  });

  it("decodes base64 request bodies and encodes binary responses", async () => {
    const calls = mockUpstream(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/octet-stream" } }),
    );

    const response = await relay(
      jsonRequest("https://relay.test/", {
        url: target,
        method: "PUT",
        body: btoa("payload"),
        encoding: "base64",
      }),
    );

    const envelope = await envelopeBody(response);
    expect(await calls[0]!.bodyText()).toBe("payload");
    expect(envelope.encoding).toBe("base64");
    expect(atob(envelope.body as string)).toBe("\u0001\u0002\u0003");
  });

  it("honors responseType overrides", async () => {
    mockUpstream(() => new Response('{"n": 1}', { headers: { "content-type": "application/json" } }));

    const response = await relay(
      jsonRequest("https://relay.test/", { url: target, options: { responseType: "text" } }),
    );
    const envelope = await envelopeBody(response);
    expect(envelope.body).toBe('{"n": 1}');
    expect(envelope.encoding).toBe("utf8");
  });

  it("follows redirects and reports the final url", async () => {
    const calls = mockUpstream((call) =>
      call.url.endsWith("/start")
        ? new Response(null, { status: 302, headers: { location: "/finish" } })
        : new Response("done", { headers: { "content-type": "text/plain" } }),
    );

    const response = await relay(jsonRequest("https://relay.test/", { url: "https://api.example.com/start" }));
    const envelope = await envelopeBody(response);

    expect(envelope.url).toBe("https://api.example.com/finish");
    expect(envelope.body).toBe("done");
    expect(calls.map((call) => call.url)).toEqual(["https://api.example.com/start", "https://api.example.com/finish"]);
  });

  it("switches to GET on 303 and strips authorization across origins", async () => {
    const calls = mockUpstream((call) =>
      call.url.startsWith("https://api.example.com")
        ? new Response(null, { status: 303, headers: { location: "https://other.example.com/result" } })
        : new Response("ok", { headers: { "content-type": "text/plain" } }),
    );

    await relay(
      jsonRequest("https://relay.test/", {
        url: "https://api.example.com/submit",
        body: { n: 1 },
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(calls[0]!.method).toBe("POST");
    expect(calls[1]!.method).toBe("GET");
    expect(calls[1]!.headers.get("authorization")).toBeNull();
    expect(await calls[1]!.bodyText()).toBe("");
  });

  it("retries retryable upstream statuses", async () => {
    let attempt = 0;
    mockUpstream(() => (++attempt === 1 ? new Response("down", { status: 503 }) : new Response("ok")));

    const response = await relay(
      jsonRequest("https://relay.test/", { url: target, options: { retry: { attempts: 1 } } }),
    );
    const envelope = await envelopeBody(response);

    expect(envelope.status).toBe(200);
    expect(envelope.body).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("times out slow upstreams", async () => {
    mockUpstream((call) => abortOnSignal(call));

    const response = await relay(jsonRequest("https://relay.test/", { url: target }), testEnv({ TIMEOUT_MS: "20" }));
    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe("UPSTREAM_TIMEOUT");
  });

  it("passes upstream error responses through as ok: true", async () => {
    mockUpstream(() => new Response("nope", { status: 404, headers: { "content-type": "text/plain" } }));

    const response = await relay(jsonRequest("https://relay.test/", { url: target }));
    expect(response.status).toBe(404);

    const envelope = await envelopeBody(response);
    expect(envelope.ok).toBe(true);
    expect(envelope.status).toBe(404);
    expect(envelope.body).toBe("nope");
  });

  it("adds relay metadata when requested", async () => {
    mockUpstream(() => new Response("x"));

    const response = await relay(jsonRequest("https://relay.test/", { url: target, options: { meta: true } }));
    const envelope = await envelopeBody(response);

    expect(envelope.timing).toMatchObject({ upstreamMs: expect.any(Number), totalMs: expect.any(Number) });
    expect(envelope.relay).toMatchObject({ id: expect.any(String), colo: "unknown", version: "0.1.0" });
    expect(response.headers.get("x-relay-id")).toBe((envelope.relay as Record<string, string>).id);
  });

  it("returns the upstream response raw when responseType is stream", async () => {
    mockUpstream(
      () => new Response("streamed", { status: 202, headers: { "content-type": "text/plain", "x-upstream": "yes" } }),
    );

    const response = await relay(
      jsonRequest("https://relay.test/", { url: target, options: { responseType: "stream" } }),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(response.headers.get("x-relay-status")).toBe("202");
    expect(await response.text()).toBe("streamed");
  });

  it("treats stream: true as a shorthand for responseType stream", async () => {
    mockUpstream(() => new Response("data: 1\n\n", { headers: { "content-type": "text/event-stream" } }));

    const response = await relay(jsonRequest("https://relay.test/", { url: target, stream: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-relay-status")).toBe("200");
    expect(await response.text()).toBe("data: 1\n\n");

    const explicit = await relay(
      jsonRequest("https://relay.test/", { url: target, stream: true, options: { responseType: "text" } }),
    );
    expect((await envelopeBody(explicit)).body).toBe("data: 1\n\n");
  });

  it("adds CORS and relay headers to responses", async () => {
    mockUpstream(() => new Response("ok"));

    const response = await relay(jsonRequest("https://relay.test/", { url: target }));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-relay-id")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("applies a default user-agent when none is provided", async () => {
    const calls = mockUpstream(() => new Response("ok"));

    await relay(jsonRequest("https://relay.test/", { url: target }));
    expect(calls[0]!.headers.get("user-agent")).toBe("cf-relay/0.1.0");

    await relay(jsonRequest("https://relay.test/", { url: target, headers: { "user-agent": "custom/1.0" } }));
    expect(calls[1]!.headers.get("user-agent")).toBe("custom/1.0");
  });

  it("rejects invalid envelopes", async () => {
    const badJson = await relay(
      new Request("https://relay.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(badJson.status).toBe(400);
    expect(await errorCode(badJson)).toBe("BAD_REQUEST");

    const noUrl = await relay(
      new Request("https://relay.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(noUrl.status).toBe(400);
    expect(await errorCode(noUrl)).toBe("BAD_REQUEST");

    const blocked = await relay(jsonRequest("https://relay.test/", { url: "http://127.0.0.1:8787/" }));
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe("BLOCKED_TARGET");

    const getWithBody = await relay(jsonRequest("https://relay.test/", { url: target, method: "GET", body: "nope" }));
    expect(getWithBody.status).toBe(400);
    expect(await errorCode(getWithBody)).toBe("BAD_REQUEST");
  });

  it("enforces the body size limit", async () => {
    const response = await relay(
      jsonRequest("https://relay.test/", { url: target, body: "x".repeat(4096) }),
      testEnv({ MAX_BODY_BYTES: "1024" }),
    );
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("BODY_TOO_LARGE");
  });
});

describe("relay key", () => {
  const env = testEnv({ RELAY_KEY: "s3cret" });

  function envelopeRequest(key?: string): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== undefined) headers.set("x-relay-key", key);
    return new Request("https://relay.test/", { method: "POST", headers, body: JSON.stringify({ url: target }) });
  }

  it("rejects requests without a key", async () => {
    const response = await relay(envelopeRequest(), env);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("AUTH_REQUIRED");
  });

  it("rejects requests with a wrong key", async () => {
    const response = await relay(envelopeRequest("nope"), env);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("AUTH_FAILED");
  });

  it("accepts the key from a header or the query string", async () => {
    mockUpstream(() => new Response("ok"));

    const viaHeader = await relay(envelopeRequest("s3cret"), env);
    expect(viaHeader.status).toBe(200);

    const viaQuery = await relay(
      new Request("https://relay.test/?key=s3cret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
      }),
      env,
    );
    expect(viaQuery.status).toBe(200);
  });
});

describe("rate limit", () => {
  it("rejects requests over the configured limit", async () => {
    mockUpstream(() => new Response("ok"));
    const env = testEnv({ RATE_LIMIT: "2/60" });
    const send = () =>
      relay(
        jsonRequest("https://relay.test/", { url: target }, { headers: { "cf-connecting-ip": "203.0.113.42" } }),
        env,
      );

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const limited = await send();
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});
