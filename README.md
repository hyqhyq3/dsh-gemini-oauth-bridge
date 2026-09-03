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
      models:
        - id: gemini-3-pro
        - id: gemini-3-flash
```

4. Restart DSH and pick the models in the model selector. **No apiKey needed** (the bridge does not check auth headers by default; to add local auth, set `"apiKey": "some-string"` in `~/.dsh/gemini-oauth-bridge.json` — requests must then carry `Authorization: Bearer <value>`).

### Local state

`~/.dsh/gemini-oauth-bridge.json` (mode 0600, contains OAuth tokens — treat as a secret):

| Field | Meaning |
|---|---|
| `tokens` | access/refresh tokens and expiry |
| `email` / `project` / `tier` | login account and registration result |
| `models` | upstream model cache (refreshable from the UI) |
| `signatures` | thoughtSignature replay cache (by tool-call id, cap 800) |
| `apiKey` | optional local auth for the bridge endpoint |
| `apiConfig` | optional upstream overrides (`generateBase` / `loadBase` / `onboardBase`); defaults match CLIProxyAPI: generation via daily, registration via prod |

## Design notes (anti-drift)

Protocol details follow the public implementation in [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (Apache-2.0):

- **Live version tracking**: every 6 hours the latest Antigravity version is fetched from the official updater hub (UA `electron-builder`, like the real updater), semver-validated, and cached; failures fall back to the cache, then to the `2.9.1` floor (Cloud Code rejects clients below 2.9.0 for newer models).
- **Per-surface User-Agents**: generate/stream/loadCodeAssist use `antigravity/hub/<version> darwin/arm64`; onboardUser appends ` google-api-nodejs-client/10.3.0`; OAuth token refresh uses `Go-http-client/2.0` — each surface matches the real client.
- **Envelope semantics**: `requestType: "agent"`, `requestId: "agent-<uuid>"`, `userAgent: "antigravity"`, `request.sessionId` derived deterministically from the conversation's first message (one session per conversation); `safetySettings` stripped; `generationConfig.maxOutputTokens` removed for gemini-3 models.
- **Connection fingerprint**: no `Connection: close`; keep-alive reuse.
- **Backoff**: on 429, reads the `Retry-After` header or in-body `retryDelay`, enters a per-model cooldown (capped at 30 min) with no upstream traffic during it.
- **Public client credentials**: the OAuth client credentials are public values embedded in the Antigravity app (published verbatim in CLIProxyAPI's repo); they are stored base64-encoded in this repository only to keep GitHub push protection quiet, and decoded at runtime.

## Limitations

- **Unofficial usage**: relies on the Antigravity client's public OAuth credentials and a non-public `v1internal` surface; Google may change or restrict it at any time. Intended for individual subscribers' own use.
- Single account (no rotation); `http(s)://` image URLs unsupported (data URLs only); the signature cache is persisted but LRU-evicts past 800 entries.
- The login callback occupies `127.0.0.1:51121`; logging in while the Antigravity desktop app is also logging in may conflict.
- Generation goes to the `daily-cloudcode-pa` channel (matching CLIProxyAPI's default); override via `apiConfig` if needed.

## Development

Zero dependencies, plain ESM JavaScript (Node ≥ 22); `lib/*.js` ships as written, no build step.

```sh
node --check lib/index.js && node --check lib/protocol.js && node --check lib/client.js
node --test test/protocol.test.js test/host.smoke.test.js test/bridge.e2e.test.js
```

Test coverage: protocol translation units (OAuth URLs / envelope / stream fragments / signature replay), host-route smoke (mocked cordis ctx + real HTTP + loopback login error paths), and bridge end-to-end (mocked upstream verifying the envelope contract, SSE translation, and 429 cooldown).

## License

MIT
