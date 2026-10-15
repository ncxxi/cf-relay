import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../../src/ratelimit";

describe("checkRateLimit", () => {
  it("allows up to the limit inside a window", () => {
    const limit = { count: 2, windowSec: 60 };
    expect(checkRateLimit("a", limit, 0)).toBe(true);
    expect(checkRateLimit("a", limit, 1)).toBe(true);
    expect(checkRateLimit("a", limit, 2)).toBe(false);
  });

  it("resets after the window", () => {
    const limit = { count: 1, windowSec: 10 };
    expect(checkRateLimit("b", limit, 0)).toBe(true);
    expect(checkRateLimit("b", limit, 5_000)).toBe(false);
    expect(checkRateLimit("b", limit, 10_000)).toBe(true);
  });

  it("tracks keys independently", () => {
    const limit = { count: 1, windowSec: 60 };
    expect(checkRateLimit("c", limit, 0)).toBe(true);
    expect(checkRateLimit("d", limit, 0)).toBe(true);
  });
});
