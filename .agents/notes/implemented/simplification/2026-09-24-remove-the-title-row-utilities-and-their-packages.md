# Agent Note: Remove the title row's utilities seat and the two packages behind it

Status: implemented

English | [中文](2026-09-24-remove-the-title-row-utilities-and-their-packages.zh.md)

## Problem

The Session header's title row carried four controls: the Schedule catalog, the agent-preset chip, the background-jobs list, and the Session-log export. Only the middle two state a live Session fact — which preset this Agent runs and which jobs it has in flight.

The other two were the last visible surface of a package each. `@aeven/client-ui-schedule` drew one read-only header action, rendering the `schedule` Session projection as a catalog of the current Session's active reminders. `@aeven/session-log-export` owned the Web `/export` human command, the `GET`/`HEAD /api/session.export` ZIP route, the download dialog, and the `Session log` button that was the download's only visible entry point. The Web bundle resolved both packages to draw one header cell each.

## Decision

The title row renders the breadcrumbs — including the lineage seat — the View tabs, and the `conversation.session.header.actions` list, which holds the agent-preset chip (`@aeven/client-ui-agent-preset`) and the background-jobs list (`@aeven/client-ui-jobs`).

The `conversation.session.header.utilities` seat is deleted from the slot contract in `packages/client/ui-conversation/src/client/contract/slots.ts`, from the entry's runtime `children` declaration in `packages/client/ui-conversation/src/client/apply.ts`, and from the `ConversationSession.tsx` title row, together with the `.titleCluster` and `.headerUtilities` rules that gave it a cell. `.titleRow` keeps the single 56px flex row at one 10px gap.

`packages/client/ui-schedule` and `packages/session-query/session-log-export` are deleted with their sources, package tests, READMEs, and tsconfig projects. `packages/bundle/web-app/cordis.patch.yml` loses the `ui-schedule` row and the `session-log-download` row, and `packages/bundle/web-app/package.json` loses both dependencies.

The Schedule host capability is untouched. `@aeven/schedule` keeps `schedule_create`, `schedule_list`, and `schedule_delete`, its Agent-scoped runtime, and session-local delivery; it still registers the optional `schedule` Session-projection unit when `ctx.sessionProjections` exists, and `@aeven/client-ui-workspace` still derives its list-row alarm marker from that key through the type-only `@aeven/schedule/client` vocabulary ([durable Schedule decision](../feature/2026-08-05-durable-web-schedule.md), [conversational delivery](2026-08-09-conversational-schedule-delivery.md)).

This note absorbs the deleted Web Session-log export record. Its motivation still stands: a bug report needs the complete raw log of a Session tree in a shape that survives being forwarded, and the Trajectory view serves folded projections rather than raw entries. What stopped justifying the feature is ownership — the button was the download's only visible entry point, `/export` reached the same operation, and nothing else in the repository read the route, the dialog state, or the persistence artifact the archive was built from. The [naming ledger's](../architecture/2026-08-11-repository-naming-contract-and-rename-ledger.md) entries for those names went with them.

## Verification

`pnpm exec tsx scripts/gen-module-graph.ts --check`, `pnpm exec tsx scripts/gen-config-catalog.ts --check`, and `pnpm exec tsx scripts/gen-client-catalog.ts --check` report the regenerated module graph, configuration catalog, and client slot catalog up to date. `pnpm exec tsx scripts/run-tsc.ts tsconfig.client.json` compiles the client program with no diagnostic.

`grep -rn 'ui-schedule\|session-log-export' packages/*/*/src packages/*/*/tests packages/bundle apps/web/src apps/web/package.json apps/cli/package.json apps/cli/config` returns no match, and so does the same search over `packages` and `apps` for `SESSION_LOG_EXPORT_PATH`, `conversation.session.header.utilities`, and `headerUtilities`. After `pnpm run build:client`, searching `packages/*/*/lib` for either package name, the seat, and `session.export` finds nothing, while `conversation.session.header.actions` and `conversation.navigation.utilities` remain in the built client bundles.

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` pins the header's dispatch set in both phases: the active case requires the lineage and action seats, and the cold-start case requires the resident navigation seat while no `conversation.session.*` entry dispatches at all.

## Alternatives considered

**Keep both plugins mounted and unhook only their controls.** A resolved package whose every contribution is unregistered stays in the graph as code the build, typecheck, and bundle all still carry, and it publishes a package no composition uses. Deleting the export's earlier `session.log` RPC for the same reason is the precedent inside the absorbed record.

**Keep the seat reserved for a future utility.** An empty list seat with no declarant names nothing and holds a cell no entry renders. A new Session utility declares the seat it needs in its own change, and an app-level control that outlives a Session already has `conversation.navigation.utilities`, declared when the account avatar needed it.

**Keep the export behind a non-header entry point.** The visible action had already been refused a home in the Trajectory view, because export has to stay discoverable without opening a diagnostic view ([archived Web `/export` decision](../../archived/feature/2026-08-11-web-export-command-and-dialog.md)). With the seat gone, `/export` would have been a second entry point to a download no surface presents.

## Consequences

The Web app has no `/export` command and no Session-log download: the ZIP route, its `HEAD` preflight, the download dialog, and the per-Session controller are gone, and nothing in the repository consumes a Session-archive route.

Given up with the export is the byte-faithful archive itself — one file per Session and descendant, each byte-identical to the durable artifact and flushed before it was read, streamed from the host at a validated DEFLATE level so the browser never buffered it, with `supportsRawArtifacts` reporting a backend without raw artifacts separately from an absent Session. The persistence service keeps `readRaw` and `supportsRawArtifacts`; the deleted route was their only consumer. Reintroducing user-facing export needs a named consumer, a new entry point, and assembled download acceptance for the route, the read-boundary fidelity, and the error vocabulary, rather than a resurrected row.

The browser has no Schedule catalog. Active reminders stay reachable through the `schedule_list` tool and recognizable in the sidebar's list-row alarm marker, which reads the same projection key; a browser presentation for them needs a named surface and its own acceptance.

Session-header contributions have one Session-scoped seat, `conversation.session.header.actions`. The title row no longer reserves the 20px separation and the 8px entry gap the deleted cell carried.
