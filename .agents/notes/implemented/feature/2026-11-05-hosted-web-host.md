# Agent Note: Hosted Aeven Web for many accounts

Status: implemented

English | [中文](2026-11-05-hosted-web-host.zh.md)

## Problem

Aeven Web only ran as the app on one person's machine: one account, its own disk, and every capability mounted. Serving one Host for many people on Aeven's infrastructure inverts both defaults. Nothing may run on the Host's machine, because its disk and its processes belong to every account at once, and nothing one account changes may reach another. The product's reasons to exist — sessions, workspaces, memory, sync, desktop continuity — still have to work.

## Decision

`@aeven/hosted-app` is a bundle patch layer applied after `@aeven/web-app`, and `PROFILE_TEMPLATES.hosted` composes base, web and hosted. `avn hosted` boots it with `AVN_HOME` for per-deployment state, `AVN_HOSTED_PORT` (3085), `AVN_HOSTED_HOST`, and `AVN_HOSTED_TRUSTED_HOSTS` for the names browsers use.

The patch states its two rules as rows. Every row that would run on the Host's own machine is disabled: `code-runtime`, the shell, filesystem and filesystem-search tools, terminal, browser, device, computer-use, workflow and ralph workers, the Codex and Claude Code subagents, plugin introspection, workspace files, the directory picker, and the skill catalog. The preset tool rows are disabled by the same patch, so no preset re-enables one. The Host keeps web search and fetch, imagine, attachments, memory, and in-process subagent delegation.

Per-account reach is the other half. `settings` keeps account sections (`accounts: true`) so an account's own namespace values resolve only for it; `settings-controller.writable: false` refuses every browser-initiated write to the Host document, and `workspace-controller.folders: false` removes the folders a shared Host has no business naming. `memory-memos` keeps a home per account (`accounts`) and keys project memory by the workspace that produced it instead of one shared project scope, and opens on sync so a returning account's memory is built before its first turn; each account's memory work is bounded so one account cannot delay another's. `sync-yjs` runs with `keepConnected: true` against `wss://aeven.io/sync`, so the Host is one more device of every account signed in to it, staying current through the relay grant issued on the first signed-in connection.

Identity follows the account only where the deployment asks for it: the session controller reads an account's default model when `settings.accountSections` is true, and leaves a single-account Host on its composition entry otherwise. Image reads by fingerprint alone (`/api/attachment-image?id=…` without a session) are refused on a shared Host with `SESSION_REQUIRED`; the browser uses the session-scoped route, which authorizes the read from that session's own log. `ui-desktop-handoff` plus the desktop app's `aeven://` scheme registration let a hosted session continue on the user's machine.

## Alternatives considered

Mounting the desktop surface and relying on tool policy was rejected: the enforce is the composition, not a policy callback, and a shared disk means one account's file tools reach another's data.

Keeping one settings document for every account with only browser writes refused was rejected: an account's model choice, locale or personalization would then apply to all of them, which is a different bug than the write path.

Reading images by fingerprint was rejected on the shared Host even though it is cheaper and cacheable forever: the fingerprint alone would be the authorization, so any signed-in account holding an id could read another's image. Session-scoped reads cost the immutable cache header and remove that path.

Reusing the desktop's workspace file sync was rejected: a hosted Host holds no workspace folders, so there is nothing for a file-sync consumer to watch.

## Consequences

A hosted Host is a device of each account it serves and keeps that account's sessions, memory, and sync database in its own directory. That data is not encrypted at rest, so whoever operates the Host can read it; encryption at rest is not part of this change.

Offering no code execution at a hosted session also removes every tool that could inspect a file on the Host, including ones that feel harmless, and hosted images no longer get cache-forever URLs.

Per-account quotas, rate limits, and sign-up protection for a public deployment are not part of this change.

## Verification

Focused tests cover the composed hosted rows and the launch arguments; the settings controller refusing browser writes while account sections resolve per account; the workspace controller with folders off; the sync provider holding a connection for a signed-in account, applying bounded frames, and storing the relay grant; the vault's passkey and grant paths; and memory homes resolving per account. The web and hosted compositions were exercised against the production API and relay from a real browser session before this record was written.
