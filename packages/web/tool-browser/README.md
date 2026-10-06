---
description: "The model-facing preview_* browser tools and first-step page context: how deployments mount them, bound their waits, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-browser

English | [中文](README.zh.md)

## Summary

`@aeven/tool-browser` lets the model read and drive the browser the user sees beside a session. It registers eight `preview_*` tools and, on the first step of each turn, adds the open page to the request as a logged plugin message. The plugin performs no browser work itself: every call is a `browser/automation` waterfall that the Client holding the session's browser answers, except `preview_status`, which also reports the Chromium the Host runs. Every wait on that waterfall is bounded, so a turn never waits on a browser that no connected Client holds.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in an agent composition whose Client can host a browser, such as the right-sidebar browser of `@aeven/client-ui-sidebar-browser`. The shipped `cordis`, `standard`, and `ptc` presets mount it.

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

## Model Experience

### First-step browser context

#### What the model sees

On the first step of a turn, when the browser answers with a page address other than `about:blank`, the plugin appends one plugin user message naming the page title and address, followed by fixed instructions. Nothing is added when no browser answers within `statusTimeoutMs`, or when the page is blank.

##### Browser context message

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
A page served from this machine (localhost or 127.0.0.1) is an application under development: verify it first in the browser the user can see — this pane, or the Chromium preview_status reports. Use the headless browser tools for it only when neither is available, and say that the check ran in a headless copy.
A failed preview call is retried with corrected arguments when the error is actionable. When a remote page itself refuses it — it needs a signed-in session, or it answers automated reads with a block page — stop retrying and escalate in order: the headless browser tools open no window, and a page that refuses those too is read in the browser the user can see, which does open one. Ask the user to sign in; never type credentials.
```

#### Token effect

About 200 tokens plus the title and address, once per turn while a page is open; zero when no page is open or the lookup times out.

#### KV Cache effect

Append-only: the message is logged as a `user/message` at the start of the turn, so earlier request tokens are unchanged.

### Status report

#### What the model sees

`preview_status` answers with one JSON object and never fails for a missing browser. `sessionTab` is the page the browser beside the session shows, or null. `hostBrowser` is the Chromium this Host runs — its debugging endpoint, whether a browser answers there, whether an executable was found, and the prefix of the tool names that drive it — or null when the composition mounts none. `nextStep` names what to drive: the open page first, then the Host's Chromium, and otherwise what to ask the user for; it sends a page served from this machine to the Host's Chromium, because that page is an application under development the user watches there. A page that refuses `web_fetch` is the case this report exists for, because the Host's Chromium is reachable while the browser beside the session is not.

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
