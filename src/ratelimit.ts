import type { RateLimitConfig } from "./config";

interface Window {
  start: number;
  count: number;
}

const windows = new Map<string, Window>();
const PRUNE_THRESHOLD = 4096;
const PRUNE_AFTER_MS = 10 * 60_000;

export function checkRateLimit(key: string, limit: RateLimitConfig, now = Date.now()): boolean {
  if (windows.size > PRUNE_THRESHOLD) prune(now);

  const window = windows.get(key);
  if (!window || now - window.start >= limit.windowSec * 1000) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  if (window.count >= limit.count) return false;
  window.count += 1;
  return true;
}

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.start > PRUNE_AFTER_MS) windows.delete(key);
  }
}
