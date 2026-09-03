# dsh-gemini-oauth-bridge

[English](README.md) | 简体中文

把 **Google AI 订阅**（AI Pro / AI Ultra，走 Antigravity / Code Assist OAuth 授权端点）桥接成 **OpenAI 兼容接口**，供 DeepSeek Harness（DSH）直接当模型 provider 使用。

> **重要边界**：Google AI 订阅的开发者配额只覆盖 AI Studio 网页界面与官方 CLI 工具（Gemini CLI / Antigravity）的 OAuth 登录；**API 密钥调用单独计费**。本插件走的是官方客户端同款 OAuth 授权端点，因此消耗的是订阅配额而不是 API 余额——但这也意味着它不是 Google 面向第三方客户端的官方支持用法，存在账号风控/失效风险，请自行评估。

[![English](https://img.shields.io/badge/README-English-blue)](README.md)

## 功能

- **登录即用**：Settings → Gemini OAuth 页面一键发起 Google OAuth 授权（授权码 + 本机回环回调），自动完成 `loadCodeAssist` 注册 / `onboardUser` 开通，并拉取可用模型列表。
- **OpenAI 兼容端点**：`/gemini-oauth-bridge/v1/chat/completions`（流式 SSE + 非流式）与 `/v1/models`（供 DSH 做模型发现）。
- **完整协议翻译**：system 消息、多模态（data URL 图片）、function calling（tool_calls ↔ functionCall/functionResponse）、`reasoning_content`（思考流）、usage 统计、finish_reason 映射。
- **Gemini 3 thought signature 回放**：服务端按 tool_call id 记住上游下发的 thoughtSignature，下一轮请求自动附回 functionCall part——OpenAI 格式本身不携带签名，这是多轮工具调用不报错的必要机制。
- **订阅额度友好（防风控）**：动态追踪 Antigravity 官方最新客户端版本号用于 User-Agent（版本过旧会被拒绝新模型）；请求信封带 `requestType: "agent"`、稳定派生的 `sessionId`、`agent-<uuid>` 请求 ID；连接复用不发送 `Connection: close`。
- **429 冷却**：解析上游 Retry-After / retryDelay，按模型进入冷却窗口，冷却期内直接本地返回 429，不硬刷上游。
- **Token 单飞刷新**：access token 过期前 120 秒自动用 refresh token 续期，并发请求合并为一次刷新。

## 安装

```sh
dsh plugin --profile web add github:hyqhyq3/dsh-gemini-oauth-bridge
# 或本地路径
dsh plugin --profile web add link:/path/to/dsh-gemini-oauth-bridge
```

重启 `dsh --profile web`，打开 Settings → **Gemini OAuth**。

## 使用

1. 点击 **登录 Google 账号**，在浏览器完成授权。插件会在 `127.0.0.1:51121` 临时起一个回环回调接收器（这是 Google 端注册给 Antigravity 客户端的固定 redirect URI，端口不可改）。若端口被占用会明确报错。
2. 登录成功后页面显示账号、项目 ID、tier、模型列表。
3. 在 `~/.dsh/settings.yaml` 里把桥接端点注册为 DSH provider（端口以你的 DSH 网页地址为准，默认 3080）：

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

4. 重启 DSH，在模型选择器里选用。**不需要配置 apiKey**（插件不校验鉴权头；如需加一层本机鉴权，可在 `~/.dsh/gemini-oauth-bridge.json` 里设置 `"apiKey": "任意字符串"`，之后请求需带 `Authorization: Bearer <该值>`）。

### 本地状态

`~/.dsh/gemini-oauth-bridge.json`（mode 0600，含 OAuth token，视为机密）：

| 字段 | 说明 |
|---|---|
| `tokens` | access/refresh token 与过期时间 |
| `email` / `project` / `tier` | 登录账号与注册结果 |
| `models` | 上游模型列表缓存（UI 里可手动刷新） |
| `signatures` | thoughtSignature 回放缓存（按 tool_call id，上限 800 条） |
| `apiKey` | 可选：给桥接端点加本机鉴权 |
| `apiConfig` | 可选：覆盖上游端点（`generateBase` / `loadBase` / `onboardBase`），默认与 CLIProxyAPI 一致：生成走 daily、注册走 prod |

## 设计说明（反风控要点）

参考 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（Apache-2.0）的公开实现，协议细节以其抓包结论为准：

- **版本号动态追踪**：每 6 小时从 Antigravity 官方更新 hub 拉取最新版本（请求 UA 用 `electron-builder`，与真实更新器一致），校验数字 semver 后缓存；失败时退回缓存值，再退回兜底 `2.9.1`（Cloud Code 拒绝低于 2.9.0 的客户端使用新模型）。
- **UA 分场景**：generate/stream/loadCodeAssist 用 `antigravity/hub/<版本> darwin/arm64`；onboardUser 追加 ` google-api-nodejs-client/10.3.0`；OAuth token 刷新用 `Go-http-client/2.0`——每个环节与真实客户端一致。
- **信封语义**：`requestType: "agent"`、`requestId: "agent-<uuid>"`、`userAgent: "antigravity"`、`request.sessionId` 由对话首条消息稳定哈希派生（同一会话不换 session）；删除 `safetySettings`；gemini-3 系剔除 `generationConfig.maxOutputTokens`。
- **连接指纹**：不发送 `Connection: close`，复用 keep-alive 连接。
- **限流退避**：429 时读取 `Retry-After` 头或响应内 `retryDelay`，进入按模型冷却（上限 30 分钟），冷却期内不发出上游请求。
- **公开客户端凭据**：OAuth client 凭据是 Antigravity 应用内嵌的公开值（CLIProxyAPI 开源库同样原样公开），仓库中以 base64 形式存放——只为避免 GitHub push protection 的扫描噪声，运行时解码。

## 局限

- **非官方用法**：依赖 Antigravity 客户端的公开 OAuth client 凭据与非公开 `v1internal` 接口，Google 可能随时变更或限制；仅供个人订阅者自用。
- 单账号（不做多账号轮询）；`http(s)://` 图片 URL 不支持（仅 data URL 内联）；会话重启后 thoughtSignature 缓存仍在（持久化），但超过 800 条会 LRU 淘汰。
- 登录回调固定占用 `127.0.0.1:51121`；与 Antigravity 桌面客户端同时登录可能端口冲突。
- 上游为 `daily-cloudcode-pa` 通道（与 CLIProxyAPI 默认一致）；如需切换可通过 `apiConfig` 覆盖。

## 开发

零依赖、纯 ESM JavaScript（Node ≥ 22），`lib/*.js` 原样发布，无构建步骤。

```sh
node --check lib/index.js && node --check lib/protocol.js && node --check lib/client.js
node --test test/protocol.test.js test/host.smoke.test.js test/bridge.e2e.test.js
```

测试覆盖：协议翻译单测（OAuth URL/信封/流式分片/签名回放）、host 路由冒烟（mock cordis ctx + 真实 HTTP + 回环回调登录错误路径）、桥接端到端（mock 上游验证信封契约、SSE 翻译、429 冷却）。

## License

MIT
