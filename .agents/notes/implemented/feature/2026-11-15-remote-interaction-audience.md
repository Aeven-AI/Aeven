# Agent Note: Another Device's Approvals and Questions Reach Aeven Web

Status: implemented

English | [中文](2026-11-15-remote-interaction-audience.zh.md)

## Problem

A conversation started on chat.aeven.io and run on the user's desktop asked for a sandbox approval (the Keynote conversion) and, in a second check, a multiple-choice question. Both showed in the desktop app and never on the web, so from a phone the conversation waited with nothing to answer. The interaction relay already publishes a running device's pending approvals and questions with the session's live state, and the hosted Host presents them through a stand-in Agent; the gateway then scoped the Remote event to the Session's owner with `ctx.sessions.get(id)?.header.owner`. A Session another device runs is not open on the hosted Host, so the owner was `undefined`, and `identityUsers.mayAccess(undefined, user)` is false on a Host that enforces accounts: no Client received the event.

## Decision

The gateway takes the audience owner from the open Session when there is one, and otherwise from the scoped Agent's own Session header. The stand-in Agent the relay presents through carries the session's owner, set on the Host from the synced live state, never from a Client.

The `agent/disposed` listeners of `avn-memory-context`, `avn-personalization`, `avn-file-reference-local`, and `avn-tool-subagent` wrap `fiber.dispose()` in `Promise.resolve`, because a fiber that already stopped returns no promise and the listeners threw on every handed-off session.

## Alternatives considered

**Open the Session on the hosted Host while another device runs it.** It would load the whole log only to read one header field, and a loaded Session invites the Host to run the turn the other device holds.

## Consequences

Approvals and questions of a conversation running on another device of the account reach every Client of that account; Clients of other accounts still receive nothing, because the owner comes from the Host's own state.

## Verification

`pnpm run typecheck` passes. On chat.aeven.io, a question asked by a conversation running on the desktop is the live check after the deploy.
