---
description: "The model-facing preview_* browser tools and first-step page context: how deployments mount them, bound their waits, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-browser

English | [中文](README.zh.md)

## Summary

`@aeven/tool-browser` lets the model read and drive the browser the user sees beside a session. It registers eight `preview_*` tools and, on the first step of each turn, adds the open page to the request as a logged plugin message. The plugin performs no browser work itself: every call is a `browser/automation` waterfall that the Client holding the session's browser answers. Every wait on that waterfall is bounded, so a turn never waits on a browser that no connected Client holds.

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
| `statusTimeoutMs` | `2000` | Milliseconds the first step of a turn waits for the open page. When it elapses, the step proceeds without the browser context. |
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

In a Web composition, `@aeven/api-remotes` forwards `browser/automation` to the Typert gateway, which delivers it to every connected Client and settles it only after each delivery answers. A pending forwarded waterfall has no deadline, because approvals and user questions must reach a Client that connects later. The plugin therefore bounds its own waits: the first-step lookup runs under a `deadline` fused with the turn signal, passes the bounded signal in the request so the gateway cancels the pending event, and races the waterfall against that signal because a listener is not obliged to honor it. An unanswered lookup is logged at debug level; a listener failure is logged as a warning. The [bounded browser status lookup](../../../.agents/notes/implemented/bug-fix/2026-09-24-bounded-browser-status-lookup.md) Agent Note records the decision.

Without a `browser/automation` listener, `preview_*` calls fail with `BROWSER_UNAVAILABLE` and an instruction to open the browser; a call without a calling agent fails with `BROWSER_NO_AGENT`.

## Model Experience

### First-step browser context

#### What the model sees

On the first step of a turn, when the browser answers with a page address other than `about:blank`, the plugin appends one plugin user message naming the page title and address, followed by fixed instructions. Nothing is added when no browser answers within `statusTimeoutMs`, or when the page is blank.

##### Browser context message

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
Do not switch to Chrome, computer use, or standalone browser automation merely because a first call fails. A failed preview tool call should be inspected and retried with corrected arguments when the error is actionable.
```

#### Token effect

About 110 tokens plus the title and address, once per turn while a page is open; zero when no page is open or the lookup times out.

#### KV Cache effect

Append-only: the message is logged as a `user/message` at the start of the turn, so earlier request tokens are unchanged.

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
