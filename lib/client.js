// lib/client.js — browser half: the Gemini OAuth settings section. Hand-written
// window.__ModuleLoader__.load module factory that requires react at runtime —
// same shape as dsh-mcp-manager / dsh-plugin-updater. Do NOT convert to normal
// ESM imports or the DSH client loader cannot run it.
//
// The page recreates the native DSH settings card with the public --dsw-*
// tokens: card material, state dot, facts, actions and one disclosure. The
// stylesheet is injected once from apply() and scoped by the gob- prefix so
// another OAuth plugin can be loaded beside it.
// UI copy follows DSH's active locale through the geminiOauth namespace.

window.__ModuleLoader__.load({
	id: "dsh-gemini-oauth-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const h = react.createElement;

		const zh = {
  "connectionError": "无法连接插件接口（插件未加载或 DSH 需要重启）",
  "loginOpened": "已打开 Google 登录页，在浏览器完成授权即可；若浏览器拦截了弹窗，请允许后重试。",
  "success": "操作成功",
  "description": "使用拥有 AI Pro 或 AI Ultra 订阅的 Google 账号登录。本地桥接服务用你的订阅配额提供 Gemini 模型，不走 API 计费。",
  "project": "项目",
  "tier": "Tier",
  "version": "客户端版本",
  "models": "模型",
  "login": "登录",
  "cooldown": "限流冷却",
  "relogin": "重新登录",
  "signIn": "登录 Google 账号",
  "refreshModels": "刷新模型列表",
  "refreshQuota": "刷新额度",
  "resetUsage": "重置统计",
  "refreshVersion": "刷新客户端版本",
  "logout": "退出登录",
  "quota": "额度",
  "quotaWeekly": "周额度",
  "quota5h": "5 小时额度",
  "quotaRemaining": "剩余 {percent}%",
  "quotaResetAt": "重置于 {time}",
  "quotaUpdatedAt": "更新于 {time}",
  "quotaDisabled": "已受限",
  "quotaRefreshed": "额度信息已刷新",
  "usageTitle": "本机调用统计",
  "usageSummary": "{requests} 次调用（成功 {succeeded} / 失败 {failed} / 限流 {rateLimited}）· 共 {total} tokens（输入 {prompt} / 输出 {completion}）",
  "usageLastCall": "最近调用：{time}",
  "usageModelItem": "{model}：{requests} 次 · {total} tokens",
  "tabOverview": "账号与配置",
  "tabQuota": "订阅额度",
  "tabUsage": "用量图表",
  "tabModels": "可用模型",
  "kpiRequests": "总调用次数",
  "kpiRequestsSub": "成功 {succeeded} · 失败 {failed} · 限流 {rateLimited}",
  "kpiTokens": "累计 Token",
  "kpiTokensSub": "输入 {prompt} · 输出 {completion}",
  "kpiSuccessRate": "调用成功率",
  "kpiIoRatio": "输入 / 输出占比",
  "chartDailyTitle": "近 7 天趋势（点击某日查看 24 小时）",
  "chartWeekDaysTitle": "{week} · 每日趋势（点击某日查看 24 小时）",
  "chartDayHoursTitle": "{day} · 24 小时明细",
  "chartWeeklyTitle": "近 4 周趋势（点击某周查看 7 天）",
  "chartBackUp": "← 返回上一级",
  "chartModelShareTitle": "按模型 Token 消耗排行",
  "metricTokens": "Tokens（立柱）",
  "metricCalls": "调用次数（折线）",
  "tableTitle": "模型用量明细",
  "colModel": "模型",
  "colCalls": "调用",
  "colPrompt": "输入",
  "colCompletion": "输出",
  "colTotal": "合计",
  "colShare": "占比",
  "quotaEmptyHint": "暂无额度数据，点击下方「刷新额度」获取最新状态。",
  "usageEmptyHint": "暂无调用记录，使用 Gemini OAuth 模型发起对话后将自动生成统计图表。",
  "quotaSignInHint": "登录后即可查看订阅额度。",
  "usageSignInHint": "登录后即可记录并统计调用用量。",
  "modelsSignInHint": "登录后显示可用模型；清单随账号订阅等级而定。",
  "modelsEmptyHint": "暂无模型清单，点击下方「刷新模型」获取。",
  "tokenExpires": "Token 续期",
  "signatureCache": "思考签名缓存",
  "signatureCacheValue": "{count} / 800",
  "unavailableModelsTitle": "当前账号不可用模型",
  "unavailableModelItem": "{model}：{reason}",
  "configHelp": "DSH 要求 provider 提供 key。条目缺失时，插件会在 ~/.dsh/.credentials.yaml 中生成占位 key，且不会覆盖已有值。",
  "sectionLabel": "Gemini OAuth",
  "empty": "-",
  "unknown": "未知原因",
  "credentialFailed": "；占位 key 写入失败（{reason}）",
  "credentialCreated": "；已在 ~/.dsh/.credentials.yaml 生成占位 key {name}",
  "credentialExists": "；凭据 {name} 已存在，未改动",
  "providerFailed": "模型列表已刷新，但写入 provider 配置失败：{reason}",
  "modelsRefreshed": "已刷新 {count} 个模型，并更新 DSH 的 provider 配置{credential}{apply}",
  "hotApplied": "（已热生效，无需重启）",
  "restartRequired": "（该环境不支持热更新，重启 DSH 后生效）",
  "versionRefreshed": "客户端版本已更新：{version}",
  "withSource": "{value}（{source}）",
  "httpError": "HTTP {status}",
  "separator": "；",
  "source_none": "无",
  "source_cache": "缓存",
  "source_manifest": "版本清单",
  "source_fallback": "兜底",
  "source_upstream": "上游",
  "source_default": "默认",
  "stateSignedIn": "已登录",
  "stateSignedOut": "未登录",
  "statePending": "正在登录",
  "stateFailed": "登录失败",
  "stateLoading": "加载中…",
  "stateError": "连接出错",
  "hintSignedIn": "请求使用你的订阅配额，可用模型取决于你的 Google AI 套餐。",
  "hintSignedOut": "打开 Google 登录并在浏览器中完成授权，本页面会自动获取结果。",
  "hintPending": "请在弹出的浏览器标签页中完成授权，本页面会自动更新。",
  "retry": "重试",
  "configuration": "配置",
  "factConfigurationLive": "已实时生效",
  "factConfigurationRestart": "重启 DSH 后生效",
  "factConfigurationPending": "登录后写入",
  "factConfigurationDisabled": "已按状态文件停用",
  "factConfigurationFailed": "配置写入失败：{reason}",
  "cooldownEntry": "{model} 至 {time}",
  "howToTitle": "DSH 如何使用这些模型",
  "howToIntro": "登录成功和刷新模型列表后，桥接插件会写入 llm-pi-ai 的 provider 配置，无需手动编辑。"
};
		const en = {
  "connectionError": "Cannot connect to the plugin API (plugin not loaded or DSH needs a restart)",
  "loginOpened": "Google sign-in opened. Complete authorization in your browser; if the popup was blocked, allow it and retry.",
  "success": "Operation successful",
  "description": "Sign in with a Google account that has AI Pro or AI Ultra. The local bridge serves Gemini models with your subscription quota, not API billing.",
  "project": "Project",
  "tier": "Tier",
  "version": "Client version",
  "models": "Models",
  "login": "Sign-in",
  "cooldown": "Rate-limit cooldown",
  "relogin": "Sign in again",
  "signIn": "Sign in with Google",
  "refreshModels": "Refresh model list",
  "refreshQuota": "Refresh quota",
  "resetUsage": "Reset usage",
  "refreshVersion": "Refresh client version",
  "logout": "Sign out",
  "quota": "Quota",
  "quotaWeekly": "Weekly limit",
  "quota5h": "5-hour limit",
  "quotaRemaining": "{percent}% remaining",
  "quotaResetAt": "Resets at {time}",
  "quotaUpdatedAt": "Updated at {time}",
  "quotaDisabled": "Inactive",
  "quotaRefreshed": "Subscription quota refreshed",
  "usageTitle": "Local call usage",
  "usageSummary": "{requests} calls ({succeeded} ok / {failed} failed / {rateLimited} 429) · {total} tokens ({prompt} in / {completion} out)",
  "usageLastCall": "Last call: {time}",
  "usageModelItem": "{model}: {requests} calls · {total} tokens",
  "tabOverview": "Overview",
  "tabQuota": "Quota",
  "tabUsage": "Usage charts",
  "tabModels": "Models",
  "kpiRequests": "Total calls",
  "kpiRequestsSub": "{succeeded} ok · {failed} failed · {rateLimited} 429",
  "kpiTokens": "Total tokens",
  "kpiTokensSub": "{prompt} in · {completion} out",
  "kpiSuccessRate": "Success rate",
  "kpiIoRatio": "Input / Output split",
  "chartDailyTitle": "7-day trend (click a day for 24h)",
  "chartWeekDaysTitle": "{week} · Daily trend (click a day for 24h)",
  "chartDayHoursTitle": "{day} · 24-hour breakdown",
  "chartWeeklyTitle": "4-week trend (click a week for 7 days)",
  "chartBackUp": "← Back up",
  "chartModelShareTitle": "Token share by model",
  "metricTokens": "Tokens (bar)",
  "metricCalls": "Calls (line)",
  "tableTitle": "Model usage breakdown",
  "colModel": "Model",
  "colCalls": "Calls",
  "colPrompt": "Prompt",
  "colCompletion": "Completion",
  "colTotal": "Total",
  "colShare": "Share",
  "quotaEmptyHint": "No quota data yet. Click Refresh quota below to fetch the latest limits.",
  "usageEmptyHint": "No calls recorded yet. Charts populate automatically once you send requests.",
  "quotaSignInHint": "Sign in to see your subscription quota.",
  "usageSignInHint": "Sign in to start recording usage.",
  "modelsSignInHint": "Sign in to see the available models; the list depends on your plan.",
  "modelsEmptyHint": "No model list yet. Click Refresh model list below.",
  "tokenExpires": "Token renewal",
  "signatureCache": "Signature cache",
  "signatureCacheValue": "{count} / 800",
  "unavailableModelsTitle": "Unavailable on this account",
  "unavailableModelItem": "{model}: {reason}",
  "configHelp": "DSH requires a provider key. The bridge creates a placeholder in ~/.dsh/.credentials.yaml when the entry is missing and never overwrites an existing value.",
  "sectionLabel": "Gemini OAuth",
  "empty": "-",
  "unknown": "Unknown reason",
  "credentialFailed": "; placeholder key could not be written ({reason})",
  "credentialCreated": "; created placeholder key {name} in ~/.dsh/.credentials.yaml",
  "credentialExists": "; credential {name} already exists and was preserved",
  "providerFailed": "Model list refreshed, but provider configuration could not be written: {reason}",
  "modelsRefreshed": "Refreshed {count} models and updated the DSH provider configuration{credential}{apply}",
  "hotApplied": " (applied live, no restart needed)",
  "restartRequired": " (this environment does not support live updates; restart DSH to apply)",
  "versionRefreshed": "Client version updated: {version}",
  "withSource": "{value} ({source})",
  "httpError": "HTTP {status}",
  "separator": "; ",
  "source_none": "None",
  "source_cache": "Cache",
  "source_manifest": "Manifest",
  "source_fallback": "Fallback",
  "source_upstream": "Upstream",
  "source_default": "Default",
  "stateSignedIn": "Signed in",
  "stateSignedOut": "Not signed in",
  "statePending": "Sign-in in progress",
  "stateFailed": "Sign-in failed",
  "stateLoading": "Loading…",
  "stateError": "Connection error",
  "hintSignedIn": "Requests use your subscription quota. Model access follows your Google AI plan.",
  "hintSignedOut": "Open Google sign-in and complete the authorization in your browser. This page picks up the result automatically.",
  "hintPending": "Complete the authorization in the browser tab that opened. This page updates automatically.",
  "retry": "Retry",
  "configuration": "Configuration",
  "factConfigurationLive": "Applied live",
  "factConfigurationRestart": "Restart DSH to apply",
  "factConfigurationPending": "Written after sign-in",
  "factConfigurationDisabled": "Disabled in the state file",
  "factConfigurationFailed": "Configuration failed: {reason}",
  "cooldownEntry": "{model} until {time}",
  "howToTitle": "How DSH uses these models",
  "howToIntro": "The bridge writes the llm-pi-ai provider block after sign-in and after a model refresh. No manual edit is needed."
};

		const inject = ["slots", "locale"];

		// Injected once per apply(). Every selector is namespaced with gob- after
		// the shared root class so this page cannot collide with another OAuth
		// settings section loaded in the same client.
		const STYLES = `
.gob-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  text-align: left;
}

.gob-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.gob-description,
.gob-hint,
.gob-notice {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.gob-notice[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }
.gob-notice[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

.gob-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}

.gob-cardHead {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.gob-state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.gob-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  corner-shape: round;
  background: currentColor;
  color: var(--dsw-alias-state-idle-primary);
}

.gob-dot[data-state="success"] { color: var(--dsw-alias-state-success-primary); }
.gob-dot[data-state="warning"] { color: var(--dsw-alias-state-warn-primary); }
.gob-dot[data-state="error"] { color: var(--dsw-alias-state-error-primary); }

.gob-identity {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}

.gob-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.gob-cardHead > .gob-actions { margin-left: auto; }

.gob-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  text-decoration: none;
  cursor: pointer;
}

.gob-button:disabled { opacity: 0.4; cursor: not-allowed; }

.gob-button[data-variant="primary"] {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

.gob-button[data-variant="outline"] {
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3);
}

.gob-button[data-variant="danger"] {
  color: var(--dsw-alias-state-error-primary);
}

@media (hover: hover) {
  .gob-button[data-variant="primary"]:hover:not(:disabled) {
    background: var(--dsw-alias-button-primary-hover);
  }

  .gob-button[data-variant="outline"]:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }

  .gob-button[data-variant="danger"]:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}

.gob-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
  align-items: start;
  min-width: 0;
}

.gob-factLabel {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.gob-factValue {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.gob-factValue[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

.gob-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.gob-chip {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 17px;
  padding: 1px 8px;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.gob-fold {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}

.gob-fold > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  list-style: none;
}

.gob-fold > summary::-webkit-details-marker { display: none; }

.gob-foldBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 14px 14px;
  min-width: 0;
}

.gob-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  margin-left: auto;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);
  transform: rotate(45deg);
  transition: transform 0.15s ease;
}

.gob-fold[open] .gob-chevron { transform: rotate(-135deg); }

/* The provider card's own model list is a nested disclosure row, not a second
   card: a top hairline and a quiet summary, matching the Models page's nested
   "Customized settings" fold. */
.gob-foldInline {
  border: none;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  background: transparent;
  padding-top: 10px;
  overflow: visible;
}

.gob-foldInline > summary {
  width: fit-content;
  max-width: 100%;
  gap: 6px;
  margin-left: -4px;
  padding: 2px 4px;
  border-radius: var(--dsw-radius-sm);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}

.gob-foldInline > summary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}

.gob-foldInline > .gob-foldBody {
  padding: 4px 0 0;
}

.gob-foldInline .gob-chips { margin-top: 0; }

@media (prefers-reduced-motion: reduce) {
  .gob-chevron { transition: none; }
}

.gob-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: auto;
  white-space: pre;
}

.gob-count {
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}

.gob-quotas {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 10px;
}

.gob-quotaHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.gob-quotaTitle {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

.gob-quotaUpdated {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.gob-quotaGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gob-quotaGroupTitle {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.gob-quotaBuckets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 12px;
}

.gob-quotaBucket {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
}

.gob-quotaRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
}

.gob-quotaWindow {
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
}

.gob-quotaPercent {
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}

.gob-quotaPercent[data-tone="warning"] { color: var(--dsw-alias-state-warn-primary); }
.gob-quotaPercent[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

.gob-quotaBar {
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
}

.gob-quotaFill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-primary);
}

.gob-quotaFill[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.gob-quotaFill[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }

.gob-quotaMeta {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.gob-chipMeta {
  margin-left: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
}

.gob-usage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 10px;
}

.gob-usageLine {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.gob-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-module-platform);
  border: 0.5px solid var(--dsw-alias-border-l2);
}

.gob-tab {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--dsw-radius-md);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.gob-tab:hover {
  color: var(--dsw-alias-label-primary);
}

.gob-tab[data-active="true"] {
  background: var(--dsw-alias-bg-layer-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.gob-tabBadge {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.gob-panel[hidden] {
  display: none !important;
}

.gob-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gob-kpiGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

.gob-kpiCard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
}

.gob-kpiLabel {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.gob-kpiValue {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}

.gob-kpiSub {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.gob-splitBar {
  display: flex;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  margin-top: 2px;
}

.gob-splitPrompt {
  height: 100%;
  background: var(--dsw-alias-brand-primary);
}

.gob-splitCompletion {
  height: 100%;
  background: var(--dsw-alias-state-success-primary);
}

.gob-chartBox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
}

.gob-chartTitle {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.gob-svgChart {
  width: 100%;
  height: 120px;
  display: block;
  overflow: visible;
}

.gob-barList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gob-barItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gob-barTrack {
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
}

.gob-barFill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
}

.gob-chartToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.gob-backLink {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-base);
  border: 0.5px solid var(--dsw-alias-border-l2);
  cursor: pointer;
  user-select: none;
}

.gob-backLink:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.gob-barGroup[data-clickable="true"] {
  cursor: pointer;
}

.gob-barGroup[data-clickable="true"]:hover rect {
  opacity: 0.85;
}

.gob-legend {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}

.gob-legendItem {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.gob-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}

.gob-donutGrid {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

@media (max-width: 520px) {
  .gob-donutGrid { grid-template-columns: 1fr; justify-items: center; }
}

.gob-donutSvg {
  width: 132px;
  height: 132px;
  display: block;
}

.gob-tableWrap {
  overflow-x: auto;
}

.gob-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.gob-table th {
  text-align: left;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
  padding: 6px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  white-space: nowrap;
}

.gob-table td {
  padding: 7px 8px;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  white-space: nowrap;
}

.gob-table tr:last-child td {
  border-bottom: none;
}

.gob-table th[data-num="true"],
.gob-table td[data-num="true"] {
  text-align: right;
}
`;

		function installStyles() {
			// The module is also evaluated in Node tests, where there is no DOM.
			if (typeof document === "undefined" || !document || typeof document.createElement !== "function" || !document.head) {
				return () => {};
			}
			const style = document.createElement("style");
			style.setAttribute("data-dsh-plugin", "gemini-oauth-bridge");
			style.textContent = STYLES;
			document.head.appendChild(style);
			return () => {
				if (style.parentNode) style.parentNode.removeChild(style);
			};
		}

		function sourceLabel(t, source) {
			const key = "source_" + String(source || "none");
			const label = t(key);
			return label === undefined || label === key ? t("source_none") : label;
		}

		function configurationLabel(t, sync) {
			if (!sync) return t("factConfigurationPending");
			// `providerSync: false` in the state file is a deliberate opt-out, not a
			// write failure: report it as disabled instead of failed.
			if (sync.skipped) return t("factConfigurationDisabled");
			if (sync.ok === false) return t("factConfigurationFailed", { reason: sync.reason ?? t("unknown") });
			return t(sync.hotReload ? "factConfigurationLive" : "factConfigurationRestart");
		}

		function configurationTone(sync) {
			const failed = !!sync && sync.ok === false && !sync.skipped;
			return failed ? "error" : undefined;
		}

		function bucketWindowLabel(t, bucket) {
			if (!bucket) return "";
			if (bucket.window === "weekly") return t("quotaWeekly");
			if (bucket.window === "5h") return t("quota5h");
			return bucket.name || bucket.window || t("quota");
		}

		function bucketTone(bucket) {
			if (!bucket || bucket.disabled || typeof bucket.remaining !== "number") return undefined;
			if (bucket.remaining <= 0.1) return "error";
			if (bucket.remaining <= 0.3) return "warning";
			return undefined;
		}

		function formatResetTime(resetAt) {
			if (!Number.isFinite(resetAt) || resetAt <= 0) return "";
			try {
				return new Date(resetAt).toLocaleString();
			} catch {
				return "";
			}
		}

		function formatCompactNumber(n) {
			const val = Number(n);
			if (!Number.isFinite(val) || val <= 0) return "0";
			if (val >= 1000000) {
				const m = val >= 1048576 && val % 1048576 === 0 ? val / 1048576 : Math.round((val / 1000000) * 10) / 10;
				return m + "M";
			}
			if (val >= 1000) {
				const k = val >= 1024 && val % 1024 === 0 ? val / 1024 : Math.round((val / 1000) * 10) / 10;
				return k + "K";
			}
			return String(Math.round(val));
		}

		function formatModelChipMeta(entry) {
			if (!entry || typeof entry !== "object") return "";
			const parts = [];
			if (entry.reasoningEfforts && typeof entry.reasoningEfforts === "object") {
				const levels = Object.keys(entry.reasoningEfforts);
				if (levels.length) parts.push(levels.join("/"));
			}
			const caps = [];
			if (Number.isFinite(entry.contextWindow) && entry.contextWindow > 0) caps.push(formatCompactNumber(entry.contextWindow));
			if (Number.isFinite(entry.maxTokens) && entry.maxTokens > 0) caps.push(formatCompactNumber(entry.maxTokens));
			if (caps.length) parts.push(caps.join("·"));
			return parts.length ? "(" + parts.join(" · ") + ")" : "";
		}

		const MODEL_PALETTE = [
			"#4f8cff",
			"#10b981",
			"#a855f7",
			"#f59e0b",
			"#ec4899",
			"#06b6d4",
			"#6366f1",
			"#84cc16",
		];

		function buildDrilldownBuckets(usageStats, viewState) {
			const now = new Date();
			const lastTs = Number(usageStats?.lastCallAt) || 0;
			const fallbackD = lastTs > 0 ? new Date(lastTs) : null;
			const fallbackDayKey = fallbackD
				? fallbackD.getFullYear() + "-" + String(fallbackD.getMonth() + 1).padStart(2, "0") + "-" + String(fallbackD.getDate()).padStart(2, "0")
				: "";
			const fallbackHourKey = fallbackD
				? fallbackDayKey + "T" + String(fallbackD.getHours()).padStart(2, "0")
				: "";
			const rawHourMap = usageStats && usageStats.byHour && typeof usageStats.byHour === "object" ? usageStats.byHour : {};
			const rawDayMap = usageStats && usageStats.byDay && typeof usageStats.byDay === "object" ? usageStats.byDay : {};
			const hourMap = Object.keys(rawHourMap).length > 0
				? rawHourMap
				: fallbackHourKey && (Number(usageStats?.requests) || 0) > 0
					? { [fallbackHourKey]: usageStats }
					: {};
			const dayMap = Object.keys(rawDayMap).length > 0
				? rawDayMap
				: fallbackDayKey && (Number(usageStats?.requests) || 0) > 0
					? { [fallbackDayKey]: usageStats }
					: {};

			const fmtYmd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
			const fmtMd = (d) => String(d.getMonth() + 1) + "/" + String(d.getDate());
			const parseYmd = (str) => {
				const m = typeof str === "string" ? str.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
				return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
			};

			const out = [];
			const level = viewState && viewState.level ? viewState.level : "days";

			if (level === "hours") {
				const dayKey = viewState?.dayKey || fmtYmd(now);
				const hasAnyHourForDay = Object.keys(hourMap).some((k) => k.startsWith(dayKey + "T"));
				const dayStat = dayMap[dayKey];
				const fallbackHr = dayKey === fallbackDayKey && fallbackD ? String(fallbackD.getHours()).padStart(2, "0") : "12";
				for (let hr = 0; hr < 24; hr++) {
					const hh = String(hr).padStart(2, "0");
					const key = dayKey + "T" + hh;
					const item = hourMap[key] || (!hasAnyHourForDay && dayStat && hh === fallbackHr ? dayStat : {});
					const prompt = Number(item.promptTokens) || 0;
					const comp = Number(item.completionTokens) || 0;
					const total = Number(item.totalTokens) || prompt + comp;
					const reqs = Number(item.requests) || 0;
					const ok = Number(item.succeeded) || 0;
					const fail = Number(item.failed) || Math.max(0, reqs - ok);
					out.push({
						key,
						label: hr % 4 === 0 || hr === 23 ? hh + ":00" : "",
						period: dayKey + " " + hh + ":00–" + hh + ":59",
						promptTokens: prompt,
						completionTokens: comp,
						totalTokens: total,
						requests: reqs,
						succeeded: ok,
						failed: fail,
						rateLimited: Number(item.rateLimited) || 0,
						drillTarget: null,
					});
				}
				return out;
			}

			if (level === "weeks") {
				for (let w = 3; w >= 0; w--) {
					const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - w * 7);
					const startD = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 6);
					let prompt = 0;
					let comp = 0;
					let total = 0;
					let reqs = 0;
					let ok = 0;
					let fail = 0;
					let rateLimited = 0;
					for (let dIdx = 0; dIdx < 7; dIdx++) {
						const curD = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + dIdx);
						const item = dayMap[fmtYmd(curD)] || {};
						const p = Number(item.promptTokens) || 0;
						const c = Number(item.completionTokens) || 0;
						const tot = Number(item.totalTokens) || p + c;
						const r = Number(item.requests) || 0;
						const s = Number(item.succeeded) || 0;
						const f = Number(item.failed) || Math.max(0, r - s);
						prompt += p;
						comp += c;
						total += tot;
						reqs += r;
						ok += s;
						fail += f;
						rateLimited += Number(item.rateLimited) || 0;
					}
					const startKey = fmtYmd(startD);
					const label = fmtMd(startD) + "–" + fmtMd(endD);
					out.push({
						key: "week-" + startKey,
						label,
						period: fmtYmd(startD) + " ~ " + fmtYmd(endD),
						promptTokens: prompt,
						completionTokens: comp,
						totalTokens: total,
						requests: reqs,
						succeeded: ok,
						failed: fail,
						rateLimited,
						drillTarget: { level: "days", weekStartKey: startKey, weekLabel: label },
					});
				}
				return out;
			}

			// Default level === "days": either a drilled week's 7 days or the last 7 days
			const startBase = viewState?.weekStartKey
				? parseYmd(viewState.weekStartKey)
				: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
			for (let i = 0; i < 7; i++) {
				const d = new Date(startBase.getFullYear(), startBase.getMonth(), startBase.getDate() + i);
				const key = fmtYmd(d);
				const label = fmtMd(d);
				const item = dayMap[key] || {};
				const prompt = Number(item.promptTokens) || 0;
				const comp = Number(item.completionTokens) || 0;
				const total = Number(item.totalTokens) || prompt + comp;
				const reqs = Number(item.requests) || 0;
				const ok = Number(item.succeeded) || 0;
				const fail = Number(item.failed) || Math.max(0, reqs - ok);
				out.push({
					key,
					label,
					period: key,
					promptTokens: prompt,
					completionTokens: comp,
					totalTokens: total,
					requests: reqs,
					succeeded: ok,
					failed: fail,
					rateLimited: Number(item.rateLimited) || 0,
					drillTarget: { level: "hours", dayKey: key, dayLabel: label, weekStartKey: viewState?.weekStartKey || null, weekLabel: viewState?.weekLabel || null },
				});
			}
			return out;
		}

		function renderTrendSvgChart(buckets, onBarClick, onHoverBucket) {
			const maxTok = Math.max(1, ...buckets.map((b) => b.totalTokens));
			const maxCalls = Math.max(1, ...buckets.map((b) => b.requests));
			const width = 480;
			const height = 148;
			const padLeft = 38;
			const padRight = 28;
			const topY = 18;
			const baseY = 120;
			const plotW = width - padLeft - padRight;
			const plotH = baseY - topY;
			const slotW = plotW / Math.max(1, buckets.length);
			const barW = Math.max(6, Math.min(26, Math.floor(slotW * 0.56)));

			const gridRatios = [0, 0.5, 1];
			const linePoints = [];
			const callDots = [];

			buckets.forEach((b, idx) => {
				const cx = Math.round(padLeft + idx * slotW + slotW / 2);
				const cy = Math.round(baseY - (b.requests / maxCalls) * plotH);
				linePoints.push(cx + "," + cy);
				callDots.push({ key: b.key, cx, cy, requests: b.requests });
			});

			return h("svg", {
				className: "gob-svgChart",
				viewBox: "0 0 " + width + " " + height,
			},
				gridRatios.map((r, idx) => {
					const y = Math.round(baseY - r * plotH);
					const tickTok = Math.round(maxTok * r);
					const tickCalls = Math.round(maxCalls * r);
					return h("g", { key: "grid-" + idx },
						h("line", {
							x1: padLeft,
							y1: y,
							x2: width - padRight,
							y2: y,
							stroke: "var(--dsw-alias-border-l2)",
							strokeWidth: 1,
							strokeDasharray: r === 0 ? undefined : "3,3",
						}),
						h("text", {
							x: padLeft - 6,
							y: y + 3,
							textAnchor: "end",
							fontSize: "9",
							fill: "var(--dsw-alias-label-tertiary)",
						}, r === 0 ? "0" : formatCompactNumber(tickTok)),
						h("text", {
							x: width - padRight + 5,
							y: y + 3,
							textAnchor: "start",
							fontSize: "9",
							fill: "#a855f7",
						}, r === 0 ? "0" : String(tickCalls)));
				}),
				buckets.map((b, idx) => {
					const cx = padLeft + idx * slotW + slotW / 2;
					const x = Math.round(cx - barW / 2);
					const barH = b.totalTokens > 0 ? Math.max(4, Math.round((b.totalTokens / maxTok) * plotH)) : 2;
					const yTop = baseY - barH;
					const clickable = !!b.drillTarget;
					return h("g", {
						key: b.key,
						className: "gob-barGroup",
						"data-clickable": clickable ? "true" : undefined,
						onMouseEnter: () => onHoverBucket && onHoverBucket(b),
						onClick: clickable && onBarClick ? () => onBarClick(b.drillTarget) : undefined,
					},
						h("rect", {
							x: Math.round(padLeft + idx * slotW),
							y: topY,
							width: Math.max(1, Math.round(slotW)),
							height: plotH,
							fill: "transparent",
						}),
						h("rect", {
							x,
							y: yTop,
							width: barW,
							height: barH,
							rx: 3,
							fill: b.totalTokens > 0 ? "#4f8cff" : "var(--dsw-alias-border-l2)",
						}),
						b.totalTokens > 0 && buckets.length <= 14
							? h("text", {
									x: cx,
									y: Math.max(10, yTop - 4),
									textAnchor: "middle",
									fontSize: "9",
									fill: "var(--dsw-alias-label-secondary)",
								}, formatCompactNumber(b.totalTokens))
							: null,
						b.label
							? h("text", {
									x: cx,
									y: baseY + 15,
									textAnchor: "middle",
									fontSize: "9",
									fill: "var(--dsw-alias-label-tertiary)",
								}, b.label)
							: null);
				}),
				buckets.length > 1
					? h("polyline", {
							fill: "none",
							stroke: "#a855f7",
							strokeWidth: 1.75,
							points: linePoints.join(" "),
							style: { pointerEvents: "none" },
						})
					: null,
				callDots.map((d) =>
					h("circle", {
						key: "dot-" + d.key,
						cx: d.cx,
						cy: d.cy,
						r: d.requests > 0 ? 3 : 2,
						fill: d.requests > 0 ? "#a855f7" : "var(--dsw-alias-border-l2)",
						style: { pointerEvents: "none" },
					})));
		}

		function renderDonutSvg(modelEntries, totalTok) {
			const r = 46;
			const cx = 66;
			const cy = 66;
			const c = 2 * Math.PI * r;
			let acc = 0;
			const slices = modelEntries.map(([mId, mStat], idx) => {
				const val = Number(mStat?.totalTokens) || 0;
				const frac = totalTok > 0 ? val / totalTok : 0;
				const len = frac * c;
				const offset = -acc;
				acc += len;
				return h("circle", {
					key: "slice-" + mId,
					cx,
					cy,
					r,
					fill: "transparent",
					stroke: MODEL_PALETTE[idx % MODEL_PALETTE.length],
					strokeWidth: 14,
					strokeDasharray: len + " " + Math.max(0, c - len),
					strokeDashoffset: offset,
					transform: "rotate(-90 " + cx + " " + cy + ")",
				});
			});
			return h("svg", { className: "gob-donutSvg", viewBox: "0 0 132 132", "aria-hidden": "true" },
				h("circle", {
					cx,
					cy,
					r,
					fill: "transparent",
					stroke: "var(--dsw-alias-border-l2)",
					strokeWidth: 14,
				}),
				slices,
				h("text", {
					x: cx,
					y: cy - 2,
					textAnchor: "middle",
					fontSize: "13",
					fontWeight: "600",
					fill: "var(--dsw-alias-label-primary)",
				}, formatCompactNumber(totalTok)),
				h("text", {
					x: cx,
					y: cy + 13,
					textAnchor: "middle",
					fontSize: "9",
					fill: "var(--dsw-alias-label-tertiary)",
				}, "TOKENS"));
		}

		function pagePort() {
			try {
				const scope = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : undefined;
				const port = scope && scope.location ? scope.location.port : "";
				if (typeof port === "string" && /^\d+$/.test(port)) return port;
			} catch {}
			return "3080";
		}

		function configSnippet(status) {
			const models = status && Array.isArray(status.models) ? status.models : [];
			const first = models.length ? String(models[0]) : "gemini-3-pro";
			return [
				"llm-pi-ai:",
				"  providers:",
				"    gemini-oauth:",
				"      api: openai-completions",
				"      baseURL: http://127.0.0.1:" + pagePort() + "/gemini-oauth-bridge/v1",
				"      apiKeyEnv: GEMINI_OAUTH_API_KEY",
				"      models:",
				"        - id: " + first,
			].join("\n");
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("geminiOauth", { zh, en }), "dsh-gemini-oauth-bridge: dictionaries");
			ctx.effect(() => installStyles(), "dsh-gemini-oauth-bridge: styles");
			const t = ctx.locale.bind("geminiOauth");

			const api = (path, options) =>
				fetch("/gemini-oauth-bridge/api" + path + (path.includes("?") ? "&" : "?") + new URLSearchParams({ lang: ctx.locale.getLocale().active }), {
					headers: { "Content-Type": "application/json" },
					...options,
				}).then(async (resp) => ({ ok: resp.ok, status: resp.status, body: await resp.json().catch(() => ({})) }));

			function factRow(key, label, value, tone) {
				return [
					h("div", { className: "gob-factLabel", key: key + "-label" }, label),
					h("div", { className: "gob-factValue", key: key + "-value", "data-tone": tone }, value),
				];
			}

			function GeminiSection({ t }) {
				const [status, setStatus] = react.useState(null);
				const [busy, setBusy] = react.useState(false);
				const [notice, setNotice] = react.useState(null);
				const [loginFailed, setLoginFailed] = react.useState(false);
				const [attempt, setAttempt] = react.useState(0);
				const [activeTab, setActiveTab] = react.useState("overview");
				const [chartView, setChartView] = react.useState({ level: "days" });
				const [hoverBucket, setHoverBucket] = react.useState(null);

				const refresh = () => {
					api("/status")
						.then((r) => setStatus(r.body && typeof r.body === "object" ? r.body : {}))
						.catch(() => setStatus({ ok: false, error: t("connectionError") }));
				};

				react.useEffect(() => {
					let live = true;
					let refreshedOnOpen = false;
					const poll = () => {
						api("/status")
							.then((r) => {
								if (!live) return;
								const body = r.body && typeof r.body === "object" ? r.body : {};
								setStatus(body);
								// The "sign-in opened" hint describes a flow that is still in
								// progress, so it must not outlive it: once the callback has
								// been handled (success, Google error, or stale state) the
								// status line carries the outcome instead.
								if (!body.loginPending) {
									setNotice((prev) => (prev && prev.kind === "info" ? null : prev));
								}
								if (!refreshedOnOpen && body.loggedIn) {
									refreshedOnOpen = true;
									api("/refresh-quota", { method: "POST" })
										.then((qr) => {
											if (live && qr.ok && qr.body && qr.body.quota) {
												setStatus((prev) => (prev && typeof prev === "object" ? { ...prev, quota: qr.body.quota } : prev));
											}
										})
										.catch(() => {});
								}
							})
							.catch(() => {
								if (live) setStatus({ ok: false, error: t("connectionError") });
							});
					};
					poll();
					const timer = setInterval(poll, 3000);
					return () => {
						live = false;
						clearInterval(timer);
					};
				}, [attempt]);

				const retry = () => {
					setNotice(null);
					setLoginFailed(false);
					setStatus(null);
					setAttempt((value) => value + 1);
				};

				const post = async (path) => {
					setBusy(true);
					setNotice(null);
					if (path === "login" || path === "logout") setLoginFailed(false);
					try {
						const r = await api("/" + path, { method: "POST", body: "{}" });
						if (!r.ok || r.body.error) {
							setNotice({ kind: "error", text: String(r.body.error ?? t("httpError", { status: r.status })) });
							if (path === "login") setLoginFailed(true);
						} else if (path === "login" && r.body.authUrl) {
							if (typeof window !== "undefined" && typeof window.open === "function") window.open(r.body.authUrl, "_blank", "noopener");
							setNotice({ kind: "info", text: t("loginOpened") });
						} else if (path === "refresh-models") {
							const p = r.body.provider ?? {};
							const cred = p.credential ?? {};
							let credNote;
							if (cred.ok === false) credNote = t("credentialFailed", { reason: cred.reason ?? t("unknown") });
							else if (cred.created) credNote = t("credentialCreated", { name: p.apiKeyEnv ?? "" });
							else credNote = t("credentialExists", { name: p.apiKeyEnv ?? "" });
							setNotice({
								kind: p.ok === false ? "error" : "ok",
								text: p.ok === false
									? t("providerFailed", { reason: p.reason ?? t("unknown") })
									: t("modelsRefreshed", {
											count: (r.body.models ?? []).length,
											credential: credNote,
											apply: t(p.hotReload ? "hotApplied" : "restartRequired"),
										}),
							});
						} else if (path === "refresh-quota") {
							setNotice({ kind: "ok", text: t("quotaRefreshed") });
						} else if (path === "refresh-version") {
							setNotice({ kind: "ok", text: t("versionRefreshed", { version: r.body.version }) });
						} else {
							setNotice({ kind: "ok", text: t("success") });
						}
					} catch (e) {
						setNotice({ kind: "error", text: String(e) });
						if (path === "login") setLoginFailed(true);
					}
					setBusy(false);
					refresh();
				};

				const loading = !status;
				const error = status && status.error ? String(status.error) : null;
				const signedIn = !!(status && status.loggedIn);
				const pending = !!(status && status.loginPending);
				const models = status && Array.isArray(status.models) ? status.models : [];
				const groupedModels = status && Array.isArray(status.groupedModels) && status.groupedModels.length
					? status.groupedModels
					: models.map((id) => ({
						id: String(id),
						...(status?.modelCaps?.[id]?.contextLength ? { contextWindow: status.modelCaps[id].contextLength } : {}),
						...(status?.modelCaps?.[id]?.maxCompletionTokens ? { maxTokens: status.modelCaps[id].maxCompletionTokens } : {}),
					}));
				const unavailableEntries = status && status.unavailableModels && typeof status.unavailableModels === "object"
					? Object.entries(status.unavailableModels)
					: [];
				const quotaGroups = status && status.quota && Array.isArray(status.quota.groups) ? status.quota.groups : [];
				const quotaUpdatedText = status && status.quota ? formatResetTime(status.quota.fetchedAt) : "";
				const usageStats = status && status.usageStats && typeof status.usageStats === "object" ? status.usageStats : null;
				const usageModelEntries = usageStats && usageStats.byModel && typeof usageStats.byModel === "object"
					? Object.entries(usageStats.byModel).sort((a, b) => (Number(b[1]?.requests) || 0) - (Number(a[1]?.requests) || 0))
					: [];
				const cooldowns = status && status.cooldowns && typeof status.cooldowns === "object"
					? Object.entries(status.cooldowns)
					: [];

				let stateKey = "stateLoading";
				let dotState = "idle";
				let hint = null;
				if (status && !error) {
					if (pending) {
						stateKey = "statePending";
						dotState = "warning";
						hint = t("hintPending");
					} else if (signedIn) {
						stateKey = "stateSignedIn";
						dotState = "success";
						hint = t("hintSignedIn");
					} else if (loginFailed) {
						stateKey = "stateFailed";
						dotState = "error";
						hint = t("hintSignedOut");
					} else {
						stateKey = "stateSignedOut";
						dotState = "idle";
						hint = t("hintSignedOut");
					}
				} else if (error) {
					stateKey = "stateError";
					dotState = "error";
				}

				const button = (key, label, variant, onClick) =>
					h("button", {
						key,
						type: "button",
						className: "gob-button",
						"data-variant": variant,
						disabled: busy,
						"aria-busy": busy ? "true" : undefined,
						onClick,
					}, label);

				const headActions = error
					? button("retry", t("retry"), "outline", retry)
					: loading
						? null
						: button("signin", signedIn ? t("relogin") : t("signIn"), signedIn ? "outline" : "primary", () => post("login"));

				const quotaSection = status && !error && signedIn && quotaGroups.length
					? h("div", { className: "gob-quotas" },
						h("div", { className: "gob-quotaHead" },
							h("span", { className: "gob-quotaTitle" }, t("quota")),
							quotaUpdatedText ? h("span", { className: "gob-quotaUpdated" }, t("quotaUpdatedAt", { time: quotaUpdatedText })) : null),
						quotaGroups.map((group, gIdx) => {
							const buckets = Array.isArray(group.buckets) ? group.buckets : [];
							return h("div", { className: "gob-quotaGroup", key: String(group.name || gIdx) },
								h("div", { className: "gob-quotaGroupTitle" }, String(group.name || t("quota"))),
								h("div", { className: "gob-quotaBuckets" },
									buckets.map((bucket, bIdx) => {
										const hasPct = !bucket.disabled && typeof bucket.remaining === "number" && Number.isFinite(bucket.remaining);
										const pct = hasPct ? Math.round(Math.max(0, Math.min(1, bucket.remaining)) * 100) : null;
										const tone = bucketTone(bucket);
										const resetText = formatResetTime(bucket.resetAt);
										return h("div", { className: "gob-quotaBucket", key: String(bucket.id || bucket.window || bIdx) },
											h("div", { className: "gob-quotaRow" },
												h("span", { className: "gob-quotaWindow" }, bucketWindowLabel(t, bucket)),
												h("span", { className: "gob-quotaPercent", "data-tone": tone },
													bucket.disabled
														? t("quotaDisabled")
														: pct !== null
															? t("quotaRemaining", { percent: pct })
															: t("empty"))),
											pct !== null
												? h("div", { className: "gob-quotaBar", "aria-hidden": "true" },
													h("div", { className: "gob-quotaFill", "data-tone": tone, style: { width: pct + "%" } }))
												: null,
											resetText
												? h("div", { className: "gob-quotaMeta" }, t("quotaResetAt", { time: resetText }))
												: null);
									})));
						}))
					: null;

				const usageSection = status && !error && signedIn && usageStats
					? (() => {
							const view = chartView && typeof chartView === "object" ? chartView : { level: "days" };
							const buckets = buildDrilldownBuckets(usageStats, view);
							const periodSummary = {
								requests: buckets.reduce((acc, b) => acc + (Number(b.requests) || 0), 0),
								succeeded: buckets.reduce((acc, b) => acc + (Number(b.succeeded) || 0), 0),
								failed: buckets.reduce((acc, b) => acc + (Number(b.failed) || 0), 0),
								rateLimited: buckets.reduce((acc, b) => acc + (Number(b.rateLimited) || 0), 0),
								promptTokens: buckets.reduce((acc, b) => acc + (Number(b.promptTokens) || 0), 0),
								completionTokens: buckets.reduce((acc, b) => acc + (Number(b.completionTokens) || 0), 0),
								totalTokens: buckets.reduce((acc, b) => acc + (Number(b.totalTokens) || 0), 0),
							};
							const activeStat = hoverBucket || periodSummary;
							const reqCount = Number(activeStat.requests) || 0;
							const okCount = Number(activeStat.succeeded) || 0;
							const failCount = Number(activeStat.failed) || 0;
							const rlCount = Number(activeStat.rateLimited) || 0;
							const promptTok = Number(activeStat.promptTokens) || 0;
							const compTok = Number(activeStat.completionTokens) || 0;
							const totalTok = Number(activeStat.totalTokens) || promptTok + compTok;
							const allModelsTotalTok = Math.max(1, Number(usageStats.totalTokens) || periodSummary.totalTokens);
							const successPct = reqCount > 0 ? Math.round((okCount / reqCount) * 100) : 100;
							const promptPct = totalTok > 0 ? Math.round((promptTok / totalTok) * 100) : 50;
							const compPct = totalTok > 0 ? Math.max(0, 100 - promptPct) : 50;
							const maxModelTok = Math.max(1, ...usageModelEntries.map(([, m]) => Number(m?.totalTokens) || 0));

							let chartTitleText = t("chartDailyTitle");
							let parentView = { level: "weeks" };
							if (view.level === "hours") {
								chartTitleText = t("chartDayHoursTitle", { day: view.dayLabel || view.dayKey || "" });
								parentView = { level: "days", weekStartKey: view.weekStartKey || null, weekLabel: view.weekLabel || null };
							} else if (view.level === "weeks") {
								chartTitleText = t("chartWeeklyTitle");
								parentView = null;
							} else if (view.weekLabel) {
								chartTitleText = t("chartWeekDaysTitle", { week: view.weekLabel });
								parentView = { level: "weeks" };
							}

							return h("div", { className: "gob-usage" },
								h("div", { className: "gob-quotaHead" },
									h("span", { className: "gob-quotaTitle" }, t("usageTitle") + " · " + (hoverBucket ? hoverBucket.period : chartTitleText)),
									usageStats.lastCallAt
										? h("span", { className: "gob-quotaUpdated" }, t("usageLastCall", { time: formatResetTime(usageStats.lastCallAt) }))
										: null),
								h("div", { className: "gob-kpiGrid" },
									h("div", { className: "gob-kpiCard" },
										h("span", { className: "gob-kpiLabel" }, t("kpiRequests")),
										h("span", { className: "gob-kpiValue" }, String(reqCount)),
										h("span", { className: "gob-kpiSub" }, t("kpiRequestsSub", { succeeded: okCount, failed: failCount, rateLimited: rlCount }))),
									h("div", { className: "gob-kpiCard" },
										h("span", { className: "gob-kpiLabel" }, t("kpiTokens")),
										h("span", { className: "gob-kpiValue" }, formatCompactNumber(totalTok)),
										h("span", { className: "gob-kpiSub" }, t("kpiTokensSub", { prompt: formatCompactNumber(promptTok), completion: formatCompactNumber(compTok) }))),
									h("div", { className: "gob-kpiCard" },
										h("span", { className: "gob-kpiLabel" }, t("kpiSuccessRate")),
										h("span", { className: "gob-kpiValue" }, reqCount > 0 ? successPct + "%" : t("empty")),
										h("span", { className: "gob-kpiSub" }, t("usageSummary", {
											requests: reqCount,
											succeeded: okCount,
											failed: failCount,
											rateLimited: rlCount,
											total: formatCompactNumber(totalTok),
											prompt: formatCompactNumber(promptTok),
											completion: formatCompactNumber(compTok),
										}))),
									h("div", { className: "gob-kpiCard" },
										h("span", { className: "gob-kpiLabel" }, t("kpiIoRatio")),
										h("span", { className: "gob-kpiValue" }, totalTok > 0 ? promptPct + "% / " + compPct + "%" : t("empty")),
										h("div", { className: "gob-splitBar", "aria-hidden": "true" },
											h("div", { className: "gob-splitPrompt", style: { width: promptPct + "%" } }),
											h("div", { className: "gob-splitCompletion", style: { width: compPct + "%" } })))),
								h("div", { className: "gob-chartBox" },
									h("div", { className: "gob-chartToolbar" },
										h("div", { style: { display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
											h("span", { className: "gob-chartTitle" }, chartTitleText),
											parentView
												? h("span", {
														className: "gob-backLink",
														onClick: () => {
															setHoverBucket(null);
															setChartView(parentView);
														},
													}, t("chartBackUp"))
												: null),
										h("div", { className: "gob-legend" },
											h("span", { className: "gob-legendItem" },
												h("span", { className: "gob-swatch", style: { background: "#4f8cff" } }),
												t("metricTokens")),
											h("span", { className: "gob-legendItem" },
												h("span", { className: "gob-swatch", style: { background: "#a855f7", borderRadius: "999px" } }),
												t("metricCalls")))),
									h("div", { onMouseLeave: () => setHoverBucket(null) },
										renderTrendSvgChart(
											buckets,
											(target) => {
												setHoverBucket(null);
												setChartView(target);
											},
											setHoverBucket,
										))),
								usageModelEntries.length
									? h("div", { className: "gob-chartBox" },
										h("div", { className: "gob-chartTitle" }, t("chartModelShareTitle")),
										h("div", { className: "gob-donutGrid" },
											renderDonutSvg(usageModelEntries, allModelsTotalTok),
											h("div", { className: "gob-barList" },
												usageModelEntries.map(([mId, mStat], idx) => {
													const mTok = Number(mStat?.totalTokens) || 0;
													const sharePct = allModelsTotalTok > 0 ? Math.round((mTok / allModelsTotalTok) * 100) : 0;
													const widthPct = Math.max(3, Math.round((mTok / maxModelTok) * 100));
													const color = MODEL_PALETTE[idx % MODEL_PALETTE.length];
													return h("div", { className: "gob-barItem", key: String(mId) },
														h("div", { className: "gob-quotaRow" },
															h("span", { className: "gob-legendItem" },
																h("span", { className: "gob-swatch", style: { background: color } }),
																h("span", { className: "gob-quotaWindow" }, String(mId))),
															h("span", { className: "gob-quotaPercent" }, t("usageModelItem", {
																model: sharePct + "%",
																requests: mStat?.requests || 0,
																total: formatCompactNumber(mTok),
															}))),
														h("div", { className: "gob-barTrack", "aria-hidden": "true" },
															h("div", { className: "gob-barFill", style: { width: widthPct + "%", background: color } })));
												}))))
									: h("p", { className: "gob-hint" }, t("usageEmptyHint")),
								usageModelEntries.length
									? h("div", { className: "gob-chartBox" },
										h("div", { className: "gob-chartTitle" }, t("tableTitle")),
										h("div", { className: "gob-tableWrap" },
											h("table", { className: "gob-table" },
												h("thead", null,
													h("tr", null,
														h("th", null, t("colModel")),
														h("th", { "data-num": "true" }, t("colCalls")),
														h("th", { "data-num": "true" }, t("colPrompt")),
														h("th", { "data-num": "true" }, t("colCompletion")),
														h("th", { "data-num": "true" }, t("colTotal")),
														h("th", { "data-num": "true" }, t("colShare")))),
												h("tbody", null,
													usageModelEntries.map(([mId, mStat], idx) => {
														const mTok = Number(mStat?.totalTokens) || 0;
														const sharePct = allModelsTotalTok > 0 ? Math.round((mTok / allModelsTotalTok) * 100) : 0;
														const color = MODEL_PALETTE[idx % MODEL_PALETTE.length];
														return h("tr", { key: "row-" + mId },
															h("td", null,
																h("span", { className: "gob-legendItem" },
																	h("span", { className: "gob-swatch", style: { background: color } }),
																	String(mId))),
															h("td", { "data-num": "true" }, String(mStat?.requests || 0)),
															h("td", { "data-num": "true" }, formatCompactNumber(mStat?.promptTokens || 0)),
															h("td", { "data-num": "true" }, formatCompactNumber(mStat?.completionTokens || 0)),
															h("td", { "data-num": "true" }, formatCompactNumber(mTok)),
															h("td", { "data-num": "true" }, sharePct + "%"));
													})))))
									: null);
						})()
					: null;

				const modelsContent = status && !error && groupedModels.length
					? h("div", { className: "gob-foldBody", style: { padding: 0 } },
						h("div", { className: "gob-quotaHead" },
							h("span", { className: "gob-quotaTitle" }, t("models")),
							h("span", { className: "gob-count" }, groupedModels.length + " · " + sourceLabel(t, status.modelSource))),
						h("div", { className: "gob-chips" }, groupedModels.map((entry) => {
							const meta = formatModelChipMeta(entry);
							return h("span", { className: "gob-chip", key: String(entry.id) },
								String(entry.id),
								meta ? h("span", { className: "gob-chipMeta" }, meta) : null);
						})),
						unavailableEntries.length
							? h("div", { className: "gob-quotaGroup" },
								h("div", { className: "gob-quotaMeta" }, t("unavailableModelsTitle")),
								h("div", { className: "gob-chips" }, unavailableEntries.map(([uId, reason]) =>
									h("span", { className: "gob-chip", key: String(uId) }, t("unavailableModelItem", { model: uId, reason: String(reason) })))))
							: null)
					: null;

				const facts = status && !error
					? [
							...factRow("project", t("project"), status.project ?? t("empty")),
							...factRow("tier", t("tier"), status.tier ?? t("empty")),
							...factRow("version", t("version"), t("withSource", {
								value: status.version ?? t("empty"),
								source: sourceLabel(t, status.versionSource),
							})),
							...factRow("configuration", t("configuration"), configurationLabel(t, status.providerSync), configurationTone(status.providerSync)),
							...(signedIn && status.tokenExpiresAt
								? factRow("tokenExpires", t("tokenExpires"), formatResetTime(status.tokenExpiresAt))
								: []),
							...(signedIn && typeof status.signatureCount === "number"
								? factRow("signatureCache", t("signatureCache"), t("signatureCacheValue", { count: status.signatureCount }))
								: []),
						]
					: [];

				if (cooldowns.length) {
					facts.push(...factRow("cooldown", t("cooldown"), cooldowns
						.map(([model, until]) => t("cooldownEntry", { model, time: new Date(until).toLocaleTimeString() }))
						.join(t("separator"))));
				}

				const noticeTone = notice ? (notice.kind === "ok" ? "success" : notice.kind === "error" ? "error" : undefined) : undefined;
				const currentTab = error ? "overview" : (activeTab || "overview");

				const tabItem = (id, label, badge) =>
					h("span", {
						key: "tab-" + id,
						role: "tab",
						tabIndex: 0,
						"aria-selected": currentTab === id ? "true" : "false",
						className: "gob-tab",
						"data-active": currentTab === id ? "true" : undefined,
						onClick: () => setActiveTab(id),
						onKeyDown: (e) => {
							if (e && (e.key === "Enter" || e.key === " ")) {
								e.preventDefault();
								setActiveTab(id);
							}
						},
					},
					label,
					badge !== undefined && badge !== null ? h("span", { className: "gob-tabBadge" }, String(badge)) : null);

				const tabsBar = error
					? null
					: h("div", { className: "gob-tabs", role: "tablist" },
						tabItem("overview", t("tabOverview"), null),
						tabItem("quota", t("tabQuota"), quotaGroups.length || null),
						tabItem("usage", t("tabUsage"), usageStats ? (Number(usageStats.requests) || 0) : 0),
						tabItem("models", t("tabModels"), signedIn ? (groupedModels.length || null) : null));

				return h("section", { className: "gob-root", "aria-busy": loading || busy ? "true" : undefined },
					h("h2", { className: "gob-title" }, t("sectionLabel")),
					h("p", { className: "gob-description" }, t("description")),
					h("div", { className: "gob-card" },
						h("div", { className: "gob-cardHead" },
							h("span", { className: "gob-state", role: "status" },
								h("span", { className: "gob-dot", "data-state": dotState, "aria-hidden": "true" }),
								t(stateKey)),
							!loading && !error && signedIn && status.email
								? h("span", { className: "gob-identity" }, String(status.email))
								: null,
							headActions ? h("div", { className: "gob-actions" }, headActions) : null),
						tabsBar,
						h("div", { className: "gob-panel", hidden: currentTab !== "overview" ? true : undefined },
							hint ? h("p", { className: "gob-hint" }, hint) : null,
							facts.length ? h("div", { className: "gob-facts" }, facts) : null,
							signedIn && !error
								? h("div", { className: "gob-actions" },
									button("refresh-version", t("refreshVersion"), "outline", () => post("refresh-version")),
									button("logout", t("logout"), "danger", () => post("logout")))
								: null),
						h("div", { className: "gob-panel", hidden: currentTab !== "quota" ? true : undefined },
							signedIn && !error
								? (quotaSection || h("p", { className: "gob-hint" }, t("quotaEmptyHint")))
								: h("p", { className: "gob-hint" }, t("quotaSignInHint")),
							signedIn && !error
								? h("div", { className: "gob-actions" },
									button("refresh-quota", t("refreshQuota"), "outline", () => post("refresh-quota")))
								: null),
						h("div", { className: "gob-panel", hidden: currentTab !== "usage" ? true : undefined },
							signedIn && !error
								? usageSection
								: h("p", { className: "gob-hint" }, t("usageSignInHint"))),
						h("div", { className: "gob-panel", hidden: currentTab !== "models" ? true : undefined },
							signedIn && !error
								? (modelsContent || h("p", { className: "gob-hint" }, t("modelsEmptyHint")))
								: h("p", { className: "gob-hint" }, t("modelsSignInHint")),
							signedIn && !error
								? h("div", { className: "gob-actions" },
									button("refresh-models", t("refreshModels"), "outline", () => post("refresh-models")))
								: null),
						error
							? h("p", { className: "gob-notice", "data-tone": "error", role: "alert" }, error)
							: null,
						notice
							? h("p", {
									className: "gob-notice",
									"data-tone": noticeTone,
									role: notice.kind === "error" ? "alert" : "status",
								}, notice.text)
							: null),
					currentTab === "overview"
						? h("details", { className: "gob-fold" },
							h("summary", null, t("howToTitle"), h("span", { className: "gob-chevron", "aria-hidden": "true" })),
							h("div", { className: "gob-foldBody" },
								h("p", { className: "gob-hint" }, t("howToIntro")),
								h("pre", { className: "gob-pre" }, configSnippet(status)),
								h("p", { className: "gob-hint" }, t("configHelp"))))
						: null);
			}

			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "gemini-oauth-bridge",
						order: 52,
						label: () => t("sectionLabel"),
						locale: "geminiOauth",
					},
					GeminiSection,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
