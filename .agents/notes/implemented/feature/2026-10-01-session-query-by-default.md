# Agent Note: Session search is offered by default

Status: implemented

English | [中文](2026-10-01-session-query-by-default.zh.md)

**Superseded by [session search stays opt-in](2026-10-01-session-query-stays-opt-in.md).** The four presets no longer mount the row, so this note is the record of why it was tried rather than the shipped composition. Its account of the profile module fallback and of the snapshot lane still describes what mounting the row costs.

## Problem

`@aeven/session-query` shipped as a package every preset had to opt into, and none did. The agent could therefore only remember what the memory provider distilled and what recall returned: when the useful material was a decision, a file list, or a command in an earlier conversation, nothing in a shipped session could reach it. The tools were documented in the generated tool catalog as though a model would see them, which made the catalog describe a composition no profile had.

## Decision

The four shipped presets — `aeven`, `standard`, `cordis`, and `ptc` — mount `@aeven/tool-session-query` beside `tool-memory`. One row adds five tools (`session_search`, `session_event_search`, `session_trace`, `session_event_trace`, `session_event_read`) and one guidance section, and `apps/cli/package.json` declares the package so the shipped profiles resolve it.

The measured cost of that row is 1,703 characters of model-facing tool descriptions, about **426 tokens**, against a turn measured at roughly 19,000 input tokens: about 2 percent, and it buys the only route from a session to its own workspace's earlier sessions. Recall covers remembered facts; this covers the session record itself.

## Alternatives considered

- **Mount only the two search tools.** The event-level tools earn their place exactly when a search hit needs its lineage or its exact payload; splitting the row would trade the forensic half of the capability for a few hundred characters.
- **Leave it opt-in.** Then the catalog keeps describing tools no shipped composition registers, and a user has to know a package name to get search over their own sessions.
- **Put the row in `avn-base` instead of the presets.** Tools are per-session; the base plane holds services. A tool row belongs where the agent's other model-facing rows live.
- **Widen the guidance section to explain each tool.** The five descriptions already state what each returns; a longer section would duplicate them on every request.

## Consequences

Every shipped session now offers five more tools, so a model choosing between tools has a wider field; the descriptions were written to route (`search` → `trace` → `read`) rather than to enumerate.

Mounting a row in an already-running Host has a sharp edge. The profile's module fallback (`$AVN_HOME/profiles/node_modules`) is healed from the deployment's declared dependencies at boot, so a Host started before this row was declared cannot resolve `@aeven/tool-session-query`: the preset then fails to mount and **every session of that preset fails to resume** (`row "tool-session-query" names a plugin that cannot be resolved`). Linking the package into the fallback repairs a running Host without a restart, and the next boot heals it from `apps/cli/package.json` by itself.

The recorded-session snapshots pin every assembled request, so mounting the row changes them. Refreshing those sidecars needs `pnpm run test:snapshot:refresh` with a model key, which this checkout does not have: until that runs, the snapshot lane stays red on the added tools. The lane was already red on a stale `tool-jobs` description fixture before this change.

## Verification

`pnpm exec vitest run packages/preset/agent-presets` passes 186 tests across 12 files. The suite's roster pin listed four presets while the tree ships five, so it now expects `aeven` as well. `pnpm run verify-cordis-config` reports only the pre-existing `tool-call-access-policy` mapping gap and no finding for the new rows, and `pnpm run verify-tool-catalog` fails on four tool packages that predate this change (`tool-capability`, `tool-device`, `tool-memory`, `tool-search`) rather than on `tool-session-query`, which the generator already catalogues.
