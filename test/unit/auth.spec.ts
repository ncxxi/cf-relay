import { describe, expect, it } from "vitest";
import { checkRelayKey } from "../../src/auth";

describe("checkRelayKey", () => {
  it("skips verification when no key is configured", () => {
    expect(() => checkRelayKey(null, "")).not.toThrow();
    expect(() => checkRelayKey("anything", "")).not.toThrow();
  });

  it("requires a key when configured", () => {
    expect(() => checkRelayKey(null, "s3cret")).toThrowError(expect.objectContaining({ code: "AUTH_REQUIRED" }));
  });

  it("rejects a wrong key", () => {
    expect(() => checkRelayKey("nope", "s3cret")).toThrowError(expect.objectContaining({ code: "AUTH_FAILED" }));
  });

  it("accepts the configured key", () => {
    expect(() => checkRelayKey("s3cret", "s3cret")).not.toThrow();
  });
});
