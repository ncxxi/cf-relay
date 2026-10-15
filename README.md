# cf-relay

A Cloudflare Workers HTTP relay. Forward requests to any `http(s)` origin from three interfaces:

- **Envelope** — the primary interface. `POST /` with a JSON body describing the request, and get a JSON envelope back. Full option surface: method, headers, bodies (raw or base64), redirects, retries, timeouts, cache, metadata.
- **Transparent** — `/t/<host>/<path>` proxies requests with streaming bodies in both directions and a passthrough status line. Options travel in `x-relay-*` control headers.
- **Compat** — `GET /?url=…` (and raw-body `POST /?url=…`) for tools that already speak this shape.

No runtime dependencies. The deployed bundle is roughly 9 KiB gzipped.

## Quick start

```sh
bun install
bunx wrangler dev          # local runtime on http://localhost:8787
bunx wrangler deploy       # deploy to your account
```

Enable the optional relay key before sharing the URL:

```sh
bunx wrangler secret put RELAY_KEY
```

## Usage

Envelope, with metadata and a text body:

```sh
curl -s -X POST https://relay.example.workers.dev/ \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://api.github.com/zen",
    "options": { "responseType": "text", "meta": true }
  }'
```

Envelope with a JSON body, custom method and headers:

```sh
curl -s -X POST https://relay.example.workers.dev/ \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://api.example.com/items",
    "method": "POST",
    "headers": { "authorization": "Bearer …" },
    "body": { "name": "Ada" }
  }'
```

Transparent mode — method, headers, query and body all belong to the target:

```sh
curl -s -X POST 'https://relay.example.workers.dev/t/api.example.com/v1/items?q=1' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer …' \
  -d '{"name":"Ada"}'
```

Compat mode:

```sh
curl -s 'https://relay.example.workers.dev/?url=https%3A%2F%2Fexample.com%2F'
```

The full contract — routes, parameters, options, headers, error codes — is in [docs/API.md](docs/API.md).

## Configuration

Variables live in `wrangler.jsonc`. `RELAY_KEY` belongs in a secret, not in `vars`.

| Variable | Default | Description |
| --- | --- | --- |
| `RELAY_KEY` | unset | Shared secret. When set, requests must present `x-relay-key` (or `?key=` in envelope/compat). |
| `CORS_ORIGINS` | `*` | `*`, or a comma-separated list of allowed origins. |
| `MAX_BODY_BYTES` | `16777216` | Cap for bodies the relay buffers: the JSON envelope request and the upstream response read for envelope replies. Transparent and compat bodies are streamed and are not capped. |
| `TIMEOUT_MS` | `30000` | Default per-attempt upstream timeout. |
| `USER_AGENT` | `cf-relay/<version>` | Default `user-agent` when the outgoing request has none and no client header was forwarded. |
| `RATE_LIMIT` | unset | `count/windowSeconds` (for example `120/60`), best effort, per isolate, keyed by client IP. Empty disables it. |
| `ALLOW_PRIVATE_TARGETS` | `false` | Allow localhost and private/reserved address targets. |
| `DENY_HOSTS` | unset | Comma-separated host deny list. `*.workers.dev` matches subdomains and the base domain. |

After editing `wrangler.jsonc`, run `bunx wrangler types` to refresh `worker-configuration.d.ts`.

## Development

```sh
bun run dev        # wrangler dev
bun run test       # vitest, inside the Workers runtime
bun run typecheck  # tsc --noEmit
bun run deploy     # wrangler deploy
```

Tests run in the Workers runtime through `@cloudflare/vitest-plugin`, with outbound `fetch` stubbed so no network traffic leaves the test isolate.

## Notes and limits

- **Egress is Cloudflare's.** A Worker cannot choose its exit IP or colo. `x-relay-colo` reports which colo served the request, and retries are the practical mitigation when an origin rate-limits or blocks a shared Cloudflare range. If your upstreams cluster in one region, enabling `"placement": { "mode": "smart" }` in `wrangler.jsonc` is the only available knob.
- **Compression is the runtime's job.** The relay strips the client's `accept-encoding` and lets Cloudflare negotiate compression with the client, so upstream responses are never double-compressed.
- **Some headers cannot be set.** A Worker cannot override `Host` or TLS verification for an upstream request.
- **Cookies are stripped by default** on multi-interface responses; pass `cookies: "pass"` (or `x-relay-cookies: pass`) to forward `set-cookie`.
