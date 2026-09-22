# Agent Note: Freshness gates join the cheap document aggregate

Status: implemented

English | [中文](2026-09-22-freshness-gates-join-the-cheap-document-aggregate.zh.md)

## Problem

Changes that moved source landed with stale generated references, and every one of them surfaced later as an apparently new defect. `docs/event-producer-consumer.md` was regenerated once after the webserver origin change, then made stale again by the app-boot reconcile that added `hmr/config-update-failed`; `docs/config-catalog.md` carried four stale source lines; the Agent Note from the assertion fix carried a `ts` fence that cannot compile.

Those leaves ran only in `doc-sync` and the full `check:all` aggregate. `pnpm run test:docs` — the build-free documentation aggregate sessions run before pushing — reported 15 passed, 0 failed while `verify-doc-graphs` and `doc-typecheck` were red on the same content, so the staleness was invisible at merge time and the aggregate that would have caught it arrived a merge or two later.

## Decision

`pnpm run test:docs` fails on a stale generated reference. `verify-doc-graphs` and `verify-config-catalog` carry `quick: true` in `scripts/run-gates.ts`, and `docQuickLeafGates` adds `verify-module-graph` beside them. All three are `tsx scripts/gen-*.ts --check` readers over `packages/*/*/src` and package manifests; none builds, which is what the `quick` flag on a gate means.

`doc-typecheck` stays outside that aggregate. Its script is `npm run build:lib:host && npm run doc-typecheck:contracts-ready`, so it is not build-free, and its failures are landed instead through `.agents/skills/avn-pre-push-checks/SKILL.md`: a change that adds or edits an Agent Note, or any Markdown carrying a `ts` fence, runs `pnpm run doc-typecheck` before pushing, and a deliberately unchecked fence carries `ts ignore-check`.

The same skill records that running focused gates instead of the full suite never exempts generated-document freshness, and `.agents/skills/avn-ci-test-reliability/SKILL.md` records the diagnosis rules the two contention failures earned: check whether a mechanism is armed asynchronously before blaming load, probe the dependency rather than repeating the aggregate, carry a root cause across sibling cases, never record an untested hypothesis as an observation, and prefer excluding a transient path over serialising readers.

## Alternatives considered

**Adding `doc-typecheck` to the aggregate.** Rejected: it builds the Host library, and every other leaf in this aggregate is build-free by definition. Including it would fail on an unbuilt checkout.

**Putting the freshness leaves in the pre-push hook.** Rejected: the hook is a fast local checkpoint and CI owns the full matrix, while the documentation aggregate is the command this repository already tells sessions to run.

**Relying on the prompt rule alone.** Rejected as the whole answer: rules are advisory and were already implied, whereas the aggregate is enforcement that cannot be forgotten. The rules are recorded because they cover what the aggregate cannot, not instead of it.

## Consequences

`pnpm run test:docs` costs the three freshness checks, roughly a minute more than the prose gates, and any change that moves source must regenerate the affected reference before pushing.

The note-fence class stays rule-covered rather than gate-covered, because its check needs the built library; a notes-only variant of the type check would close that gap if it recurs.

The change is verified by fault injection: deleting the `hmr/config-update-failed` row from `docs/event-producer-consumer.md` made `pnpm run test:docs` fail with `gen-doc-graphs: stale graph doc(s): docs/event-producer-consumer.md`, and restoring the row passed.
