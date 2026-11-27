# Agent Note: Resent prompts and overlapping claims

Status: implemented

English | [中文](2026-11-27-resent-prompts-and-overlapping-claims.zh.md)

## Problem

On 2026-11-27 a prompt the user had already sent reappeared as "Queued" on the desktop and then ran as its own turn. The desktop's synced inbox held exactly one entry for it, written by the desktop itself with no target device and the prompt's original `rpcId`; Aeven Cloud never received or forwarded it. That is the shape of [`SessionMirror.rewrite`](../../../../packages/session/session-sync/src/mirror.ts): when a desktop takes a conversation and finds that the account history never accepted its own log tail, it drops the tail and asks the user's prompts in it again. The queued bubble gave no sign that the message was a second send.

The same investigation found a second defect in `SessionMirror.claim`. Two inputs that reach one device while no claim stands both enter the session's operation queue; the second, once it runs, takes the relay lease again (the relay grants a device its own lease) and disposes the first claim's holder, which releases the relay lease while the first claim's turn runs. The new holder is never started, so it stops counting as held after `runnerLease.ttlMs`.

## Decision

- **`claim` re-checks inside the session operation.** A claim that waited behind another one returns `{ claimed: true }` when this device's claim stands (a turn runs here, or the claim's lease is held and not refused), the same test the fast path applies before queuing.
- **Re-asked prompts carry `resent: true`.** `droppedPrompts` sets it on each `prompt` request; [`@aeven/api-session-controller`](../../../../packages/api/session-controller/README.md) reads it only from a forwarded input, records it on the logged message's `user-rpc` source, keeps it when the prompt is forwarded on, and projects it as `SessionQueuedItem.resent` and `QueuedMessage.resent`. A client prompt request cannot set it.
- **The queued bubble says "Sent again".** [`@aeven/ui-chat`](../../../../packages/client/ui-chat/README.md) labels a resent queue row "Sent again" (zh 再次发送, es Enviado de nuevo) with a tooltip naming the reason, and keeps the queue actions.

## Alternatives considered

**Not asking a dropped prompt again** was rejected: the account history no longer holds the prompt, so the user's message would vanish from the conversation. **Running re-asked prompts ahead of the input that triggered the claim** was rejected for now: the rewrite runs inside that input's claim, and applying the prompts there would re-enter the session operation the claim holds.

## Consequences

A prompt account sync sends again is visible as such while it waits; once its turn starts it renders as an ordinary user message, since the mark lives in the message source and no transcript surface reads it. Overlapping first claims keep the relay lease for the turn that starts. Why the desktop's tail was rejected on 2026-11-27 is still unconfirmed: the relay frame log for that conversation was not read.
