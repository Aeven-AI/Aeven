# Agent Note: Session content search is lazy-on and user-configurable

Status: implemented

English | [中文](2026-09-04-session-content-search-settings.zh.md)

## Problem

The shipped profiles mounted the SQLite session-query provider with `openAt: never`. The sidebar still offered content search, but every query fell back to name matches with a message that described the deliberate deployment setting as temporary unavailability. Users could only enable the feature by editing a profile patch, although the web client already had a durable plugin-settings surface.

## Decision

The base-backed shipped profiles configure `session-query-sqlite` with `openAt: first-search`. Content search is available by default without importing `node:sqlite` or opening the derived index during startup.

The SQLite provider registers a `session-query-sqlite` settings section containing only `openAt`. The Plugins settings page presents that field as a staged **Search session contents** switch: on stores `first-search`, off stores `never`, and reset restores the composed value. Database location, journal policy, result bounds, and reconciliation tuning remain deployment configuration.

The Session Controller maps `SESSION_QUERY_SEARCH_DISABLED` to `session/search-disabled`. The Workspace browser uses that code to distinguish “off in Settings” from an index or transport failure while preserving immediate title and Workspace-name matches in either case.

## Alternatives considered

**Open SQLite at startup.** This makes the first query cheaper, but every process pays for the import and index opening even when no content search occurs. Lazy opening keeps default availability without adding startup work.

**Expose every SQLite provider field in the UI.** This would let a browser user change filesystem ownership, database lifetime, and resource bounds. Those values remain deployment-owned; only availability is a user preference.

**Keep the fallback message generic.** A single warning is simpler, but it cannot tell users that Settings can resolve the disabled case. A stable Remote error code carries that distinction without parsing Host diagnostics.

## Consequences

The first content query in a process pays SQLite initialization and emits Node's experimental SQLite warning. Turning search off rejects new full-text calls but does not close an index that already opened; plugin teardown still owns the handle. Exact session reads, filters, traces, title matches, and Workspace-name matches remain available while content search is off.
