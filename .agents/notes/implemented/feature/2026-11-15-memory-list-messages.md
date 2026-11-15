# Agent Note: Listing the Person's Earlier Messages

Status: implemented

English | [中文](2026-11-15-memory-list-messages.zh.md)

## Problem

Asked "What are the 3 most stupid questions I ever asked", Aeven ran four `memory_search` calls with sixteen queries, got two to four unrelated hits each, and answered that memory keeps summaries rather than the person's questions. Memory does keep them: every turn's trace stores the person's message verbatim, and the owner's store held about 2,770 conversation turns. `memory_search` ranks by embedding similarity with score floors, so a question about the person's messages as a whole ("stupid", "first", "every time") matches nothing, and no tool could go through the messages in order.

## Decision

`MemoryProvider.list` takes `turns: true`, which pages one record per conversation turn, the turn's trace that holds the person's message, with `limit`, `offset`, and `total` counting turns; the MemOS provider maps it to the core's `groupByTurn` listing. `MemoryRecord` carries its `origin`, as recall hits already do. `@aeven/tool-memory` registers `memory_list` over it: the person's messages newest first from every conversation the session may see, each with its local date and trace id, paged by `offset` with a `nextOffset` and a header naming the page's date span, a repeat of the same message on the same day listed once, an optional literal text filter, and imported facts and learned procedures left out unless `includeSaved` is set. The tool description tells the model to use it for questions about what the person asked over time and to list before saying earlier messages are unavailable; `memory_search` points to it. Page size and message length are `Config` fields.

## Alternatives considered

A search query tuned for "questions" still ranks by meaning and cannot enumerate. Mounting `session_search` was rejected for this case: it searches one workspace, and each hosted conversation has its own. A date-range filter would need a vendored core change; newest-first paging covers the same need.

## Consequences

The list follows the visibility of recall: project memory of other workspaces is left out. Imported facts and learned procedures still count in `total` and in page bounds, so a page can hold fewer messages than `limit`; the page header states how many were left out.

## Verification

`tsc -b` over the memory packages and `pnpm run build` pass; Cordis API catalogs regenerated. Live check in the desktop app: in a new chat, the original question loaded `memory_list`, paged 600 of 3,935 messages, and answered with dated quotes. The same run showed the model estimating the span it had read as three months when the page dates covered one week, and listing duplicate captures twice; the page header now names the date span and repeats are collapsed.
