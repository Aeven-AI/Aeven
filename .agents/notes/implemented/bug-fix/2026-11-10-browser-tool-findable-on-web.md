# Agent Note: The browser tool is findable, and named for what it does on Aeven Web

Status: implemented

English | [中文](2026-11-10-browser-tool-findable-on-web.zh.md)

## Problem

In hosted session `c1b1a219` on 2026-11-10 the user shared a ChatGPT link. `web_fetch` returned only the sign-in shell, and the model ran `tool_search` for "browser navigate screenshot page". The `preview_*` tools were already loaded, but `tool_search` searches only deferred tools, so it answered "No deferred tool matches", and the model told the user it could not read the page. Only after the user said the extension was installed did it call `preview_navigate`, which opened the page in the user's browser through the Aeven extension and read it. The `preview_navigate` description named only the desktop's browser beside the session, and `web_fetch` gave no hint that a sign-in page needs the browser.

## Decision

- `tool_search` (`packages/core/tool-search/src/index.ts`) also matches the query against the tools the agent already holds, and lists matches under "Already loaded, call directly", both when no deferred tool matches and alongside deferred matches.
- `preview_navigate` (`packages/web/tool-browser/src/index.ts`) says it opens the browser beside the session in the desktop app, and a tab of the user's own browser, signed in, through the Aeven extension on Aeven Web, and that it reads pages `web_fetch` cannot.
- `web_fetch` (`packages/web/tool-web/src/fetch.ts`) says it carries no sign-in and points to `preview_navigate` for such pages when that tool is available.

When the extension is missing, `preview_navigate` already holds the call open behind the install prompt (`packages/client/ui-sidebar-browser/src/client/extension-install.ts`), so the user sees that prompt instead of a refusal.

## Alternatives considered

A behavior rule in the agent's prompt was rejected: the persona carries tone only, and the tool descriptions are where the model chooses a tool.

Deferring the `preview_*` tools so `tool_search` finds them would cost a load round trip on every browsing turn.

## Consequences

The description is model-visible and longer by two sentences in every request that carries the tool; the recorded tool-schema snapshots carry the new text.

## Verification

The tool-search, tool-browser, and tool-web specs pass (147). The keyless snapshot replay passes every scenario that records these tools after a rebuild; `assessment-memory` and `acp image-compaction` fail on unrelated prompt drift and a script that needs re-recording, as on `main`.
