# API

All routes live on the Worker's hostname. HTTPS, no path prefix.

| Route | Purpose |
| --- | --- |
| `GET /_health` | Liveness JSON: `{ ok, version, colo, time }`. |
| `GET /` | Help JSON describing the three interfaces. |
| `POST /` with a JSON body | Envelope relay. |
| `POST`, `PUT`, `PATCH`, `DELETE` on `/` with no `?url` | Envelope relay. |
| Any method with `?url=` | Compat relay. |
| Any method on `/t/<target>` | Transparent relay. |
| `OPTIONS` with `access-control-request-method` | Local CORS preflight, `204`. |

Everything else is `404 NOT_FOUND`.

`HEAD` on `/` follows the `GET` rules without a response body.

Routing note: `POST /` is an envelope when the content type is JSON **or** when `?url` is absent. `POST /?url=…` with a non-JSON body is a raw compat relay. `PUT`/`PATCH`/`DELETE` are envelopes only when `?url` is absent; otherwise they are compat relays.

## Envelope mode

Request body, JSON object:

```jsonc
{
  "url": "https://api.example.com/items",   // required; may come from ?url
  "method": "POST",                          // optional; inferred (see below)
  "headers": { "authorization": "Bearer …" },// optional; object, arrays allowed
  "body": "{\"name\":\"Ada\"}",              // optional; string, or object
  "encoding": "utf8",                        // optional; "base64" decodes
  "options": { "timeoutMs": 15000, "meta": true }
}
```

Only `headers` are sent upstream — client headers are **not** forwarded in this mode. Exceptions: `content-type: application/json` is added when `body` is an object and none was given, and the default `user-agent` applies when the outgoing request has none.

Method inference: an explicit `method` wins. Otherwise the method is `POST` when a body is present, `GET` when it is not. `CONNECT` and `TRACE` are rejected with `405`. A body with `GET` or `HEAD` is rejected with `400`.

Query fallbacks, used when the envelope omits the field: `?url=`, `?method=`, `?body=`, `?encoding=`.

Response envelope:

```jsonc
{
  "ok": true,                 // relay succeeded; an upstream 4xx/5xx is still ok: true
  "status": 200,              // upstream status (204/304 arrive as 200 here, see below)
  "url": "https://api.example.com/final",  // final URL after redirects
  "headers": { "content-type": "application/json" }, // set-cookie excluded
  "body": { "…": "…" },
  "encoding": "utf8",         // "utf8" or "base64"
  "cookies": ["session=1"],   // present when the upstream set cookies
  "timing": { "upstreamMs": 95, "totalMs": 96 },       // options.meta
  "relay": { "id": "3dc3f4fa0e80", "colo": "MIA", "version": "0.1.0" } // options.meta
}
```

The relay's HTTP status mirrors the upstream status so that non-JSON clients see the failure directly. Two exceptions: upstream `204` and `304` cannot carry a body, so the relay answers `200` and the envelope's `status` field reports the real code.

Body conversion (`responseType`, default `auto`):

| `auto` decision | Result |
| --- | --- |
| `application/json`, `text/json`, `*+json` | Parsed JSON. Unparseable bodies fall back to text; empty bodies become `null`. |
| `text/*`, `application/xml`, `application/javascript`, `application/x-www-form-urlencoded`, `*+xml`, missing content type | UTF-8 string. |
| Anything else | Base64 string, `encoding: "base64"`. |

Explicit `responseType`: `json` parses, `text` decodes, `base64` encodes, `stream` bypasses the envelope entirely and returns the upstream response raw with `x-relay-*` metadata headers.

## Transparent mode

`/t/<target>` — the path and query are the target. A bare host implies `https`:

```
POST /t/api.example.com/v1/items?q=1
→ POST https://api.example.com/v1/items?q=1
```

A full URL may be placed in the path (`/t/https://api.example.com/x`), and `x-relay-target` overrides the path entirely. Method, headers and body belong to the target; request and response bodies stream without buffering. The client's query string is forwarded verbatim — `?key=` is not read here.

Redirects are **not** followed by default; `3xx` responses pass through with their `location`. Set `x-relay-follow: 1` to follow them.

## Compat mode

```
GET  /?url=https%3A%2F%2Fexample.com%2F
POST /?url=https://api.example.com/ingest     (raw body pass-through)
GET  /?url=https://api.example.com/hook&method=POST&body=hello
```

| Parameter | Meaning |
| --- | --- |
| `url` | Required target. |
| `method` | Upstream method. Defaults to the inbound method, or `POST` when `?body` is used. |
| `body` | Upstream body as a string. |
| `encoding` | `base64` decodes `body`. |
| `key` | Relay key, when configured. |
| option params | `timeout`, `type`, `meta`, `follow`, `redirects`, `cookies`, `retry`, `cache`, `cache_all` (see below). |

Without `?body`, the inbound body is streamed to the target and the inbound `content-type` is forwarded. Other query parameters are not forwarded; the target URL comes entirely from `url`.

`type` only affects envelope responses, so it has no visible effect in compat or transparent mode.

## Options

| Option | Query | Control header | Envelope (`options`) | Default |
| --- | --- | --- | --- | --- |
| Timeout (ms) | `timeout` | `x-relay-timeout` | `timeoutMs` | `TIMEOUT_MS`, 30000 |
| Follow redirects | `follow` | `x-relay-follow` | `followRedirects` | `true` envelope, `false` elsewhere |
| Max redirects | `redirects` | `x-relay-max-redirects` | `maxRedirects` | `5` |
| Response type | `type` | — | `responseType` | `auto` |
| Metadata | `meta` | — | `meta` | `false` |
| Cookie forwarding | `cookies` | `x-relay-cookies` | `cookies` | `strip` |
| Retry attempts | `retry` | `x-relay-retry` | `retry.attempts` | `0` |
| Cache TTL (s) | `cache` | `x-relay-cache` | `cache.ttl` | off |
| Cache everything | `cache_all=1` | `x-relay-cache-all` | `cache.everything` | `false` |

Booleans use `1`/`0`, `true`/`false`. Clamps: timeout `1`–`300000`, redirects `0`–`20`, retry attempts `0`–`5`, retry backoff `0`–`10000`, cache TTL `1`–`31536000`.

Envelope-only fields:

```jsonc
"options": {
  "retry": { "attempts": 2, "backoffMs": 250, "statuses": [429, 502, 503, 504] },
  "cache": { "ttl": 60, "everything": false }
}
```

Unrecognized options are ignored. `cache` maps to the Workers `cf.cacheTtl` and `cf.cacheEverything` fetch options.

### Control headers

Every `x-relay-*` request header is stripped before forwarding.

| Header | Meaning |
| --- | --- |
| `x-relay-key` | Relay key. Works in all modes. |
| `x-relay-target` | Transparent mode: overrides the path target. |
| `x-relay-timeout` | Per-attempt timeout, milliseconds. |
| `x-relay-follow` | Follow redirects. |
| `x-relay-max-redirects` | Redirect limit. |
| `x-relay-retry` | Retry attempts. |
| `x-relay-cookies` | `strip` or `pass`. |
| `x-relay-cache`, `x-relay-cache-all` | Cache TTL and cache-everything. |

### Response headers

| Header | Present on |
| --- | --- |
| `x-relay-id` | Every relay response and error. |
| `x-relay-colo` | Raw and error responses; envelope `meta`. |
| `x-relay-status` | Raw responses and envelopes. |
| `x-relay-url` | Raw responses: final URL when following, otherwise the requested target. |
| `x-relay-ms` | Raw and error responses. |
| `retry-after` | `429` responses; equals the rate-limit window. |

## Errors

Relay-level failures never masquerade as upstream responses. The JSON body is always `{ ok: false, error: { code, message }, relay: { id, colo } }` with CORS applied.

| Code | Status | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed envelope, invalid base64, body on `GET`/`HEAD`, invalid header. |
| `BAD_TARGET` | 400 | Missing or unparseable target URL, unsupported scheme. |
| `BLOCKED_TARGET` | 403 | Target is private/reserved, or matches `DENY_HOSTS`. |
| `AUTH_REQUIRED` | 401 | `RELAY_KEY` is set and no key was provided. |
| `AUTH_FAILED` | 403 | Wrong relay key. |
| `METHOD_NOT_ALLOWED` | 405 | `CONNECT` or `TRACE`. |
| `BODY_TOO_LARGE` | 413 | Buffered body exceeds `MAX_BODY_BYTES`. |
| `RATE_LIMITED` | 429 | `RATE_LIMIT` exceeded. |
| `TOO_MANY_REDIRECTS` | 502 | Redirect limit hit while following. |
| `UPSTREAM_UNREACHABLE` | 502 | Fetch failed: DNS, TLS, connection, protocol. |
| `UPSTREAM_TIMEOUT` | 504 | Attempt exceeded its timeout. |
| `NOT_FOUND` | 404 | Unknown route. |
| `INTERNAL` | 500 | Unhandled error. |

## Behavior details

### Redirects

When the body is replayable (not a stream), redirects are followed manually so that the final URL is known and reported. `303`, and `301`/`302` after a non-`GET`/`HEAD` method, become `GET` without a body. `307`/`308` preserve method and body. Cross-origin hops drop `authorization`, `cookie` and `proxy-authorization`. Exceeding the limit is `TOO_MANY_REDIRECTS`. With a streamed body (transparent, compat raw), following is delegated to the runtime when `follow` is enabled; when it is disabled the `3xx` passes through untouched.

### Retries

Retries apply to relay-level failures (`UPSTREAM_TIMEOUT`, `UPSTREAM_UNREACHABLE`) and to the configured status list, and only when the body can be replayed. Backoff is exponential: `backoffMs × 2^(attempt−1)`, capped at 10 s. Each attempt gets a fresh timeout.

### Header hygiene

Stripped from forwarded requests: hop-by-hop headers (`connection`, `keep-alive`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `proxy-authenticate`, `proxy-authorization`), `host`, `content-length`, `accept-encoding`, Cloudflare internals (`cf-*`, `cdn-loop`, `x-forwarded-*`, `x-real-ip`), and every `x-relay-*` header.

Responses drop hop-by-hop headers and, by default, `set-cookie`. `content-length` is preserved for untouched raw streams.

### Private-address guard

Targets are checked as literal addresses; the relay does not resolve DNS. Blocked ranges: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4` and above; `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 addresses re-checked against the IPv4 list. Hostnames: `localhost`, `*.localhost`, `*.local`, `*.internal`. `ALLOW_PRIVATE_TARGETS=true` disables the checks, and `DENY_HOSTS` adds a glob list where `*.workers.dev` matches subdomains and the base domain.

### Auth and rate limiting

Auth is off unless `RELAY_KEY` is set; the key is read from `x-relay-key`, or from `?key=` in envelope and compat mode (in transparent mode the query belongs to the target). Rate limiting is off unless `RATE_LIMIT` is set to `count/windowSeconds`; it is per isolate, keyed by `cf-connecting-ip`, and therefore best effort across Cloudflare's edge.

### CORS

`CORS_ORIGINS` is `*` or a comma-separated origin list. Allowed origins are echoed with `Vary: Origin`. `x-relay-id`, `x-relay-colo`, `x-relay-ms`, `x-relay-status` and `x-relay-url` are exposed to browsers. Preflights are answered locally with `204` and a one-day max age, and CORS headers are applied to error responses too.
