import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64, readAllLimited } from "../../src/body";

describe("base64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it("decodes standard padding", () => {
    expect(decodeBase64("aGVsbG8=")).toEqual(new TextEncoder().encode("hello"));
  });
});

describe("readAllLimited", () => {
  it("returns empty for null streams", async () => {
    expect(await readAllLimited(null, 10, "body")).toEqual(new Uint8Array(0));
  });

  it("reads streams within the limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    expect(await readAllLimited(stream, 10, "body")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("throws when the limit is exceeded", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await expect(readAllLimited(stream, 4, "body")).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});
