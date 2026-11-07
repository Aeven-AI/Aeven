# Agent Note: A link's first message

Status: implemented

English | [中文](2026-11-07-link-first-message.zh.md)

## Problem

The aeven.io landing page carries a composer. Submitting it opened the hosted chat with an empty composer, so the reader typed the same message a second time. A reader who is not signed in passes through the sign-in screens first, and a provider sign-in under the `redirect` flow replaces the document, so the message has to survive both.

## Decision

The landing page opens `https://chat.aeven.io/#q=<message>`. Before the authentication gate, `AppWebEntry.run()` calls `stashIncomingPrompt()` ([`packages/client/web/src/incoming-prompt.ts`](../../../../packages/client/web/src/incoming-prompt.ts)), which moves the `q` fragment parameter into the tab's `sessionStorage` under `avn:incoming-prompt`, removes it from the address with `history.replaceState`, and keeps any other fragment parameters. A blank message is dropped.

`ConversationSession` ([`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`](../../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)) takes the stored message with `takeIncomingPrompt()` once the session list reports the selected Session blank and no prompt has been attempted, sets it as the draft, and submits it through `inputActions.submit()`, the same path as Enter. The list's `blank` flag is the one the Hero reads; a Session snapshot still loading its history also reports `blank`, so the snapshot alone would send into an existing conversation. While the selected Session has history the message stays stored for the tab.

## Alternatives considered

**A query parameter (`?q=`)** lost: the query reaches the server and its access logs, and the message is the reader's own text. The fragment never leaves the browser.

**Reading the fragment after boot** lost: `requireSignIn` rewrites the address to the sign-in screen, and the `redirect` provider flow loads `/oauth-result` in a new document, so the fragment is gone before any plugin runs.

**Filling the draft without sending** lost: the reader already pressed send on the landing page.

## Consequences

The link-to-chat handoff is one key shared by two packages that do not depend on each other; each file names the other. A message that waits because the selected Session has history is sent when the reader next opens a blank Session in the same tab.

## Verification

`packages/client/web/tests/incoming-prompt.client.spec.ts` covers the stash, the preserved fragment parameters, and the blank message. `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` sends the stored message once through the input shell's default sink for a list-blank Session, and leaves it stored for a Session the list reports with history while its snapshot is still loading.
