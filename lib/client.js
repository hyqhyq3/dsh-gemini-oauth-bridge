// lib/client.js — browser half: a t("sectionLabel") section on the DSH settings
// page. Hand-written window.__ModuleLoader__.load module factory that requires
// react at runtime — same shape as dsh-mcp-manager / dsh-plugin-updater.
// Do NOT convert to normal ESM imports or the DSH client loader cannot run it.
// UI copy follows DSH’s active locale through the geminiOauth namespace.

window.__ModuleLoader__.load({
	id: "dsh-gemini-oauth-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const createElement = react.createElement;

		const zh = {
  "connectionError": "无法连接插件接口（插件未加载或 DSH 需要重启）",
  "loginOpened": "已打开 Google 登录页，在浏览器完成授权即可；若浏览器拦截了弹窗，请允许后重试。",
  "success": "操作成功",
  "loading": "加载中…",
  "description": "使用 Google 账号（AI Pro / AI Ultra 订阅）登录 Antigravity 授权端点，把 Gemini 模型以 OpenAI 兼容接口桥接给 DSH。调用消耗订阅配额，不走 API 计费。",
  "state": "状态",
  "email": "账号",
  "project": "项目",
  "tier": "Tier",
  "version": "客户端版本",
  "models": "模型",
  "login": "登录",
  "cooldown": "限流冷却",
  "loggedIn": "✅ 已登录",
  "loggedOut": "未登录",
  "pending": "进行中——请在浏览器完成授权",
  "relogin": "重新登录",
  "signIn": "登录 Google 账号",
  "refreshModels": "刷新模型列表",
  "refreshVersion": "刷新客户端版本",
  "logout": "退出登录",
  "howto": "如何让 DSH 使用这些模型",
  "autoConfig": "登录成功 / 刷新模型列表后会自动写入，无需手动编辑（DSH 运行中即时生效；旧版本 DSH 重启后生效）：",
  "configHelp": "端口以 DSH 网页地址为准（默认 3080）。DSH 要求 provider 必须有 key，插件会在 ~/.dsh/.credentials.yaml 生成固定占位 key（已有条目不会被覆盖）；桥接端接受任意 key。",
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
  "source_default": "默认"
};
		const en = {
  "connectionError": "Cannot connect to the plugin API (plugin not loaded or DSH needs a restart)",
  "loginOpened": "Google sign-in opened. Complete authorization in your browser; if the popup was blocked, allow it and retry.",
  "success": "Operation successful",
  "loading": "Loading…",
  "description": "Sign in to Antigravity with a Google account (AI Pro / AI Ultra subscription) to bridge Gemini models to DSH through an OpenAI-compatible API. Requests use subscription quota, not API billing.",
  "state": "Status",
  "email": "Account",
  "project": "Project",
  "tier": "Tier",
  "version": "Client version",
  "models": "Models",
  "login": "Sign-in",
  "cooldown": "Rate-limit cooldown",
  "loggedIn": "✅ Signed in",
  "loggedOut": "Not signed in",
  "pending": "In progress — complete authorization in your browser",
  "relogin": "Sign in again",
  "signIn": "Sign in with Google",
  "refreshModels": "Refresh model list",
  "refreshVersion": "Refresh client version",
  "logout": "Sign out",
  "howto": "How to use these models in DSH",
  "autoConfig": "Configuration is written automatically after sign-in / model refresh. No manual editing needed (applied live in a running DSH; older DSH versions need a restart):",
  "configHelp": "Use the port in your DSH web address (default 3080). DSH requires a provider key; the plugin creates a fixed placeholder key in ~/.dsh/.credentials.yaml (existing entries are preserved). The bridge accepts any key.",
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
  "source_default": "Default"
};

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("geminiOauth", { zh, en }), "dsh-gemini-oauth-bridge: dictionaries");
			const t = ctx.locale.bind("geminiOauth");

			const api = (path, options) =>
				fetch("/gemini-oauth-bridge/api" + path + (path.includes("?") ? "&" : "?") + new URLSearchParams({ lang: ctx.locale.getLocale().active }), {
					headers: { "Content-Type": "application/json" },
					...options,
				}).then(async (resp) => ({ ok: resp.ok, status: resp.status, body: await resp.json().catch(() => ({})) }));

			function Row({ label, children, t }) {
				return createElement(
					"div",
					{ className: "gb_row" },
					createElement("span", { className: "gb_label" }, label),
					createElement("span", { className: "gb_value" }, children ?? t("empty")),
				);
			}

			function GeminiSection({ t }) {
				const [status, setStatus] = react.useState(null);
				const [busy, setBusy] = react.useState(false);
				const [notice, setNotice] = react.useState(null);

				const refresh = react.useCallback(() => {
					api("/status").then((r) => setStatus(r.body)).catch(() => setStatus({ ok: false, error: t("connectionError") }));
				}, []);

				react.useEffect(() => {
					refresh();
					const timer = setInterval(refresh, 3000);
					return () => clearInterval(timer);
				}, [refresh]);

				const post = react.useCallback(
					async (path) => {
						setBusy(true);
						setNotice(null);
						try {
							const r = await api("/" + path, { method: "POST", body: "{}" });
							if (!r.ok || r.body.error) {
								setNotice({ kind: "error", text: String(r.body.error ?? t("httpError", { status: r.status })) });
							} else if (path === "login" && r.body.authUrl) {
								window.open(r.body.authUrl, "_blank", "noopener");
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
						}
						setBusy(false);
						refresh();
					},
					[refresh],
				);

				if (!status) return createElement("div", { className: "gb_meta" }, t("loading"));
				if (status.error) return createElement("div", { className: "gb_err" }, status.error);

				const loggedIn = !!status.loggedIn;
				const cooldownEntries = Object.entries(status.cooldowns ?? {});

				return createElement(
					"div",
					{ className: "gb_section" },
					createElement("div", { className: "gb_desc" }, t("description")),
					createElement(
						"div",
						{ className: "gb_card" },
						createElement(Row, { t, key: "state", label: t("state") }, loggedIn ? t("loggedIn") : t("loggedOut")),
						createElement(Row, { t, key: "email", label: t("email") }, status.email),
						createElement(Row, { t, key: "project", label: t("project") }, status.project),
						createElement(Row, { t, key: "tier", label: t("tier") }, status.tier),
						createElement(Row, { t, key: "version", label: t("version") }, t("withSource", { value: status.version ?? t("empty"), source: t("source_" + (status.versionSource ?? "none")) })),
						createElement(Row, { t, key: "models", label: t("models") }, t("withSource", { value: (status.models ?? []).join(", "), source: t(status.modelSource === "upstream" ? "source_upstream" : "source_default") })),
						status.loginPending ? createElement(Row, { t, key: "pending", label: t("login") }, t("pending")) : null,
						cooldownEntries.length
							? createElement(
									Row,
									{ t, key: "cooldown", label: t("cooldown") },
									cooldownEntries.map(([m, t]) => `${m} → ${new Date(t).toLocaleTimeString()}`).join(t("separator")),
								)
							: null,
						createElement(
							"div",
							{ className: "gb_actions" },
							createElement("button", { className: "gb_btn primary", disabled: busy, onClick: () => post("login") }, loggedIn ? t("relogin") : t("signIn")),
							loggedIn ? createElement("button", { className: "gb_btn", disabled: busy, onClick: () => post("refresh-models") }, t("refreshModels")) : null,
							loggedIn ? createElement("button", { className: "gb_btn", disabled: busy, onClick: () => post("refresh-version") }, t("refreshVersion")) : null,
							loggedIn ? createElement("button", { className: "gb_btn danger", disabled: busy, onClick: () => post("logout") }, t("logout")) : null,
						),
						notice ? createElement("div", { className: notice.kind === "error" ? "gb_err" : "gb_meta" }, notice.text) : null,
					),
					createElement(
						"details",
						{ className: "gb_howto" },
						createElement("summary", null, t("howto")),
						createElement(
							"div",
							{ className: "gb_howtoBody" },
							createElement("div", null, t("autoConfig")),
							createElement(
								"pre",
								null,
								"llm-pi-ai:\n  providers:\n    gemini-oauth:\n      api: openai-completions\n      baseURL: http://127.0.0.1:3080/gemini-oauth-bridge/v1\n      apiKeyEnv: GEMINI_OAUTH_API_KEY\n      models:\n        - id: gemini-3-pro\n        - id: gemini-3-flash",
							),
							createElement("div", { className: "gb_meta" }, t("configHelp")),
						),
					),
				);
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
