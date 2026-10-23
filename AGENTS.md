# Repository guide

- `lib/index.js`: ESM host, OAuth state and callback, Settings API, provider sync,
  and OpenAI-compatible HTTP bridge.
- `lib/client.js`: browser module factory (`window.__ModuleLoader__.load`,
  `require("react")`); no imports, JSX, Node APIs, or bundler.
- `lib/protocol.js`: pure protocol translation and configuration helpers.
- `test/*.test.js`: Node test runner suites; HTTP suites need localhost sockets.
- `cordis.patch.yml` and `package.json`: DSH plugin registration and dependencies.

Keep zero runtime dependencies and plain JavaScript. UI copy belongs in the
`geminiOauth` zh/en dictionaries with identical keys and `{name}` placeholders.
Use the slot's `locale` declaration and injected `t`, threading it into children.
Send the active locale as `lang` on API calls. Host messages persist as descriptors
and render at response time; callbacks retain the login request's locale. Preserve
upstream text, logs, configuration snippets, and OpenAI-compatible status codes
and response envelopes. Render descriptor-backed bridge errors in the resolved
request locale; errors without descriptors retain their raw messages.

Release flow: bump the package version, sync both READMEs, run `npm test`, commit
on `main`, create an annotated `vX.Y.Z` tag, then push the commit and tag. Follow an
explicit task instruction when it specifies a different working branch or scope.
