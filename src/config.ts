import type { RelayEnv } from "./types";
import { VERSION } from "./version";

export interface RateLimitConfig {
  count: number;
  windowSec: number;
}

export interface Config {
  relayKey: string;
  corsOrigins: string[] | "*";
  maxBodyBytes: number;
  timeoutMs: number;
  userAgent: string;
  rateLimit: RateLimitConfig | null;
  allowPrivateTargets: boolean;
  denyHosts: string[];
}

const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = `cf-relay/${VERSION}`;

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bool(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function parseCorsOrigins(value: string | undefined): string[] | "*" {
  const origins = list(value);
  if (origins.length === 0 || origins.includes("*")) return "*";
  return origins;
}

export function parseRateLimit(value: string | undefined): RateLimitConfig | null {
  if (!value) return null;
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const windowSec = Number(match[2]);
  if (!Number.isInteger(count) || !Number.isInteger(windowSec) || count < 1 || windowSec < 1) return null;
  return { count, windowSec };
}

export function loadConfig(env: RelayEnv): Config {
  return {
    relayKey: env.RELAY_KEY?.trim() ?? "",
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    timeoutMs: positiveInt(env.TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    userAgent: env.USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    rateLimit: parseRateLimit(env.RATE_LIMIT),
    allowPrivateTargets: bool(env.ALLOW_PRIVATE_TARGETS),
    denyHosts: list(env.DENY_HOSTS),
  };
}
