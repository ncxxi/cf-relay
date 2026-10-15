import { RelayError } from "./errors";

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readAllLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new RelayError("BODY_TOO_LARGE", `${label} exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatBytes(chunks, total);
}

export function contentTypeEssence(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isJsonType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType === "text/json" || mediaType.endsWith("+json");
}

export function isTextType(mediaType: string): boolean {
  return (
    mediaType === "" ||
    mediaType.startsWith("text/") ||
    mediaType === "application/xml" ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-www-form-urlencoded" ||
    mediaType.endsWith("+xml")
  );
}
