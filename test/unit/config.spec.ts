import { describe, expect, it } from "vitest";
import { loadConfig, parseCorsOrigins, parseRateLimit } from "../../src/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({});
    expect(config.relayKey).toBe("");
    expect(config.corsOrigins).toBe("*");
    expect(config.maxBodyBytes).toBe(16 * 1024 * 1024);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.userAgent).toBe("cf-relay/0.1.0");
    expect(config.rateLimit).toBeNull();
    expect(config.allowPrivateTargets).toBe(false);
    expect(config.denyHosts).toEqual([]);
  });

  it("parses overrides", () => {
    const config = loadConfig({
      RELAY_KEY: " secret ",
      CORS_ORIGINS: "https://app.example.com, HTTPS://other.example.com",
      MAX_BODY_BYTES: "1024",
      TIMEOUT_MS: "not-a-number",
      USER_AGENT: "custom/1.0",
      RATE_LIMIT: "120/60",
      ALLOW_PRIVATE_TARGETS: "true",
      DENY_HOSTS: "*.workers.dev,internal.example.com",
    });
    expect(config.relayKey).toBe("secret");
    expect(config.corsOrigins).toEqual(["https://app.example.com", "https://other.example.com"]);
    expect(config.maxBodyBytes).toBe(1024);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.userAgent).toBe("custom/1.0");
    expect(config.rateLimit).toEqual({ count: 120, windowSec: 60 });
    expect(config.allowPrivateTargets).toBe(true);
    expect(config.denyHosts).toEqual(["*.workers.dev", "internal.example.com"]);
  });
});

describe("parseRateLimit", () => {
  it("parses count/window pairs", () => {
    expect(parseRateLimit("30/10")).toEqual({ count: 30, windowSec: 10 });
    expect(parseRateLimit(" 30 / 10 ")).toEqual({ count: 30, windowSec: 10 });
  });

  it("rejects invalid values", () => {
    expect(parseRateLimit("")).toBeNull();
    expect(parseRateLimit(undefined)).toBeNull();
    expect(parseRateLimit("nope")).toBeNull();
    expect(parseRateLimit("0/60")).toBeNull();
    expect(parseRateLimit("60/0")).toBeNull();
  });
});

describe("parseCorsOrigins", () => {
  it("treats star or empty as *", () => {
    expect(parseCorsOrigins(undefined)).toBe("*");
    expect(parseCorsOrigins("*")).toBe("*");
    expect(parseCorsOrigins("*, https://a.example")).toBe("*");
  });
});
