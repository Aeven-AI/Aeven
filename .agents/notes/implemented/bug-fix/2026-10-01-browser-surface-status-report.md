# Agent Note: Browser surface status report

Status: implemented

English | [中文](2026-10-01-browser-surface-status-report.zh.md)

## Problem

`preview_status` answered with the browser beside the session and nothing else. In a Web deployment that browser is the right-sidebar pane, so with the pane closed the tool failed with `BROWSER_UNAVAILABLE` and an instruction to open it. The same deployment mounts `@aeven/browser-chromium`: a Chrome started on the Host on debugging port 9333, with a persistent profile and without `--enable-automation`, driven by the `chrome-devtools-mcp` tools that the same composition row mounts. No tool reported that browser, so a session holding one was told it held none.

`web_fetch` returns decoded HTTP(S) text and runs no JavaScript, so a page that builds itself in a browser, or that answers non-browser requests with a block page, returns little or nothing — and the tool's description and prompt section said nothing about what to do instead.

On 2026-10-01 that pair produced a concrete failure while researching pages that refuse bots. The model read the status tool, was told no browser existed, and installed a second `playwright-core` into the session workspace. `@playwright/mcp` was already a mounted composition row whose tools the session had already called, and `playwright` was already present twice as a nested dependency of `packages/experimental/browser-overlay` and `packages/experimental/inspector`. A module-resolution probe from the repository root cannot see either, because npx resolves MCP servers outside the workspace and pnpm nests package-local dependencies, so its silence proved nothing.

## Decision

`preview_status` reports every surface the composition gives the session, and no longer fails when the pane is closed.

`BrowserChromium.status(signal)` samples the Host's browser without launching it and returns the debugging endpoint, whether a browser answers there now, whether an executable was found, and the tool-name prefix that drives it. It is a public service method, not a Typert Remote: its consumer is the host-side tool, not a Client.

`tool-browser` composes the Client's answer with that status into one JSON object — `sessionTab`, `hostBrowser`, `nextStep` — and reads `browserChromium` through `ctx.get`, so a composition that mounts no Host browser still answers. `nextStep` prefers the open page, then the Host's Chromium, and otherwise states what to ask the user for: the order keeps the pane's browser the model's default wherever it exists, including the Electron webview, where a page the user signed into is the surface that carries the session's access. The calls that need a page keep failing with `BROWSER_UNAVAILABLE`, and now name `preview_status`.

The first-step context and the status report share one bounded lookup, so the deadline, the cancellation of the pending request, and the debug and warning logging that [the bounded browser status lookup](2026-09-24-bounded-browser-status-lookup.md) decided are unchanged.

The model-facing guidance states the escalation instead of forbidding it, and states it in an order: headless first, the windowed browser last. A headless read is free — no window over the user's work, no claim on the profile their own browsing uses, a disposable context — while the attached Chrome opens a visible window and holds that profile, so it is earned by a refusal rather than chosen by default. The one case that skips the order is a page needing the user's session: a headless browser with its own profile can never hold that sign-in, so only the attached browser can serve it. The first-step browser context carries the order, and `web_fetch`'s prompt section states it beside the no-JavaScript limit. Why a refusal is the right trigger is measured: on one Tripadvisor URL on 2026-10-01, `web_fetch` answered 403, headless Playwright answered 403 with an empty body, and the attached Chrome on the user's profile answered 200 — the wall is a browser-trust question that only their real profile settles.

## Alternatives considered

**Report only the pane and keep the failure.** This is what the model needed least: the message was true about the pane and false about the machine, and it is the sentence that sent the session looking for a browser to install. A status tool that cannot report a running browser is not a status tool.

**A browser-surfaces registry that announces every backend.** Dropped after reading the upstream capability. `deepseek-harness` ships `packages/browser-use/browser-use`, a registration-only service (`ctx.browserUse`) whose contract is that configuration selects one provider and **the model cannot switch registered backends at runtime**, with `browser-use-{chrome-devtools-mcp,playwright-mcp,stagehand-native}` as providers and a `browser-use-runtime` behind them. This fork is on the earlier route — `tool-browser` and `browser-chromium` plus raw `@aeven/mcp-client` rows — and its newest merged upstream tag is `dsh-v0.1.2-alpha.5`, while that work first appears in `dsh-v0.1.6-alpha.1`. A model-facing inventory of selectable backends would therefore duplicate, and contradict, a decision upstream already owns, and would have to be unwound at the next sync.

**Install-approval enforcement in this change.** The durable half of the failure — an install mutating the environment without asking — is not fixed here. It needs an approval gate on package-manager mutations, which is a separate change with its own mechanism.

## Consequences

- A session with the pane closed and a Host browser mounted is told so, with the tool prefix that drives it, instead of being told no browser exists.
- `BrowserChromium.status` cannot start a browser as a side effect, so a status call never opens a window the user did not ask for.
- The report names the page beside the session, the Host's Chromium, and nothing else. Any further backend stays invisible to the model until a provider reports it, which upstream's `browser-use` providers do.
- `packages/web/tool-browser/tests/tool-browser.spec.ts` pins the four status-report cases: no surface, the Host browser alone, the Host browser while the page lookup never answers, and both surfaces with the pane preferred. The thirty recorded system prompts that pin the `web_fetch` section text were updated with it; `docs/tool-catalog.md` could not be regenerated on this branch because `scripts/gen-tool-catalog.ts` rejects four tool packages missing from its boot manifest (`tool-capability`, `tool-device`, `tool-memory`, `tool-search`), which is unrelated to this change and leaves the catalog stale for `web_fetch`'s description.
