import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// `GlobalProps.mainModule` is not declared for handler-only Workers, so `exports` is untyped.
const workerExports = exports as unknown as { default: Fetcher };

describe("deployed entry", () => {
  it("serves health", async () => {
    const response = await workerExports.default.fetch("https://relay.test/_health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
