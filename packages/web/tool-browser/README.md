---
description: "The model-facing preview_* browser tools and first-step page context: how deployments mount them, bound their waits, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-browser

English | [中文](README.zh.md)

## Summary

`@aeven/tool-browser` lets the model read and drive the browser the user sees beside a session. It registers thirty `preview_*` tools and, on the first step of each turn, adds the open page to the request as a logged plugin message. The plugin performs no browser work itself: every call is a `browser/automation` waterfall that the Client holding the session's browser answers, except `preview_status`, which also reports the Chromium the Host runs. Every wait on that waterfall is bounded, so a turn never waits on a browser that no connected Client holds.

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

Every `selector` argument accepts CSS or a locator part: `text=`, `role=` with `name`, `checked`, `disabled`, `expanded`, `pressed`, `selected`, and `level` filters, `label=`, `placeholder=`, `alt=`, `title=`, `testid=`, and `xpath=`; `>>` searches inside the previous match, and `nth=` and `visible=` filter matches. A selector that matches more than one element is refused. A `frame` argument names the iframe the target is in. The [browser engine](../browser-engine/README.md) owns the locator semantics.

| Tool | What it does |
| --- | --- |
| `preview_click` | Click, double-click (`clickCount`), right- or middle-click (`button`), with modifiers. Returns once a navigation the click started has loaded, or at once with the dialog it opened. |
| `preview_hover`, `preview_drag` | Move the pointer over a target; press, move, and release between two targets. |
| `preview_select`, `preview_check` | Choose `<select>` options by value or label; set a checkbox, radio, or `aria-checked` control, clicking only when its state differs. |
| `preview_read`, `preview_wait` | Read text, HTML, value, an attribute, count, visibility, enabled or checked state, or box of one or all matches; wait for an element state, an address, or a load state. |
| `preview_content` | The page as markdown, text, or HTML, or the captions of an open YouTube video, truncated past 100,000 characters. |
| `preview_export_document` | Download the open Google Docs, Sheets, or Slides document into the user's Downloads folder with the guest session's cookies; text formats also return their content. |
| `preview_clipboard`, `preview_console`, `preview_dialog` | Read (with approval) or write clipboard text; the page's last 500 console entries and uncaught exceptions; inspect or answer a JavaScript dialog. |
| `preview_browser_control` | Press the pane's own toolbar and three-dot menu with the pointer: capture, open in Chrome, hard reload, DevTools, zoom, appearance, and clearing cache or cookies (with approval). |
| `preview_tabs` | List, open, show, or close the session's browser tabs; each tab is a Browser pill in the sidebar, and the other tools act on the current one. The pointer presses the pill, the plus menu, or the pill's close button. `browser` opens the tab in Aeven's Chrome, the user's Chrome, or through the Aeven extension in one of the user's browsers (`browserName` picks which). |
| `preview_history`, `preview_bookmarks` | Search the pages visited in the in-app browser, or with `source` browser the history of the user's browsers through the Aeven extension, by words in the address or title; search the user's bookmarks through the extension (with approval, remembered for the session). |
| `preview_page_tools` | List the WebMCP tools the open page registered through `document.modelContext`, or invoke one (with approval per site and tool). |
| `preview_handoff` | Show the user a modal naming a browser step that is theirs, then tell the model to end its turn; without a pane the chat asks the same question. |

Pointer actions follow ChatGPT's browser agent timing: the drawn cursor arrives (at most 1500 ms) before the page's mouse moves and presses; a click waits up to 3000 ms for a navigation that began within 250 ms of the action; back, forward, reload, and hard reload wait up to 10,000 ms for a load that began within 250 ms; a drag waits for the cursor only at its first point; a scroll sends one wheel event after the cursor arrives and returns once the scrolled position settles.

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
Correct an actionable error in this browser. If this browser needs authentication, a captcha, or the user's confirmation, call preview_handoff and end your turn; never type credentials or switch browsers to bypass sign-in. Prefer preview_snapshot and focused actions over writing JavaScript for ordinary clicks or text entry; read a whole article with preview_content.
```

#### Token effect

About 400 tokens plus the title and address, once per turn while a page is open; zero when no page is open or the lookup times out.

#### KV Cache effect

Append-only: the message is logged as a `user/message` at the start of the turn, so earlier request tokens are unchanged.

### Status report

#### What the model sees

`preview_status` answers with one JSON object and never fails for a missing browser. `sessionTab` is the page the browser beside the session shows, or null. `hostBrowser` is the Chromium this Host runs — its debugging endpoint, whether a browser answers there, whether an executable was found, and the prefix of the tool names that drive it — or null when the composition mounts none. When no tool registered for the session carries that prefix, `hostBrowser.toolsUnavailable` says why, from the MCP server's `mcp/servers` report (its state, last error, and the `tool_search` restart query), and `nextStep` says the tools are not serving instead of sending the model to them. `nextStep` names what to drive: the open page for a task that only visits a site, Chrome DevTools for development and debugging and for any `localhost` page, the Host's Chromium when nothing is open, and otherwise what to ask the user for. A page that refuses `web_fetch` is the case this report exists for, because the Host's Chromium is reachable while the browser beside the session is not. On an Aeven web page the Client answers for the user's own browser, reached through the Aeven extension. With no extension tab current, `nextStep` tells the model that `preview_navigate` opens the address in a new tab of the user's browser, where they are signed in, and that a missing extension is offered to the user while the call waits. A browser that cannot run the extension makes `nextStep` say that no browser is available and that the user can switch to Chrome, Edge, Brave, or the desktop app. A call that waits for the extension fails with an instruction to end the turn when the user declines, when their browser cannot run it, or 5 seconds before `actionTimeoutMs` elapses. Every status answer from such a page carries `surface: 'user-browser'`, and `preview_history` then searches the user's browser whatever `source` the model passed, because there is no browser beside the session to search.

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
- **JavaScript `prompt()` never reaches the agent** — Electron answers it with null before the page or the debugger sees a dialog, so only `alert`, `confirm`, and `beforeunload` can be answered with `preview_dialog`.
- **The user's own history and bookmarks need the Aeven extension** — without it only the in-app browser's history, kept in the desktop window's storage, is searched; the user's open tabs are never read.
- **WebMCP needs Chromium's `WebMCP` feature** — the desktop shell enables it at startup; a page that offers tools only through another script API is not listed.
- **No invariant companion** — No runtime invariant companion is published because this package's own specs already exercise each relation it owns: the first-step lookup against a stub waterfall, the bounded waits under `statusTimeoutMs` and `actionTimeoutMs`, and the surface selection in the status report.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
