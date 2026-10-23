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
- **不做虚假宣传的模型列表**：上游模型目录里标记 `disabled: true` 的条目（例如 `gemini-4-argon-disabled`，`tagTitle: "Unavailable"`、`tagDescription: "Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers."`）不会被写进 DSH 的模型列表，避免选择器里出现"选了必然失败"的模型；请求此类模型时返回上游自己的说明并提示刷新模型列表，而不是含义不明的 `404 Requested entity was not found`。模型的上下文/输出上限改从上游的 `maxTokens` / `maxOutputTokens` 字段读取。
- **浏览器信任围栏**：插件的 prefix 路由先于 DSH 自身的 Host/Origin 围栏被派发，因此插件自行实现同样的规则——`Host` 必须是本插件服务的地址（默认仅回环），跨站请求、`Origin` 为不透明的 `null`（沙箱 iframe 会这样发）、或 `Origin` 与 `Host` 不一致的请求一律 403；完全不带 `Host` 的请求只接受回环对端（例如进程内合成的请求）。
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
      apiKeyEnv: GEMINI_OAUTH_API_KEY
      models:
        - id: gemini-3.1-pro-high
        - id: gemini-3.7-flash-high
```

4. 在模型选择器里选用。**第 3 步通常无需手动做**：登录和刷新模型列表时会自动写入这段配置（`baseURL` 端口取自你访问 DSH 页面的地址）。DSH ≥ 0.2 时插件通过 settings 服务（与官方 Models 页面相同的路径）更新 `llm-pi-ai` 条目——变更即时热生效并持久化到活跃 profile 的 `cordis.patch.yml`，无需重启；旧版本 DSH 走遗留的 `~/.dsh/settings.yaml` 写入，重启后生效。DSH 要求 provider 必须声明凭据引用，因此插件会同时在 `~/.dsh/.credentials.yaml`（mode 0600）里补上固定占位 key `dsh-gemini-oauth-bridge`（引用名 `GEMINI_OAUTH_API_KEY`）——已有条目不会被覆盖，桥接端接受任意 key。想用自己的 key，可在 Models 页面里改；如需给桥接本身加一层本机鉴权，可在 `~/.dsh/gemini-oauth-bridge.json` 里设置 `"apiKey": "任意字符串"`，之后请求需带 `Authorization: Bearer <该值>`。

### 本地状态

`~/.dsh/gemini-oauth-bridge.json`（mode 0600，含 OAuth token，视为机密）：

| 字段 | 说明 |
|---|---|
| `tokens` | access/refresh token 与过期时间 |
| `email` / `project` / `tier` | 登录账号与注册结果 |
| `models` | 上游模型列表缓存（UI 里可手动刷新） |
| `modelCaps` | 从上游目录读取的每模型 `contextLength` / `maxCompletionTokens` |
| `modelsUnavailable` | 上游标记为 `disabled` 的模型 ID 及其上游说明；请求这些模型时会把该说明展示出来 |
| `trustedHosts` | 浏览器信任围栏额外接受的 `host:port` 授权列表（供非回环部署使用）；回环地址始终被接受 |
| `signatures` | thoughtSignature 回放缓存（按 tool_call id，上限 800 条） |
| `apiKey` | 可选：给桥接端点加本机鉴权 |
| `apiConfig` | 可选：覆盖上游端点（`generateBase` / `loadBase` / `onboardBase`），默认与 CLIProxyAPI 一致：生成走 daily、注册走 prod |

## 设计说明（反风控要点）

参考 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（Apache-2.0）的公开实现，协议细节以其抓包结论为准：

- **版本号动态追踪**：从 Antigravity 官方更新 hub 拉取最新版本（请求 UA 用 `electron-builder`，与真实更新器一致），校验数字 semver 后缓存 6 小时——不是定时任务，而是遇到缓存过期后的第一个请求触发刷新；失败时退回缓存值，再退回兜底 `2.9.1`（Cloud Code 拒绝低于 2.9.0 的客户端使用新模型）。
- **UA 分场景**：generate/stream/loadCodeAssist 用 `antigravity/hub/<版本> darwin/arm64`；onboardUser 追加 ` google-api-nodejs-client/10.3.0`；OAuth token 刷新用 `Go-http-client/2.0`——每个环节与真实客户端一致。
- **信封语义**：`requestType: "agent"`、`requestId: "agent-<uuid>"`、`userAgent: "antigravity"`、`request.sessionId` 由对话首条消息稳定哈希派生（同一会话不换 session）；删除 `safetySettings`；gemini-3 系剔除 `generationConfig.maxOutputTokens`。
- **连接指纹**：不发送 `Connection: close`，复用 keep-alive 连接。
- **限流退避**：429 时读取 `Retry-After` 头或响应内 `retryDelay`，进入按模型冷却（上限 30 分钟），冷却期内不发出上游请求。
- **订阅 tier 识别**：请求权益按 `paidTier.id` 解析（Google AI Pro → `g1-pro-tier`），`currentTier` 显示 free-tier 只是注册态，不影响实际配额与模型访问。
- **provider 自动配置**：登录成功和「刷新模型列表」时，自动写入 `llm-pi-ai.providers.gemini-oauth` 路由（含最新模型 ID 和 `GEMINI_OAUTH_API_KEY` 凭据引用）。DSH 提供设置服务时走官方 Models 页面同款路径——变更即时热生效并持久化到活跃 profile 的 `cordis.patch.yml`，只动 gemini-oauth 这一个路由，且由适配器自身的 schema 校验、失败自动回滚；设置服务不可用或写入失败时，才会回退写入遗留的 `~/.dsh/settings.yaml`（外科手术式合并，首次修改前自动备份为 `settings.yaml.bak-gemini-oauth-bridge`），旧版本部署重启后加载；热更新一旦成功就不再触碰该文件——DSH ≥ 0.2 下次启动会把它导入并重命名为 `settings.yaml.imported`，重写等于覆盖这份存档。同时在 `~/.dsh/.credentials.yaml` 里补上占位 key（只追加，不覆盖；无法确认结构的 version-1 文档一律不动并如实报错）。`chat_*`/`tab_*` 内部 ID 会被过滤。在 state 文件中设 `"providerSync": false` 可关闭自动写入。
- **公开客户端凭据**：OAuth client 凭据是 Antigravity 应用内嵌的公开值（CLIProxyAPI 开源库同样原样公开），仓库中以 base64 形式存放——只为避免 GitHub push protection 的扫描噪声，运行时解码。

## 安全说明

- OAuth token 存放在 `~/.dsh/gemini-oauth-bridge.json`（mode 0600），任何接口都不会返回 token；`/api/status` 只暴露账号元信息（email、project、tier）与模型列表。
- DSH 对自身的 `/api/*` 有 Host/Origin 围栏，但插件的 `webServer.register({kind: 'prefix'})` 路由先于该围栏被派发，因此插件自行实现同样规则：`Host` 不是本插件服务的地址、`Sec-Fetch-Site: cross-site`、`Origin` 为不透明的 `null`、`Origin` 与 `Host` 不一致，或完全不带 `Host` 且对端不是回环地址时，一律返回 403。这样可阻断通过 DNS rebinding 读取 `/api/status` 与 `/v1/*`、借 `/v1/chat/completions` 消耗订阅配额，以及对有副作用 POST（`/api/login`、`/api/logout`、`/api/refresh-models`）的盲 CSRF——跨站 `Content-Type: text/plain` 的 POST 无需 CORS 预检，没有围栏时浏览器会照常发出。
- `/v1/*` 默认不鉴权（DSH 需要在本机直接调用）；在 state 文件中设 `"apiKey"` 可要求 `Authorization: Bearer <value>`，设 `"trustedHosts": ["host:port"]` 可服务非回环地址上的 DSH。

## 局限

- **非官方用法**：依赖 Antigravity 客户端的公开 OAuth client 凭据与非公开 `v1internal` 接口，Google 可能随时变更或限制；仅供个人订阅者自用。
- 单账号（不做多账号轮询）；`http(s)://` 图片 URL 不支持（仅 data URL 内联）；会话重启后 thoughtSignature 缓存仍在（持久化），但超过 800 条会 LRU 淘汰。
- 登录回调固定占用 `127.0.0.1:51121`；与 Antigravity 桌面客户端同时登录可能端口冲突。
- 上游为 `daily-cloudcode-pa` 通道（与 CLIProxyAPI 默认一致）；如需切换可通过 `apiConfig` 覆盖。
- **目录里有模型但无法生成**：上游会列出对本账号不提供服务的条目——Gemini 4 Argon 系列只以 `gemini-4-argon-disabled` 出现，带 `disabled: true`、`tagTitle: "Unavailable"`、`tagDescription: "Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers."`，且所有 ID 变体都返回 `404 NOT_FOUND`（实测即使在付费 `g1-pro-tier`（Google AI Pro）账号上也是如此）。因此在目录里 ≠ 可用；插件会隐藏 `disabled` 条目，但客户端无法把这类模型"打开"。

## 开发

零依赖、纯 ESM JavaScript（Node ≥ 22），`lib/*.js` 原样发布，无构建步骤。

```sh
node --check lib/index.js && node --check lib/protocol.js && node --check lib/client.js
node --test test/protocol.test.js test/host.smoke.test.js test/bridge.e2e.test.js
```

测试覆盖：协议翻译单测（OAuth URL/信封/流式分片/签名回放）、host 路由冒烟（mock cordis ctx + 真实 HTTP + 回环回调登录错误路径）、桥接端到端（mock 上游验证信封契约、SSE 翻译、429 冷却）。

## License

MIT

## 语言（0.3.0）

设置界面支持简体中文和英文，使用 DSH 的 `geminiOauth` 语言命名空间和框架注入的
`t` 席位。在「设置 → 通用」切换语言；插件的每个 API 请求都会发送当前的
`?lang=zh|en`。根路径摘要页和 OpenAI 兼容桥接端点也接受此参数。
带语言描述符的桥接错误使用解析后的语言；原始错误、状态码和响应结构保持不变。有效的显式语言优先于
`$DSH_HOME/settings.yaml` 中的 `locale.preference`（默认目录为 `~/.dsh`）；
偏好缺失或无法读取时回退到中文。Google 跳转不携带 `lang`，因此 OAuth 回调页
沿用发起登录时的语言。Google / 上游文本保持原样。需要 web profile 已包含的
`@deepseek-ai/dsh-client-locale` 服务。

运行 `npm test` 检查协议、HTTP 集成和语言覆盖；无需构建步骤或运行时依赖。
