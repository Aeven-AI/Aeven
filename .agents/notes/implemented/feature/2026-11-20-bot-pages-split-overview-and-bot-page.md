# Agent Note: The Bots page splits into an overview and one page per bot

Status: implemented

English | [中文](2026-11-20-bot-pages-split-overview-and-bot-page.zh.md)

## Problem

Adjust on a bot wrote a canned prompt into the composer, including the bot's raw id, while the composer still said "Describe a new bot". The page was overview, creation, and per-bot management at once, and a bot's actions sat below its whole task inside an accordion. Clicking an idea sent it at once, so the agent's first question opened over the composer before the reader could change anything.

## Decision

The Bots pages are three start addresses: `/bots` (overview with the composer), `/bots/<id>` (one bot), and `/bots/runs` (runs, no composer). A start address claim can now end in `/:id`, which matches one UUID segment, and an exact claim wins over the pattern, so `/bots/runs` stays its own page. The claim gains `composer: false`, which keeps the composer mounted but hidden so a draft survives moving between pages, and `frameMessage`, which turns the typed text into the message the Session sends. `UiWorkspace.startPage()` replaces `composerPlaceholder()` and returns the page's registration key, composer choice, and placeholder; `frameMessage()` frames only the message from the blank Session the open start page shows.

A bot's page frames its first message as `@[<name>](avn-bot:<id>) <typed text>`. The model reads the id it passes to `automation_update`, the message is logged as sent, and the user bubble folds the mention into a bot chip the same way it folds `avn-session` mentions. The tool descriptions already require confirmation before an update, so the page sends no instruction text.

An idea fills the overview's composer and never submits. Each start page and a new chat's empty start screen open scrolled to the top, because they share the conversation column's one scroller.

The pages reuse the original card styles: the overview card's summary links to the bot's page, the bot's page pins a card with the same name-and-schedule block and the actions row, and the options menu opens like the other options menus. A "For your role" category adds eight role starters. The sidebar's managed folder is titled "Runs" through `workspaceTitle`.

## Alternatives considered

**Keep the composer-first page and fix the Adjust prompt's wording.** The raw id and the "new bot" placeholder would still sit in a composer used for editing.

**Hidden context outside the message.** Anything that reaches a model request must be reconstructable from the session log; a mention in the logged message meets that without a new session event.

**A dedicated creation page at `/bots/new`.** Built and removed: the overview with its own composer does the same job without a second address to get lost in.

## Consequences

The bot's page names the bot in the first message only; later messages in that conversation rely on the model remembering it. Editing a bot's name or schedule in place, without a conversation, is deferred.
