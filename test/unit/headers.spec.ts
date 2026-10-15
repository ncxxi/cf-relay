import { describe, expect, it } from "vitest";
import { forwardRequestHeaders, forwardResponseHeaders, responseHeadersObject } from "../../src/headers";

describe("forwardRequestHeaders", () => {
  it("drops hop-by-hop, relay control and Cloudflare headers", () => {
    const source = new Headers({
      accept: "application/json",
      authorization: "Bearer x",
      connection: "keep-alive",
      "x-relay-key": "secret",
      "x-relay-timeout": "1000",
      "cf-connecting-ip": "1.2.3.4",
      "accept-encoding": "gzip",
      "content-length": "10",
    });

    const out = forwardRequestHeaders(source);
    expect(out.get("accept")).toBe("application/json");
    expect(out.get("authorization")).toBe("Bearer x");
    for (const name of [
      "connection",
      "x-relay-key",
      "x-relay-timeout",
      "cf-connecting-ip",
      "accept-encoding",
      "content-length",
    ]) {
      expect(out.get(name), name).toBeNull();
    }
  });
});

describe("forwardResponseHeaders", () => {
  function upstream(): Headers {
    const headers = new Headers({ "content-type": "text/plain", connection: "keep-alive" });
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    return headers;
  }

  it("strips set-cookie by default", () => {
    const out = forwardResponseHeaders(upstream(), "strip");
    expect(out.get("content-type")).toBe("text/plain");
    expect(out.get("connection")).toBeNull();
    expect(out.getSetCookie()).toEqual([]);
  });

  it("keeps set-cookie when cookies are passed", () => {
    const out = forwardResponseHeaders(upstream(), "pass");
    expect(out.getSetCookie()).toEqual(["a=1", "b=2"]);
  });
});

describe("responseHeadersObject", () => {
  it("joins duplicate headers and skips set-cookie", () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("x-multi", "one");
    headers.append("x-multi", "two");
    headers.append("set-cookie", "a=1");

    const object = responseHeadersObject(headers);
    expect(object["content-type"]).toBe("application/json");
    expect(object["x-multi"]).toBe("one, two");
    expect(object["set-cookie"]).toBeUndefined();
  });
});
