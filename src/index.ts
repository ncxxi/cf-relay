import { checkRelayKey } from "./auth";
import { loadConfig } from "./config";
import { RelayError } from "./errors";
import { buildCompatRequest, buildEnvelopeRequest, buildTransparentRequest } from "./parse";
import { checkRateLimit } from "./ratelimit";
import { performRelay } from "./relay";
import {
  envelopeResponse,
  errorResponse,
  healthResponse,
  helpResponse,
  preflightResponse,
  rawResponse,
  type RequestMeta,
} from "./respond";
import { route } from "./router";
import { guardTarget } from "./target";
import type { RelayEnv, RelayRequest } from "./types";

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function coloOf(request: Request): string {
  const colo = (request.cf as { colo?: unknown } | undefined)?.colo;
  return typeof colo === "string" ? colo : "unknown";
}

async function buildRelayRequest(
  kind: "envelope" | "compat" | "transparent",
  request: Request,
  url: URL,
  config: ReturnType<typeof loadConfig>,
): Promise<RelayRequest> {
  const relay = await (kind === "envelope"
    ? buildEnvelopeRequest(request, url, config)
    : kind === "compat"
      ? buildCompatRequest(request, url, config)
      : buildTransparentRequest(request, url, config));

  if (!relay.headers.has("user-agent")) relay.headers.set("user-agent", config.userAgent);
  return relay;
}

export default {
  async fetch(request: Request, env: RelayEnv, _ctx: ExecutionContext): Promise<Response> {
    const started = performance.now();
    const config = loadConfig(env);
    const meta: RequestMeta = { id: requestId(), colo: coloOf(request) };
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS" && request.headers.has("access-control-request-method")) {
        return preflightResponse(request, config);
      }

      const kind = route(request, url);
      if (kind === "health") return healthResponse(request, config, meta);
      if (kind === "help") return helpResponse(request, config);
      if (kind === "not-found") throw new RelayError("NOT_FOUND", `no route for ${url.pathname}`);

      const providedKey =
        request.headers.get("x-relay-key") ?? (kind === "transparent" ? null : url.searchParams.get("key"));
      checkRelayKey(providedKey, config.relayKey);

      if (config.rateLimit) {
        const clientKey = request.headers.get("cf-connecting-ip") ?? "unknown";
        if (!checkRateLimit(clientKey, config.rateLimit)) {
          throw new RelayError("RATE_LIMITED", "rate limit exceeded");
        }
      }

      const relay = await buildRelayRequest(kind, request, url, config);
      guardTarget(relay.target, { allowPrivate: config.allowPrivateTargets, denyHosts: config.denyHosts });

      const result = await performRelay(relay);
      const totalMs = performance.now() - started;

      const raw = relay.route !== "envelope" || relay.options.responseType === "stream";
      return raw
        ? rawResponse(result, relay, request, config, meta, totalMs)
        : await envelopeResponse(result, relay, request, config, meta, totalMs);
    } catch (error) {
      return errorResponse(error, request, config, meta, performance.now() - started);
    }
  },
} satisfies ExportedHandler<RelayEnv>;
