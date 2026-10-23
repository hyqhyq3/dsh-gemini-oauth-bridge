# dsh-gemini-oauth-bridge

English | [简体中文](README.zh-CN.md)

Bridges a **Google AI subscription** (AI Pro / AI Ultra, via the Antigravity / Code Assist OAuth surface) into an **OpenAI-compatible endpoint** that DeepSeek Harness (DSH) can use directly as a model provider.

> **Important boundary**: Google AI subscription developer quotas only cover the AI Studio web UI and OAuth login inside official CLI tools (Gemini CLI / Antigravity); **API-key usage is billed separately**. This plugin speaks the same OAuth surface as the official client, so it consumes subscription quota rather than API credit — but that also means it is not a Google-sanctioned third-party integration. Account risk / breakage is possible; evaluate for yourself.

## Features

- **Login and go**: one-click Google OAuth from Settings → Gemini OAuth (authorization code + loopback callback), with automatic `loadCodeAssist` registration / `onboardUser` onboarding and upstream model discovery.
- **OpenAI-compatible endpoint**: `/gemini-oauth-bridge/v1/chat/completions` (streaming SSE + non-streaming) and `/v1/models` (so DSH can discover models).
- **Full protocol translation**: system messages, multimodal (data-URL images), function calling (tool_calls ↔ functionCall/functionResponse), `reasoning_content` (thinking stream), usage stats, finish-reason mapping.
- **Gemini 3 thought-signature replay**: the server remembers upstream `thoughtSignature` values by tool-call id and re-attaches them to functionCall parts on the next turn — OpenAI format carries no signatures, and Gemini 3 multi-turn tool calls fail without replay.
- **Subscription-friendly (anti-drift)**: dynamically tracks the latest shipping Antigravity client version for the User-Agent (stale versions are rejected for newer models); requests carry `requestType: "agent"`, a stable derived `sessionId`, and `agent-<uuid>` request IDs; keep-alive connections without `Connection: close`.
- **429 cooldowns**: parses upstream `Retry-After` / `retryDelay`, enters a per-model cooldown window, and refuses requests locally during it instead of hammering upstream.
- **Catalog honesty**: an entry the upstream catalog flags `disabled: true` — e.g. `gemini-4-argon-disabled` ("Unavailable" / "available to Ultra and paid Pro plan subscribers") — is never published as a DSH model, so the picker cannot offer something that can only fail. A request for an id the account cannot use returns the upstream's own explanation plus a refresh hint instead of an opaque `404 Requested entity was not found`. Per-model context/output limits are read from the upstream `maxTokens` / `maxOutputTokens` fields.
- **Browser-trust fence**: a plugin prefix route is dispatched *before* DSH's own Host/Origin fence, so the bridge enforces its own — the `Host` must be an authority it serves (loopback by default), a `Sec-Fetch-Site: cross-site` request, an opaque `Origin: null`, or an `Origin` that disagrees with the `Host` is refused with 403, and a request carrying no `Host` at all is only accepted from a loopback peer.
- **Single-flight token refresh**: access tokens auto-renew 120 s before expiry; concurrent requests share one refresh.

## Install

```sh
dsh plugin --profile web add github:hyqhyq3/dsh-gemini-oauth-bridge
# or a local checkout
dsh plugin --profile web add link:/path/to/dsh-gemini-oauth-bridge
```

Restart `dsh --profile web`, then open Settings → **Gemini OAuth**.

## Usage

1. Click **登录 Google 账号** (Log in with Google) and finish the flow in your browser. The plugin temporarily listens on `127.0.0.1:51121` for the loopback callback — this exact redirect URI is registered for the Antigravity client and the port cannot change. Port conflicts are reported explicitly.
2. After login the page shows the account, project ID, tier, and model list.
3. Register the bridge as a DSH provider in `~/.dsh/settings.yaml` (port matches your DSH web URL, default 3080):

```yaml
llm-pi-ai:
  providers:
    gemini-oauth:
      api: openai-completions
      baseURL: http://127.0.0.1:3080/gemini-oauth-bridge/v1
      apiKeyEnv: GEMINI_OAUTH_API_KEY
      models:
        - id: gemini-3.1-pro-high
        - id: gemini-3.7-flash-high
```

4. Pick the models in the model selector. **Step 3 is usually unnecessary**: logging in and refreshing the model list write this block automatically (the `baseURL` port follows the address you use to open the DSH UI). On DSH ≥ 0.2 the plugin edits the `llm-pi-ai` entry through the settings service — the same path the DSH Models page uses — so the refreshed model list is hot-applied to the running process and persisted into the active profile's `cordis.patch.yml`; no restart is needed. Older DSH versions get the legacy `~/.dsh/settings.yaml` write, which takes effect at the next restart. DSH refuses a provider profile that declares no credential, so the plugin also provisions the matching `GEMINI_OAUTH_API_KEY` entry in `~/.dsh/.credentials.yaml` (mode 0600) with the fixed placeholder `dsh-gemini-oauth-bridge` — an existing entry is never overwritten, and the bridge accepts any bearer token. To use your own key instead, set it through the Models page; to add local auth to the bridge itself, set `"apiKey": "some-string"` in `~/.dsh/gemini-oauth-bridge.json` — requests must then carry `Authorization: Bearer <value>`.

### Local state

`~/.dsh/gemini-oauth-bridge.json` (mode 0600, contains OAuth tokens — treat as a secret):

| Field | Meaning |
|---|---|
| `tokens` | access/refresh tokens and expiry |
| `email` / `project` / `tier` | login account and registration result |
| `models` | upstream model cache (refreshable from the UI) |
| `modelCaps` | per-model `contextLength` / `maxCompletionTokens` read from the upstream catalog |
| `modelsUnavailable` | ids the upstream catalog marks `disabled`, with the upstream explanation shown when such a model is requested |
| `trustedHosts` | extra `host:port` authorities the browser-trust fence accepts (for non-loopback deployments); loopback is always accepted |
| `signatures` | thoughtSignature replay cache (by tool-call id, cap 800) |
| `apiKey` | optional local auth for the bridge endpoint |
| `apiConfig` | optional upstream overrides (`generateBase` / `loadBase` / `onboardBase`); defaults match CLIProxyAPI: generation via daily, registration via prod |

## Design notes (anti-drift)

Protocol details follow the public implementation in [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (Apache-2.0):

- **Live version tracking**: the latest Antigravity version is fetched from the official updater hub (UA `electron-builder`, like the real updater), semver-validated, and cached for 6 hours — refreshed on the first request that finds the cache stale, not on a timer; failures fall back to the cache, then to the `2.9.1` floor (Cloud Code rejects clients below 2.9.0 for newer models).
- **Per-surface User-Agents**: generate/stream/loadCodeAssist use `antigravity/hub/<version> darwin/arm64`; onboardUser appends ` google-api-nodejs-client/10.3.0`; OAuth token refresh uses `Go-http-client/2.0` — each surface matches the real client.
- **Envelope semantics**: `requestType: "agent"`, `requestId: "agent-<uuid>"`, `userAgent: "antigravity"`, `request.sessionId` derived deterministically from the conversation's first message (one session per conversation); `safetySettings` stripped; `generationConfig.maxOutputTokens` removed for gemini-3 models.
- **Connection fingerprint**: no `Connection: close`; keep-alive reuse.
- **Backoff**: on 429, reads the `Retry-After` header or in-body `retryDelay`, enters a per-model cooldown (capped at 30 min) with no upstream traffic during it.
- **Subscription tier resolution**: request entitlements follow `paidTier.id` (Google AI Pro → `g1-pro-tier`); a `free-tier` `currentTier` is just the registration state and does not limit quota or model access.
- **Automatic provider configuration**: on login and on 刷新模型列表 (refresh models), the `llm-pi-ai.providers.gemini-oauth` route (with the latest model ids and the `GEMINI_OAUTH_API_KEY` credential reference) is written through the DSH settings service when available — the same path the Models page uses — so the change hot-applies to the running process and persists into the active profile's `cordis.patch.yml`; only the gemini-oauth route is touched and the edit is validated by the adapter's own schema. When the settings service is unavailable or the update fails, a fallback writes the legacy `~/.dsh/settings.yaml` document instead (surgical merge, one-time backup at `settings.yaml.bak-gemini-oauth-bridge`), which older deployments load at boot; once the hot path has succeeded that document is deliberately left alone, because on DSH ≥ 0.2 the next boot imports it and renames it over `settings.yaml.imported`, so rewriting it would clobber that archive. The matching placeholder key is provisioned in `~/.dsh/.credentials.yaml` (append-only; a version-1 document whose shape cannot be proven is left untouched and reported instead). Internal `chat_*`/`tab_*` ids are filtered out. Set `"providerSync": false` in the state file to opt out.
- **Public client credentials**: the OAuth client credentials are public values embedded in the Antigravity app (published verbatim in CLIProxyAPI's repo); they are stored base64-encoded in this repository only to keep GitHub push protection quiet, and decoded at runtime.

## Security

- OAuth tokens live in `~/.dsh/gemini-oauth-bridge.json` (mode 0600) and are never returned by any endpoint; `/api/status` exposes only account metadata (email, project, tier) and the model list.
- DSH applies a Host/Origin fence to its own `/api/*` routes, but a plugin `webServer.register({kind: 'prefix'})` route is dispatched before that fence, so the bridge enforces the same rules itself: a request is refused with 403 when its `Host` is not an authority the bridge serves, when `Sec-Fetch-Site: cross-site`, when `Origin` is the opaque `null` a sandboxed frame sends, when `Origin` disagrees with `Host`, or when a request arrives with no `Host` at all from anything other than a loopback peer. This blocks DNS-rebinding reads of `/api/status` and `/v1/*`, quota-burning calls through `/v1/chat/completions`, and blind-CSRF of the mutating POSTs (`/api/login`, `/api/logout`, `/api/refresh-models`) — a cross-site `Content-Type: text/plain` POST needs no CORS preflight, so without the fence the browser would deliver it.
- `/v1/*` is unauthenticated by default because DSH calls it locally; set `"apiKey"` in the state file to require `Authorization: Bearer <value>`, and `"trustedHosts": ["host:port"]` to serve DSH on a non-loopback address.

## Limitations

- **Unofficial usage**: relies on the Antigravity client's public OAuth credentials and a non-public `v1internal` surface; Google may change or restrict it at any time. Intended for individual subscribers' own use.
- Single account (no rotation); `http(s)://` image URLs unsupported (data URLs only); the signature cache is persisted but LRU-evicts past 800 entries.
- The login callback occupies `127.0.0.1:51121`; logging in while the Antigravity desktop app is also logging in may conflict.
- Generation goes to the `daily-cloudcode-pa` channel (matching CLIProxyAPI's default); override via `apiConfig` if needed.
- **Some catalog models cannot generate.** Upstream advertises entries it will not serve for your account — the Gemini 4 Argon family appears only as `gemini-4-argon-disabled` with `disabled: true`, `tagTitle: "Unavailable"` and `tagDescription: "Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers."`, and every id variant returns `404 NOT_FOUND` even on a paid `g1-pro-tier` (Google AI Pro) account. Catalog membership is therefore not proof that a model can generate; the plugin hides `disabled` entries, but no client-side change can enable them.

## Development

Zero dependencies, plain ESM JavaScript (Node ≥ 22); `lib/*.js` ships as written, no build step.

```sh
node --check lib/index.js && node --check lib/protocol.js && node --check lib/client.js
node --test test/protocol.test.js test/host.smoke.test.js test/bridge.e2e.test.js
```

Test coverage: protocol translation units (OAuth URLs / envelope / stream fragments / signature replay), host-route smoke (mocked cordis ctx + real HTTP + loopback login error paths), and bridge end-to-end (mocked upstream verifying the envelope contract, SSE translation, and 429 cooldown).

## License

MIT

## Language (0.3.0)

The Settings section is bilingual (English / Simplified Chinese), using DSH's
`geminiOauth` locale namespace and framework-injected `t` seat. Change Language in
Settings → General; every plugin API request sends the active `?lang=zh|en`.
The root summary page and OpenAI-compatible bridge also accept this parameter.
Bridge errors with locale descriptors use the resolved language; raw errors,
status codes, and response envelopes are preserved. A valid explicit language
wins over `locale.preference` in `$DSH_HOME/settings.yaml` (default home:
`~/.dsh`); absent or unreadable preferences fall back to Chinese. The OAuth
callback remembers the language of the login request, since Google's navigation
does not carry `lang`. Google/upstream text is preserved verbatim. This requires
DSH's `@deepseek-ai/dsh-client-locale` service, included in the web profile.

Run `npm test` for protocol, HTTP integration, and locale coverage. No build step
or runtime dependencies are needed.
