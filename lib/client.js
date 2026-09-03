// lib/client.js — browser half: a "Gemini OAuth" section on the DSH settings
// page. Hand-written window.__ModuleLoader__.load module factory that requires
// react at runtime — same shape as dsh-mcp-manager / dsh-plugin-updater.
// Do NOT convert to normal ESM imports or the DSH client loader cannot run it.
// UI strings are Simplified Chinese, per workspace convention.

window.__ModuleLoader__.load({
	id: "dsh-gemini-oauth-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const createElement = react.createElement;

		const inject = ["slots"];

		const api = (path, options) =>
			fetch("/gemini-oauth-bridge/api" + path, {
				headers: { "Content-Type": "application/json" },
				...options,
			}).then(async (resp) => ({ ok: resp.ok, status: resp.status, body: await resp.json().catch(() => ({})) }));

		function Row({ label, children }) {
			return createElement(
				"div",
				{ className: "gb_row" },
				createElement("span", { className: "gb_label" }, label),
				createElement("span", { className: "gb_value" }, children ?? "-"),
			);
		}

		function GeminiSection() {
			const [status, setStatus] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);

			const refresh = react.useCallback(() => {
				api("/status").then((r) => setStatus(r.body)).catch(() => setStatus({ ok: false, error: "无法连接插件接口（插件未加载或 DSH 需要重启）" }));
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
							setNotice({ kind: "error", text: String(r.body.error ?? `HTTP ${r.status}`) });
						} else if (path === "login" && r.body.authUrl) {
							window.open(r.body.authUrl, "_blank", "noopener");
							setNotice({ kind: "info", text: "已打开 Google 登录页，在浏览器完成授权即可；若浏览器拦截了弹窗，请允许后重试。" });
						} else if (path === "refresh-models") {
							const p = r.body.provider ?? {};
							setNotice({
								kind: p.ok === false ? "error" : "ok",
								text: p.ok === false
									? "模型列表已刷新，但写入 provider 配置失败：" + (p.reason ?? "未知原因")
									: "已刷新 " + (r.body.models ?? []).length + " 个模型，并写入 settings.yaml 的 provider 配置（重启 DSH 后生效）",
							});
						} else if (path === "refresh-version") {
							setNotice({ kind: "ok", text: "客户端版本已更新：" + r.body.version });
						} else {
							setNotice({ kind: "ok", text: "操作成功" });
						}
					} catch (e) {
						setNotice({ kind: "error", text: String(e) });
					}
					setBusy(false);
					refresh();
				},
				[refresh],
			);

			if (!status) return createElement("div", { className: "gb_meta" }, "加载中…");
			if (status.error) return createElement("div", { className: "gb_err" }, status.error);

			const loggedIn = !!status.loggedIn;
			const cooldownEntries = Object.entries(status.cooldowns ?? {});

			return createElement(
				"div",
				{ className: "gb_section" },
				createElement("div", { className: "gb_desc" }, "使用 Google 账号（AI Pro / AI Ultra 订阅）登录 Antigravity 授权端点，把 Gemini 模型以 OpenAI 兼容接口桥接给 DSH。调用消耗订阅配额，不走 API 计费。"),
				createElement(
					"div",
					{ className: "gb_card" },
					createElement(Row, { key: "state", label: "状态" }, loggedIn ? "✅ 已登录" : "未登录"),
					createElement(Row, { key: "email", label: "账号" }, status.email),
					createElement(Row, { key: "project", label: "项目" }, status.project),
					createElement(Row, { key: "tier", label: "Tier" }, status.tier),
					createElement(Row, { key: "version", label: "客户端版本" }, `${status.version ?? "-"}（${status.versionSource ?? "-"}）`),
					createElement(Row, { key: "models", label: "模型" }, (status.models ?? []).join(", ") + `（${status.modelSource === "upstream" ? "上游" : "默认"}）`),
					status.loginPending ? createElement(Row, { key: "pending", label: "登录" }, "进行中——请在浏览器完成授权") : null,
					cooldownEntries.length
						? createElement(
								Row,
								{ key: "cooldown", label: "限流冷却" },
								cooldownEntries.map(([m, t]) => `${m} → ${new Date(t).toLocaleTimeString()}`).join("；"),
							)
						: null,
					createElement(
						"div",
						{ className: "gb_actions" },
						createElement("button", { className: "gb_btn primary", disabled: busy, onClick: () => post("login") }, loggedIn ? "重新登录" : "登录 Google 账号"),
						loggedIn ? createElement("button", { className: "gb_btn", disabled: busy, onClick: () => post("refresh-models") }, "刷新模型列表") : null,
						loggedIn ? createElement("button", { className: "gb_btn", disabled: busy, onClick: () => post("refresh-version") }, "刷新客户端版本") : null,
						loggedIn ? createElement("button", { className: "gb_btn danger", disabled: busy, onClick: () => post("logout") }, "退出登录") : null,
					),
					notice ? createElement("div", { className: notice.kind === "error" ? "gb_err" : "gb_meta" }, notice.text) : null,
				),
				createElement(
					"details",
					{ className: "gb_howto" },
					createElement("summary", null, "如何让 DSH 使用这些模型"),
					createElement(
						"div",
						{ className: "gb_howtoBody" },
						createElement("div", null, "登录成功后，在 ~/.dsh/settings.yaml 的 llm-pi-ai.providers 下加入（重启 DSH 生效）："),
						createElement(
							"pre",
							null,
							"llm-pi-ai:\n  providers:\n    gemini-oauth:\n      api: openai-completions\n      baseURL: http://127.0.0.1:3080/gemini-oauth-bridge/v1\n      models:\n        - id: gemini-3-pro\n        - id: gemini-3-flash",
						),
						createElement("div", { className: "gb_meta" }, "端口以 DSH 网页地址为准（默认 3080）。模型 id 以「刷新模型列表」的结果为准。"),
					),
				),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "gemini-oauth-bridge",
						order: 52,
						label: "Gemini OAuth",
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
