# Agent Note: Bots get a trigger list, bound connectors, expiring grants, and boards with handoffs

Status: implemented

English | [中文](2026-11-20-bot-triggers-connectors-boards.zh.md)

## Problem

A bot definition had one schedule plus an optional inbound webhook, every run mounted all of the owner's connectors, and an approval given once in a run conversation answered forever with no way to revoke it ([#740](https://github.com/Aeven-AI/Aeven/issues/740)). A bot that should answer a mention could only poll: each poll was a full model run that paid every connector's tool catalog to find nothing new. Two bots with different authority could not pass work between them, and nothing recorded who woke whom or what a group of bots spent ([#741](https://github.com/Aeven-AI/Aeven/issues/741)).

## Decision

- `AutomationDefinition.triggers` replaces `schedule`. A trigger is `schedule`, `webhook` (at most one, with `idempotency: sender | none`), `event` (`mail` or `github`, with a filter), or `bot` (`from`, `mode: wait | dispatch`). A run records `triggerIndex`; an occurrence id hashes the bot, the trigger index, and the cause, so a redelivered event, a repeated idempotency key, or a retried handoff names one run. Each schedule trigger keeps its own watermark in `lastAdmittedAt`.
- `overlap: skip | queue | parallel`, default `skip`, decides what admission does with work in flight; `queue` is bounded by `queueDepth` and `drain` starts queued runs of a non-parallel bot one at a time, oldest first.
- `connectors: 'all' | ConnectorId[]`, default `all`, is enforced by the run's tool guard (`connectorOf` maps `mcp__<provider>_<id>__*` and `mail_*`) and also read by account integrations through `ctx.automations.connectorBinding(sessionId)`, so a run mounts only the bound connectors.
- A saved grant gets `expiresAt` from `grantLifetimeDays`; an expired grant answers nothing and a new answer replaces it. `/bots` revokes a grant through the `grant-revoke` endpoint.
- GitHub events arrive at `/automation-webhook/<id>/github`, verified with the bot's own key as the GitHub secret. This replaces routing a deployment-wide `webhook-github` source to accounts, which would have needed an owner mapping per source and is not composed in any shipped profile.
- Mail events come from a cursor poller over `ctx.mail.search`: one envelope search per watched account every `mailPollSeconds`, no model turn, and a first check that only records the inbox.
- A handoff is a durable `Handoff` record in the definition domain and the account's synced document. Any Host that may run the receiver admits it under the receiver's claim, so handoffs work between cloud and desktop bots without a request path of their own. `wait` settles the sender's run and hands the result back as a new handoff with `replyTo`, rather than holding the sender's run slot.
- A board is a named member list with an optional budget (`maxConcurrentRuns`, `maxTokensPerDay`). Admission refuses a run that would exceed it, with the ceiling as the run error and the handoff reason. A run records `usage` summed from its `assistant/message` events.
- Run conversations get `bot_handoff` only when some receiver names their bot, and `board_tasks` / `board_task_update` only for board members. The `automation_*` and `ask_user` guard is unchanged, so a run still cannot create a bot, a trigger, an edge, a connector binding, a grant, or a board.
- The domain stays at version 3. Storage domains have no migration, so a version bump would refuse every existing store at open; instead the definition schema reads a stored `schedule` as the first trigger with `connectors: all` and `overlap: skip`, which keeps existing bots running unchanged.

## Alternatives considered

- **Bump the domain to version 4** as #740 proposed. Rejected: `version-mismatch` at open would stop the service for every user with a bot.
- **IMAP IDLE for mail.** Deferred: IDLE needs a held connection per account while the pool closes idle connections; the poller reuses `ctx.mail` unchanged and costs one search per interval.
- **Board-scoped grants.** Rejected for now: grants stay per bot, so a board never widens what one member may do.

## Consequences

- Slack, Discord, Telegram, and WhatsApp event sources, a per-bot email address, and a hosted browser remain open in #740.
- Event deduplication holds per Host; boards, handoffs, and the token figures they carry sync across the account's Hosts, while budget concurrency counts the runs one Host knows.
