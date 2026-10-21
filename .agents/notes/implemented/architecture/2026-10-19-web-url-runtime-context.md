# Agent Note: The GUI URL is a runtime context, not prompt text

Status: implemented

English | [中文](2026-10-19-web-url-runtime-context.zh.md)

## Problem

The `app:web-surface` session section stated the Aeven Web GUI's URL inline: `You are interacting with the user through the Aeven Web GUI at ${webUrl}.` A section is part of the cached system prompt, so a server that rebinds to another port — a restart on a taken port, a second `avn web` instance — had to rewrite the session's prompt prefix. Every turn after that rebind lost KV-cache reuse from the first changed token, and a session created before the rebind kept a stale URL in its instructions.

## Decision

**The surface section states no process-specific value.** It says the URL is named by the runtime context; the URL itself arrives as `app:web-url`, a runtime-context entry at `WEB_URL` (order 210) whose text reads `Aeven Web GUI URL: <url>`, resolved per assembly from the live server.

The split follows the surface's own rule: what the GUI renders, how replies and images render, and which update contract holds are facts about the surface and belong in the section; which port this process bound to is a fact about the process and belongs in the context that the request rebuilds every turn. The `AVN_WEB_URL` bash variable keeps carrying the same live value for shell consumers.

## Alternatives considered

**Keep the URL in `app:web-surface` and rebuild the session's prompt on a rebind.** Rebuilding the prefix rewrites the cached system prompt from the first changed token, so every turn after a rebind loses KV-cache reuse, and a session created before the rebind keeps an address the server no longer serves.

**Carry the URL only in `AVN_WEB_URL` and name that variable in the section.** The model reads the variable only by running a shell command, so a turn that never calls bash has no address at all; a runtime-context entry reaches every request assembly without a tool call.

**Append the URL as a logged session event on bind.** A bind is process state, not conversation state: the event would need rewriting on every rebind and would leave sessions mounted before it without the value.

## Consequences

- A rebind appends a new runtime-context snapshot instead of rewriting the prompt prefix, so the section before it stays cacheable.
- A session that predates a rebind reads the current URL on its next request rather than the one captured when it started.
- `surfaceContext: false` still registers neither the section, the context, nor the bash variable.

## Verification

`packages/bundle/web-app/tests/web-app.spec.ts` asserts the surface section no longer contains the URL, that `app:web-url` carries `Aeven Web GUI URL: <url>`, and that the rendered context snapshot includes that line; `apps/web/tests/expected/web-runtime-context/web-surface-prompt.expected.md` pins the section text.
