export type ErrorCode =
  | "BAD_REQUEST"
  | "BAD_TARGET"
  | "BLOCKED_TARGET"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "METHOD_NOT_ALLOWED"
  | "BODY_TOO_LARGE"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNREACHABLE"
  | "TOO_MANY_REDIRECTS"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  BAD_TARGET: 400,
  BLOCKED_TARGET: 403,
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 403,
  METHOD_NOT_ALLOWED: 405,
  BODY_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNREACHABLE: 502,
  TOO_MANY_REDIRECTS: 502,
  INTERNAL: 500,
};

export class RelayError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}
