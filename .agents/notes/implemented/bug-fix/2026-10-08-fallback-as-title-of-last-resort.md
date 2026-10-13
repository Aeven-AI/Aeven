# Agent Note: The fallback is the title of last resort

Status: implemented

English | [中文](2026-10-08-fallback-as-title-of-last-resort.zh.md)

## Problem

A fresh Web session was named twice within about a second and a half. `onUserMessage` created the deterministic fallback as soon as the first eligible human message landed, and the registered first-prompt provider appended a model title over it once the main request's route was logged, so the sidebar row, its search rows, and the browser tab each displayed the truncated first prompt and then a different name. One auxiliary model call happened per session — the duplicated work was the title itself, and a reader had no way to tell a provisional name from a settled one.

The same window offered Rename. A row menu is hidden only while a Session is `blank`, so from the first turn's start the row carried its New Session label, a live Rename action, and a dialog prefilled with that provisional label as the Session's current title.

## Decision

A revision a provider owns is titled by that provider alone. The deterministic fallback is the title of last resort: it titles every Session no provider covers, fills a revision that ends without a title, and titles Sessions resumed without one. [Log-backed session titles](../feature/2026-07-21-log-backed-session-titles.md) owns the surrounding design; this note changes which revision one scheduled automatic call produces.

### One accepted revision per scheduled revision

`onUserMessage` schedules the provider revision and schedules nothing else, so a provider-backed fresh Session shows the localized New Session label until its model answer arrives. `fillFallback` queues the deterministic title for one live Session that no revision is queued or in flight for:

- a provider call that fails or returns an invalid result, filled once the failing revision releases its active slot;
- a revision dropped before its call, by `startPending`'s guards or by provider disposal;
- a prompt no provider owns, because none is registered, the cadence does not schedule it, or the Session already holds an accepted title.

A revision that a newer revision superseded fills nothing — that newer call reports the outcome — and neither does work whose Session is gone or whose service is unloading. `runProvider` clears its active slot before filling, so the fill is not itself mistaken for in-flight work, and `ensureFallback` still returns an accepted title rather than appending a second one.

### Rename while a title is being created

The sidebar row withholds its Rename action while the Session has no durable title and is working: that row reads as the localized New Session label, so there is no name to prefill and one is already on its way. The fact is the row's own `untitled` and `running` bits, which the list already carries, so no new wire field or host fact is needed. A title-less Session at rest — a prompt that produced no eligible title input, and so schedules nothing — keeps the action, because nothing is coming that could replace a name the reader gives it.

## Alternatives considered

- **Keep the immediate fallback and gate Rename on a live title-work fact** — rejected because it adds a host fact pushed over the session-list status channel, a wire field, and its client plumbing, while leaving the double naming that prompted the report: the reader still watches the row and the browser tab change name.
- **Withhold Rename on every title-less row** — rejected because a Session that can never be titled, such as one prompted only with ineligible content, would then lose its only rename path. The working conjunct is what keeps the action for a row at rest.
- **Delay the fallback on a timer instead of filling it on a revision's end** — rejected because a timer is a second state machine racing the provider it waits for, while a revision's end is the exact point at which a title is known to be missing.
- **Suppress the fallback whenever a provider is registered** — rejected because a provider can leave a Session untitled forever: a call that fails, is dropped, or is disposed would strand the Session on its provisional label with no durable name, and a resumed Session with no scheduled provider would never be titled at all.

## Testing

`packages/session/session-title/tests/provider.spec.ts` covers the accepted-revision count (one `session/title` event for a provider-owned revision), the failure fill, the superseded revision that fills nothing, and the Session that is gone before its fill. `service-contracts.spec.ts` covers the disposal and dropped-revision fills. `packages/client/ui-workspace/tests/rows.client.spec.tsx` covers Rename withheld while a row is title-less and working and restored once the title lands. The keyless recorded-session scenario `snapshots/sdk/session-title-after-turn` replays unchanged, because a resumed titled Session schedules no new revision. The owner-local CLI expectations under `apps/cli/tests/profiles/headless/tests/expected/` were refreshed to the new event order, where the fallback now follows the failed call it fills.

## Consequences

- A Session is named once. The sidebar row, search rows, and browser tab keep the localized New Session label and then the settled title instead of showing an intermediate truncated prompt slice.
- A provider-backed fresh Session stays visibly unnamed for the model call's latency, which the base profile bounds at sixty seconds and which measures about 1.5 s against the shipped route. A failed or disposal-ended call still leaves a durable title, because the fallback fills it.
- The fallback, rather than the prompt, is now the only title a deployment with a failing provider keeps, so the configured `fallbackMaxWords` and `fallbackMaxBytes` decide that name's quality.
- Rename is unavailable for the length of that window on a row that has no title yet; the row keeps Fork and Archive throughout.
