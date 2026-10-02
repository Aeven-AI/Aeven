# Agent Note: Memory listing filters by domain at the provider

Status: implemented

English | [中文](2026-10-02-memory-list-domain-filter.zh.md)

## Problem

Settings → Memory shows memories under three tabs: About you (`person`), Projects (`project`), and Knowledge (`world` and `experience`). `MemoryProvider.list` took no domain, so the page fetched every domain together and sorted the records into tabs after loading. The reported `total` counted all domains, so **Load more** on one tab could appear while every unloaded record belonged to another tab, and a click could add nothing to the tab the user was reading. The page also re-requested offset 0 with a growing `limit`, which the memory manager clamps to `maxPageSize`, so Load more never loaded a new record.

## Decision

`MemoryProvider.list` takes an optional `domains` filter (`MemoryListRequest`). With it, the page, its `offset`, and `total` count only memories in those domains; without it, listing is unchanged. The `memoryManager` Remote passes `domains` through from `ManagedMemoryQuery`, and each memory tab requests its own domains, pages by offset, and shows Load more only while the provider reports more of that tab's memories than are loaded and the last page was not empty.

MemOS cannot filter on a domain: the domain is a `domain:` trace tag, and an untagged trace falls back to `project` inside a workspace and `experience` outside one. The MemOS provider therefore reads the owner's matching traces in `limit`-sized chunks, classifies each with the same `traceDomain` recall uses, keeps the requested page, and counts every match. A domain-filtered page costs a read of every trace the owner's text query matches.

## Alternatives considered

- **Keep filtering in the client and hide Load more when a tab shows nothing new.** The page cannot know whether unloaded records belong to the current tab without loading them, so the button would still appear on tabs with nothing more to show, or hide while the tab still had memories.
- **Store the domain in a MemOS column and filter in SQL.** MemOS's `listTraces` and `countTraces` filter on owner, session, and text only; a column would require changing that external dependency's database schema.

## Consequences

A domain-filtered `list` scales with the owner's whole trace count rather than the page size. Settings → Memory is the only caller and runs on user action, so the scan runs once per tab open, search, or Load more.

## Verification

`packages/memory/memory-memos/tests/list-domains.spec.ts` pins paging and totals per domain, the workspace and untagged fallbacks, the owner filter, the chunked reads, and the unfiltered pass-through.
