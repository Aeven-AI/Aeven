# Agent Note: Memory listing filters by domain at the provider

Status: implemented

English | [中文](2026-10-02-memory-list-domain-filter.zh.md)

## Problem

Settings → Memory shows memories under three tabs: About you (`person`), Projects (`project`), and Knowledge (`world` and `experience`). `MemoryProvider.list` took no domain, so the page fetched every domain together and sorted the records into tabs after loading. The reported `total` counted all domains, so **Load more** on one tab could appear while every unloaded record belonged to another tab, and a click could add nothing to the tab the user was reading. The page also re-requested offset 0 with a growing `limit`, which the memory manager clamps to `maxPageSize`, so Load more never loaded a new record.

## Decision

`MemoryProvider.list` takes an optional `domains` filter (`MemoryListRequest`). With it, the page, its `offset`, and `total` count only memories in those domains; without it, listing is unchanged. The `memoryManager` Remote passes `domains` through from `ManagedMemoryQuery`, and each memory tab requests its own domains, pages by offset, and shows Load more only while the provider reports more of that tab's memories than are loaded and the last page was not empty.

MemOS's `listTraces` and `countTraces` apply domain and project-workspace predicates in SQLite. The first valid `domain:` tag determines the domain; an untagged trace is `project` inside a workspace and `experience` outside one, matching `traceDomain`. An unsearched page reads only its requested rows; the count evaluates the same predicates without hydrating trace payloads. Text search retains MemOS's substring matching after the database filters domains and workspaces.

## Alternatives considered

- **Keep filtering in the client and hide Load more when a tab shows nothing new.** The page cannot know whether unloaded records belong to the current tab without loading them, so the button would still appear on tabs with nothing more to show, or hide while the tab still had memories.
- **Store the domain in a MemOS column and filter in SQL.** SQLite's JSON functions filter the existing tags without a new column or schema migration.

## Consequences

Opening a tab or loading another page performs one page read and one count. Counting still evaluates domain tags across matching rows, but does not decode their full text, tool calls, or embeddings. Domain predicates preserve owner isolation and project visibility before pagination.

## Verification

`packages/memory/memory-memos/tests/list-domains.spec.ts` pins paging and totals per domain, the workspace and untagged fallbacks, the owner filter, one-page reads beyond the repository cap, domain-tag precedence, an empty domain filter, project visibility, and the unfiltered pass-through.
