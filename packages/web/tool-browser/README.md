---
description: "The model-facing preview_* browser tools and first-step page context: how deployments mount them, bound their waits, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-browser

English | [中文](README.zh.md)

## Summary

`@aeven/tool-browser` lets the model read and drive the browser the user sees beside a session. It registers fourteen `preview_*` tools and, on the first step of each turn, adds the open page to the request as a logged plugin message. The plugin performs no browser work itself: every call is a `browser/automation` waterfall that the Client holding the session's browser answers, except `preview_status`, which also reports the Chromium the Host runs. Every wait on that waterfall is bounded, so a turn never waits on a browser that no connected Client holds.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in an agent composition whose Client can host a browser, such as the right-sidebar browser of `@aeven/client-ui-sidebar-browser`. The shipped `cordis`, `standard`, and `ptc` presets mount it.

`preview_upload` takes absolute paths on the Electron computer and a file-input or Upload-button selector; an omitted selector requires exactly one file input. Remote uploads request approval scoped to the destination origin and paths, while localhost is exempt. `preview_sequence` runs 1–20 typed actions locally, with condition-based waits and a first-failure result. Upload and sequence execution require write access. These operations are implemented for Electron; embedded-frame upload choosers are unsupported.

`preview_snapshot` accepts `mode: dom` (the default) or `mode: ax`. The accessibility mode reads Chromium's accessibility tree, including shadow DOM, and returns `snapshotId`, indexed `nodes`, and `truncated`. Nodes use the desktop element fields `index`, `token`, `role`, `title`, `value`, and `editable`. Pass a returned token to `preview_click` or `preview_type` instead of a selector. Tokens expire on the next observation or browser action, and navigation or detached, hidden, or disabled targets are refused. Re-observe after acting; accessibility targets inside frames remain outside this milestone.

`preview_screenshot` captures the visible viewport as JPEG under `actionTimeoutMs` and stores it as a durable image attachment in the tool result. The screenshot enters the session log and model history through the ordinary image result path; attachment storage is required.

### Configuration

Both fields are optional; invalid values fail plugin load.

| Field | Default | Effect |
| --- | --- | --- |
| `statusTimeoutMs` | `2000` | Milliseconds the first step of a turn waits for the open page, and a `preview_status` call waits for the Client. When it elapses, the step proceeds without the browser context and the status report carries no page. |
| `actionTimeoutMs` | `60000` | Milliseconds each `preview_*` call waits, declared as the tool's `timeoutMs`. `@aeven/tool-call-timeout-policy` enforces it and the model receives `TOOL_TIMEOUT`. |

```yaml
- id: tool-browser
  name: '@aeven/tool-browser'
  config:
    statusTimeoutMs: 2000
    actionTimeoutMs: 60000
```

<a id="understand-the-implementation"></a>
## Understand the implementation

In a Web composition, `@aeven/api-remotes` forwards `browser/automation` to the Typert gateway, which delivers it to every connected Client and settles it only after each delivery answers. A pending forwarded waterfall has no deadline, because approvals and user questions must reach a Client that connects later. The plugin therefore bounds its own waits: every lookup runs under a `deadline` fused with the turn or call signal, passes the bounded signal in the request so the gateway cancels the pending event, and races the waterfall against that signal because a listener is not obliged to honor it. An unanswered lookup is logged at debug level on the first step; a listener failure is logged as a warning. The [bounded browser status lookup](../../../.agents/notes/implemented/bug-fix/2026-09-24-bounded-browser-status-lookup.md) Agent Note records the decision.

`preview_status` answers without a page. It composes the Client's answer with the status of the `browserChromium` service of `@aeven/browser-chromium` — read through `ctx.get`, so a composition that mounts no Host browser still answers — and reports every surface the session can drive. The calls that need a page fail with `BROWSER_UNAVAILABLE` and an instruction to open the browser or ask `preview_status` which surfaces the session has; a call without a calling agent fails with `BROWSER_NO_AGENT`.

`preview_navigate` refuses an address served from this machine — `localhost`, its subdomains, `[::1]`, `0.0.0.0`, and any loopback IPv4 address — whenever the Host's Chrome DevTools tools are registered and the person's own request does not name that address. The call fails with `BROWSER_DEVELOPMENT_TARGET` and names the `new_page` call to make instead, so the sidebar pane is never navigated by the model to a page it is building. The person asking to see a local address opens it in the pane: the newest message from the person counts as naming it when it carries the address, its host, or its port. A deployment whose Chrome DevTools tools are absent keeps the pane as its only visible browser, and the refusal does not fire there.

## Model Experience

### First-step browser context

#### What the model sees

On the first step of a turn, when the browser answers with a page address other than `about:blank`, the plugin appends one plugin user message naming the page title and address, followed by fixed instructions. Nothing is added when no browser answers within `statusTimeoutMs`, or when the page is blank.

##### Browser context message

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
Task routing: a request to open, visit, or read a website is this pane's ("open linkedin") — open it here and keep the task here. Development and debugging belong to the Chrome DevTools browser (mcp__chrome_devtools__*): a localhost or 127.0.0.1 page, and any task that changes the code behind a page. Never open a local dev server in this pane to check your own work, and never switch surfaces merely because an interaction failed.
Use preview_sequence for known consecutive actions; it runs locally in order and waits for specified elements without another model request between actions. Use preview_upload to attach files directly; never use clipboard tricks, a local HTTP server, or a native picker for a supported upload.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
A page served from this machine (localhost or 127.0.0.1) is an application under development: open it in the Chrome DevTools browser (mcp__chrome_devtools__*), not this pane. Use the headless browser tools for it only when that browser and this pane are both unavailable, and say that the check ran in a headless copy.
Correct an actionable error in this browser. If this browser needs authentication, ask the user to sign in here; never type credentials or switch browsers to bypass sign-in. Prefer preview_snapshot and focused actions over writing JavaScript for ordinary clicks or text entry.
```

#### Token effect

About 400 tokens plus the title and address, once per turn while a page is open; zero when no page is open or the lookup times out.

#### KV Cache effect

Append-only: the message is logged as a `user/message` at the start of the turn, so earlier request tokens are unchanged.

### Status report

#### What the model sees

`preview_status` answers with one JSON object and never fails for a missing browser. `sessionTab` is the page the browser beside the session shows, or null. `hostBrowser` is the Chromium this Host runs — its debugging endpoint, whether a browser answers there, whether an executable was found, and the prefix of the tool names that drive it — or null when the composition mounts none. When no tool registered for the session carries that prefix, `hostBrowser.toolsUnavailable` says why, from the MCP server's `mcp/servers` report (its state, last error, and the `tool_search` restart query), and `nextStep` says the tools are not serving instead of sending the model to them. `nextStep` names what to drive: the open page for a task that only visits a site, Chrome DevTools for development and debugging and for any `localhost` page, the Host's Chromium when nothing is open, and otherwise what to ask the user for. A page that refuses `web_fetch` is the case this report exists for, because the Host's Chromium is reachable while the browser beside the session is not.

#### Token effect

About 110 tokens, once per call rather than once per request.

#### KV Cache effect

None: a tool result is appended where the tool call ends the previous request.

### Tool schemas

#### What the model sees

The model sees the generated [`preview_*` schemas](../../../docs/tool-catalog.md#aeventool-browser). Wait budgets are deployment settings, not model arguments.

#### Token effect

Fixed per request while the tools are visible.

#### KV Cache effect

Prefix-stable while the visible tool set is unchanged.

## Known Limitations and Deferred Work

- **A Client that answers after `statusTimeoutMs` is ignored for that turn** — the model does not learn the open page until the next turn's first step.
- **Without a connected Client, each new turn waits `statusTimeoutMs`** — the gateway cannot tell the plugin that no Client is connected, so the lookup waits out its deadline before the first step.
- **A browser surface that no plugin reports stays invisible** — the report lists the page beside the session and the Host's Chromium, so any other automation backend the composition mounts is named to the model only once a plugin reports it.
- **No invariant companion** — No runtime invariant companion is published because this package's own specs already exercise each relation it owns: the first-step lookup against a stub waterfall, the bounded waits under `statusTimeoutMs` and `actionTimeoutMs`, and the surface selection in the status report.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
