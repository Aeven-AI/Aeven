---
description: "The built-in Bots pages: overview, one page per bot, and runs."
kind: "package-reference"
---

# @aeven/client-ui-automations

English | [中文](README.zh.md)

## Summary

The sidebar's Bots link opens `/bots`, including direct navigation and refresh. `/bots` lists each bot as a card that links to its page, then the boards, each a card with its bots, handoff count, budget, and latest handoffs in the bot cards' columns, followed by a New board tile that drafts a board in the conversation, then ideas grouped by category with their local schedule, and has the ordinary composer at the bottom. An idea fills that composer without sending it, so the reader can change it first; while the account has no bot, an empty state sits above the ideas. `/bots/<id>` is one bot's page: a pinned card with its name, schedule, Run now or Stop, pause, and an options menu holding Delete, then its next run, last result, task, and runs, then an always-open Advanced card with overlap, saved approvals, GitHub and webhook triggers, and where it runs. Its composer reads "Change this bot…": the first message sent from it names the bot as an `avn-bot` mention, which the sent bubble shows as a bot chip, so the reader types only the change. `/bots/runs` lists runs across bots with retry, single-run removal, and clearing the finished history, and has no composer. Every run row links to the run's conversation, which holds its result. Deleting a bot, removing one run, clearing the runs, retrying a failed run, and replacing or removing a webhook key each ask in the page's own dialog before acting. Every creation and change still goes through the conversation's own approval. Starters that read email, calendar, or GitHub show a Connect action while the signed-in account has none of that group's connectors connected and enabled; it opens that connector in Settings. The pages use the same authenticated Connection as conversations and never store authoritative schedules in the browser.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Bot mention in a bot page's first message

#### What the model sees

The first message sent from a bot's page begins with `@[<bot name>](avn-bot:<bot id>)`, followed by what the reader typed, so the model reads which bot the change concerns and passes that id to `automation_update`. Starters only fill a localized draft that sends nothing until the person submits it, and the pages register no tool and no prompt section.

#### Token effect

The mention adds a few tokens to that one user message; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The mention is part of a logged user message, so it enters the conversation like any typed text and leaves the reusable prompt prefix unchanged.

## Known Limitations and Deferred Work

The pages refresh visible history every five seconds. Editing a bot's name or schedule in place on its page, without a conversation, is deferred. A connected-account list shows raw connector ids, so the bot's page leaves it out.

- **Invariant omission** — No invariant companion is published because this surface owns no durable state: every automation fact it shows comes from the `automation-control` RPC, and the pages keep only the open address, the reader's own composer draft, and the five-second history refresh.

### Dev Note

None.
