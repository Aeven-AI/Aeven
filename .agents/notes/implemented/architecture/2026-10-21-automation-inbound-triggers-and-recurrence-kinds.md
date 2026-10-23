# Agent Note: Inbound triggers and the wider recurrence model

Status: implemented

English | [中文](2026-10-21-automation-inbound-triggers-and-recurrence-kinds.zh.md)

## Problem

Built-in automations fired on time only: once, interval, daily, weekly. Any outside service that should have started one — a deploy hook, a monitoring alert, a form submission — had to be polled by a timer instead, and the timer was the only trigger the product had. The schedule vocabulary had the same ceiling: "every N minutes" and "these weekdays" left month-end and quarter-end work (billing on the first, the first Monday's report, a renewal date) expressible only as an approximation. The closest shipped comparable, Grok Bot's routines, accepts cron, month days, nth weekday, yearly dates, and inbound webhook triggers, so the gap was in the product's surface rather than in the difficulty of the mechanism.

## Decision

`AutomationSchedule` gains `hours`, `monthly`, `nth-weekday`, `yearly`, and `cron`. The recurrence engine was reorganized around one reduction — a matching-day predicate plus the wall times of a matching day — that drives both the forward occurrence scan and the backward latest-due lookup. That also removed a latent flaw: the previous `latestDueOccurrence` scanned a window and returned the sixteenth match, which is the latest only for sparse recurrences. Cron is parsed here rather than taken as a dependency: a five-field subset with `*`, ranges, steps, and lists, keeping cron's rule that a restricted day-of-month and day-of-week match either field, evaluated in the schedule's own IANA zone.

Inbound triggers are a prefix route `/automation-webhook` on the Host's own web server. Only `POST` is accepted, the automation's key is compared with `timingSafeEqual`, the body is capped by `webhookMaxBodyBytes` (8 KiB in the Web profile) and drained without retention when it exceeds the cap, and the accepted body is stored on the run as `payload`. That payload reaches the run notice under an explicit untrusted-data label, because the notice is model-visible and an outside sender must never read as an instruction. Admission reuses the manual path: the key is the whole authority, a paused automation answers 409, work already in flight records the occurrence as skipped, and the response returns before the run settles.

The key lives in its own `automation_webhooks` domain rather than on the definition. Definitions are version 3, their records are copied into every run snapshot, and `automation_list` returns them to the model, so a secret stored there would end up in transcripts. The page reads the key on demand for the one card its owner has open and displays it masked: copying is the operation, reading is not.

## Alternatives considered

- **Bump the definitions domain and add a webhook table there.** Rejected: the domain has no migration, so every stored automation would be rejected at open, and the version is not worth spending on a credential.
- **Store the key on the definition behind projection filters.** Rejected: one missed projection leaks a bearer credential into a model request, and the run snapshot already copies the definition wholesale.
- **A signed per-provider adapter, like `webhook-github`.** Deferred: the generic endpoint is what lets any service start a routine, and a provider signature scheme belongs to an adapter that can normalize the delivery.
- **A cron package.** Deferred: five fields are small enough to read and to bound, and the package would add a dependency to a manifest the repository verifies.
- **A graphical schedule editor.** Rejected: creation and adjustment are conversational by design, so the page renders the stored recurrence as a sentence and a new kind costs locale entries, not a form.

## Consequences

The union has nine kinds, and the client formats each into a local sentence, so a new kind needs its three dictionaries updated with it. Runs carry an optional `payload`, which older records lack and the schema accepts. Nothing signs a webhook and nothing deduplicates a delivery: a repeated `POST` starts a second run. A body beyond the configured cap is refused at the door rather than truncated. The backward walk is bounded per kind — two days for hour and daily schedules, eight for weekly, sixty-two for the month kinds, four hundred for yearly, and 2929 for cron — so a Host closed longer than its window admits nothing for the time it missed; the misfire grace window would have skipped those occurrences regardless. No tests or gates were run for this change beyond a typecheck, by the owner's standing instruction.
