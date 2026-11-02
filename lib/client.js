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
  "loading": "加载中…",
  "description": "使用拥有 AI Pro 或 AI Ultra 订阅的 Google 账号登录。本地桥接服务用你的订阅配额提供 Gemini 模型，不走 API 计费。",
  "state": "状态",
  "email": "账号",
  "project": "项目",
  "tier": "Tier",
  "version": "客户端版本",
  "models": "模型",
  "login": "登录",
  "cooldown": "限流冷却",
  "loggedIn": "已登录",
  "loggedOut": "未登录",
  "pending": "进行中，请在浏览器完成授权",
  "relogin": "重新登录",
  "signIn": "登录 Google 账号",
  "refreshModels": "刷新模型列表",
  "refreshVersion": "刷新客户端版本",
  "logout": "退出登录",
  "howto": "如何让 DSH 使用这些模型",
  "autoConfig": "登录成功 / 刷新模型列表后会自动写入，无需手动编辑（DSH 运行中即时生效；旧版本 DSH 重启后生效）：",
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
  "loading": "Loading…",
  "description": "Sign in with a Google account that has AI Pro or AI Ultra. The local bridge serves Gemini models with your subscription quota, not API billing.",
  "state": "Status",
  "email": "Account",
  "project": "Project",
  "tier": "Tier",
  "version": "Client version",
  "models": "Models",
  "login": "Sign-in",
  "cooldown": "Rate-limit cooldown",
  "loggedIn": "Signed in",
  "loggedOut": "Not signed in",
  "pending": "In progress. Complete authorization in your browser.",
  "relogin": "Sign in again",
  "signIn": "Sign in with Google",
  "refreshModels": "Refresh model list",
  "refreshVersion": "Refresh client version",
  "logout": "Sign out",
  "howto": "How to use these models in DSH",
  "autoConfig": "Configuration is written automatically after sign-in / model refresh. No manual editing needed (applied live in a running DSH; older DSH versions need a restart):",
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
.gob-notice[data-tone="warning"] { color: var(--dsw-alias-state-warn-label); }
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

  .gob-button[data-variant="outline"]:hover:not(:disabled),
  .gob-button[data-variant="ghost"]:hover:not(:disabled) {
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

.gob-code {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 18px;
  padding: 1px 6px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-markdown-inline-code);
  color: var(--dsw-alias-label-primary);
}

.gob-deviceCode {
  align-self: flex-start;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 20px;
  line-height: 28px;
  font-weight: 500;
  letter-spacing: 0.12em;
  padding: 4px 10px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-markdown-inline-code);
  color: var(--dsw-alias-label-primary);
}

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

				const refresh = () => {
					api("/status")
						.then((r) => setStatus(r.body && typeof r.body === "object" ? r.body : {}))
						.catch(() => setStatus({ ok: false, error: t("connectionError") }));
				};

				react.useEffect(() => {
					let live = true;
					const poll = () => {
						api("/status")
							.then((r) => {
								if (live) setStatus(r.body && typeof r.body === "object" ? r.body : {});
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

				const modelsFold = status && !error && models.length
					? h("details", { className: "gob-fold gob-foldInline" },
						h("summary", null,
							t("models"),
							h("span", { className: "gob-count" }, " " + models.length + " · " + sourceLabel(t, status.modelSource)),
							h("span", { className: "gob-chevron", "aria-hidden": "true" })),
						h("div", { className: "gob-foldBody" },
							h("div", { className: "gob-chips" }, models.map((id) => h("span", { className: "gob-chip", key: String(id) }, String(id))))))
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
						]
					: [];

				if (cooldowns.length) {
					facts.push(...factRow("cooldown", t("cooldown"), cooldowns
						.map(([model, until]) => t("cooldownEntry", { model, time: new Date(until).toLocaleTimeString() }))
						.join(t("separator"))));
				}

				const noticeTone = notice ? (notice.kind === "ok" ? "success" : notice.kind === "error" ? "error" : undefined) : undefined;

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
						hint ? h("p", { className: "gob-hint" }, hint) : null,
						facts.length ? h("div", { className: "gob-facts" }, facts) : null,
						modelsFold,
						error
							? h("p", { className: "gob-notice", "data-tone": "error", role: "alert" }, error)
							: null,
						signedIn && !error
							? h("div", { className: "gob-actions" },
								button("refresh-models", t("refreshModels"), "outline", () => post("refresh-models")),
								button("refresh-version", t("refreshVersion"), "outline", () => post("refresh-version")),
								button("logout", t("logout"), "danger", () => post("logout")))
							: null,
						notice
							? h("p", {
									className: "gob-notice",
									"data-tone": noticeTone,
									role: notice.kind === "error" ? "alert" : "status",
								}, notice.text)
							: null),
					h("details", { className: "gob-fold" },
						h("summary", null, t("howToTitle"), h("span", { className: "gob-chevron", "aria-hidden": "true" })),
						h("div", { className: "gob-foldBody" },
							h("p", { className: "gob-hint" }, t("howToIntro")),
							h("pre", { className: "gob-pre" }, configSnippet(status)),
							h("p", { className: "gob-hint" }, t("configHelp")))));
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
		// Test hook for the dictionary parity check; DSH only reads apply/inject.
		exports.__dictionaries = { zh, en };
		return module.exports;
	},
});
