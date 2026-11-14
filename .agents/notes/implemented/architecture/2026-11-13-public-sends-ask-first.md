# Agent Note: posting, sending, and submitting on a website or connector asks the person first, with a per-site session grant

Status: implemented

English | [中文](2026-11-13-public-sends-ask-first.zh.md)

## Problem

Two sessions published as the user without asking. In one, the user said "do not yet", then "just fill in the form", and the agent clicked GitHub's Create button through `mcp__chrome_devtools__click`, then edited and re-created the issue through the GitHub connector's `issue_write`. In the other, the agent sent LinkedIn invitations from `evaluate_script` calls that filled the note and clicked Send, and posted a direct message through LinkedIn's messaging API with a `fetch` POST. The session's approval policy was `ask`, yet nothing asked:

- Browser tools had no send gate; only uploads, clipboard, history, bookmarks, page tools, and clearing asked.
- `account-integrations` gated Google, Microsoft, WhatsApp, Telegram, Discord, and Slack connector writes and let every other provider, GitHub and custom MCP servers included, run unasked.
- `fillByTyping` typed a value with a line break as a plain Enter per line, which submits a chat box and made GitHub's markdown editor continue lists, so the issue body read `2. 2.` and `- - -`.

## Decision

- `@aeven/browser-chromium/src/send-gate.ts` classifies send-like browser actions for every browser surface: a click on a button-like control whose label is a publishing verb (English, Dutch, Spanish, German, French, Chinese), a click on a target the gate cannot read, Enter without Shift, typed text with a line break, and a page script that sends a writing request or clicks, dispatches events, or submits while its source names a publishing verb. Typing, filling, reading, navigating, and pages on this machine never ask.
- The Chrome DevTools tools ask from a `tools/pre-execute` listener in `BrowserChromium`; `DevtoolsSendGate` rebuilds uid → role, label, and page address from the snapshot and page-list results it observes. The sidebar `preview_*` tools ask inside `@aeven/tool-browser`, reading the click target's opening tag through the `read` operation.
- A new `SessionGrantCoverage` value, `'site'`, offers "Allow for this session" per website. Its grant matches on scope alone (`site:<host>`), so one grant covers every browser tool on that site, and the `never` policy still asks for it, as it does for `'account'`.
- Connector providers without their own read list ask before any tool whose name is not a read (`get_*`, `list_*`, `search_*`, `*_read`, and similar), with a per-tool session grant. `mail_send` now offers a per-account session grant.
- `fillByTyping` routes values with a line break through its typing path and types `Shift+Enter` between lines.

## Alternatives considered

- **Ask before any input on a website, per site.** Rejected by the user: a session grant given while the agent fills a form would also cover the later submit, which is the case that failed.
- **Ask before every page script.** Rejected: most scripts only read, so the first read would prompt, and a session grant given there would cover the later send.
- **Intercept writing HTTP requests in the browser.** Rejected: sites send telemetry and read queries as POSTs, so every page load would ask.

## Consequences

The gate classifies by label and script text, not intent. An icon-only publishing control with no accessible name runs unasked, and a non-publishing button labelled with a listed verb asks; the per-site grant keeps the second case to one prompt per site per session. The DevTools gate knows only targets it has seen in a result, so after a Host restart a click on a website asks until the model takes a new snapshot.
