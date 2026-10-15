export interface RelayEnv {
  RELAY_KEY?: string;
  CORS_ORIGINS?: string;
  MAX_BODY_BYTES?: string;
  TIMEOUT_MS?: string;
  USER_AGENT?: string;
  RATE_LIMIT?: string;
  ALLOW_PRIVATE_TARGETS?: string;
  DENY_HOSTS?: string;
}

export type ResponseType = "auto" | "json" | "text" | "base64" | "stream";
export type CookieMode = "strip" | "pass";
export type RouteKind = "envelope" | "compat" | "transparent";

export interface RetryOptions {
  attempts: number;
  backoffMs: number;
  statuses: number[];
}

export interface CacheOptions {
  ttl: number;
  everything: boolean;
}

export interface RelayOptions {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  responseType: ResponseType;
  meta: boolean;
  cookies: CookieMode;
  retry: RetryOptions;
  cache: CacheOptions | null;
}

export type RelayBody = string | Uint8Array | null;

export interface RelayRequest {
  route: RouteKind;
  target: URL;
  method: string;
  headers: Headers;
  body: RelayBody;
  stream: ReadableStream<Uint8Array> | null;
  options: RelayOptions;
}
