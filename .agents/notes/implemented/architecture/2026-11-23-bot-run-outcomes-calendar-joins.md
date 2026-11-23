# Agent Note: Bot runs report their outcome, calendar events and jitter wake bots, and handoffs join per chain

Status: implemented

English | [中文](2026-11-23-bot-run-outcomes-calendar-joins.zh.md)

## Problem

Three gaps were left after [the trigger list and handoffs](2026-11-20-bot-triggers-connectors-boards.md). A run that completed its turn always read `succeeded` and replaced the bot's last result, so a polling bot reported "nothing new" all day and a run that could not do its task looked finished ([#752](https://github.com/Aeven-AI/Aeven/issues/752)). Schedules could not express "15 minutes before each meeting" or "around 7", and every bot of every account fired at the same minute ([#753](https://github.com/Aeven-AI/Aeven/issues/753)). A handoff went from one bot to one bot, so "the editor writes once the researcher and the analyst have both finished" could not be built, and a failed step left nothing that would skip the rest ([#754](https://github.com/Aeven-AI/Aeven/issues/754)).

## Decision

### Run outcomes

- Every run conversation gets `bot_no_update`, `bot_report_failure` (`reason`), and `bot_pause` from `registerRunTools`; the root conversation never does. The calls set fields on the in-memory `ActiveRun`, and `execute` reads them once, when the run settles.
- A completed turn after `bot_report_failure` settles `failed` with the reason as `error`; the handoffs the run carried fail with it, and a `wait` reply carries the reason.
- `bot_no_update` makes a `succeeded` run `quiet: true` unless the log holds an `approval/decided` other than `allowed-once` or a successful `tool/call` whose `presentCall` is a diff card or a generic card of kind `edit`, `delete`, or `move`. `list` sets `lastRun` to the latest run that is not quiet, and `/bots` folds two or more consecutive quiet runs of one bot into one row.
- `bot_pause` pauses the bot only when the run settles `succeeded`, and stores `pausedBy: { runId, scheduledFor }` on the definition. The owner's own pause or resume clears it. Pausing narrows what the bot does, so the `automation_*` guard is unchanged.

### Calendar triggers and jitter

- `{ kind: 'calendar', calendar?, filter, offsetMinutes }` fires `offsetMinutes` from each matching timed event. `filter` has `title`, `attendee`, `hasExternalAttendee`, and `accepted`. An attendee is external when its domain differs from every domain of the owner's own addresses on the event.
- Automations owns the `CalendarSource` Service Definition and `registerCalendarSource`. Account integrations is the provider: it reads Google Calendar's primary calendar and Microsoft Graph's `calendarView` over REST with each connector's own token, so no MCP process and no model turn take part. The direction matches `connectorBinding`: account integrations already depends on automations.
- The Host that may run the bot reads every `calendarPollSeconds` (300 by default), after a calendar trigger is saved, and after a source registers. A read covers the firings from the misfire grace before now to two read intervals ahead; the scheduler timer fires each one at its instant.
- A calendar occurrence is identified by the bot, the trigger index, and the event id without its start. A moved event therefore fires at its new time while it has not fired, and does not fire a second time after it did. This deliberately departs from #753's "event id plus start" identity, which would admit a moved event twice.
- `jitterMinutes` (1–30) on every schedule kind but `once` delays each occurrence by `sha256(botId, nominal instant) mod jitterMinutes` whole minutes. `nextFiring` and `latestDueFiring` scan at most 64 nominal occurrences around the instant, and the jittered instant is the run's `scheduledFor`, its occurrence id, and its watermark. An interval's jitter must be smaller than its spacing.

### Joins and chains

- A `bot` trigger is `{ from: AutomationId[], join: 'all' | 'any', mode, joinTimeoutMinutes }`. A stored single `from` still reads, as a one-item list with `join: all` and 60 minutes.
- Every handoff and run reference carries `chain`, the run that started it: a run nothing handed work to starts its own chain, and replies inherit the chain.
- Handoffs on an edge with several senders are grouped by receiver, edge, and chain, and are not admitted one by one. `admitJoins` admits `any` on the first open input, and admits `all` once every sender has an input. When a run of a chain settles without handing work to a joining receiver it feeds, `settleRun` records a `failed` input with the reason. Missing senders past `joinTimeoutMinutes` become timed-out inputs.
- The joined run's id hashes receiver, edge, and chain. It carries `join.inputs`, and its notice names every input and every failure. A group with no input that carries work is admitted as one skipped run.
- `stopRun` refuses every open handoff of the run's chain with `CHAIN_STOPPED` and stops the chain's other runs this Host knows. `handOff` and `admitJoins` treat a chain with such a handoff as stopped. A queued run stopped before it started now settles its handoffs as well.
- The board card lists the handoffs of its latest chain, oldest first.

## Alternatives considered

- **A per-bot "only notify on news" setting** for quiet runs: rejected, as #752 says; the model decides per run, which also covers bots that report only sometimes.
- **Pausing at the `bot_pause` call**: rejected, because a run that later reports failure must leave the bot active, and reverting a pause would publish a definition revision that never applied.
- **Reading calendars through the connector MCP tools**: rejected. It needs an agent context and starts the Workspace or Graph MCP process for every read, while a REST listing with the token account integrations already refreshes costs one HTTP request.
- **Exposing a public event-listing method on account integrations for automations to call**: rejected, because automations cannot depend on account integrations without a cycle; the registration keeps the seam on the consumer.
- **Random jitter at fire time**: rejected; two Hosts of one account would admit different instants and the shared watermark could not deduplicate them.
- **Centred jitter (±)**: rejected for delay-only `[0, jitter)`, so a run never starts before the time its owner named.
- **A separate join record type**: rejected; failed inputs are ordinary `Handoff` records, so the join survives restarts and syncs to every Host through the existing handoff entries.

## Consequences

- There is no unread marker in the product, so #752's "does not count as unread" has nothing to change; a quiet run still bumps the Automations workspace in the sidebar.
- Quiet detection only sees file changes a tool presents as such; a file written by a shell command does not block quiet.
- Calendar reads cost one listing per connected calendar per interval while a calendar bot is active; an event removed less than one read interval before its firing still fires.
- Calendar deduplication is per Host, like mail.
- A frequent cron with a long jitter can skip occurrences whose jittered instant falls before an earlier one's.
- A sender that runs outside the receiver's chain never joins it: its input waits until `joinTimeoutMinutes`, and the receiver then runs with the missing senders named as timed out.
- Stopping a chain stops the runs this Host admitted and cloud runs it requested; runs other desktops admitted see only the refused handoffs.
