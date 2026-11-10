# Agent Note: Scoped tool results state their range

Status: implemented

English | [中文](2026-11-10-scoped-tool-results-state-their-range.zh.md)

## Problem

An empty calendar listing proves that one window on that one calendar holds no events. Nothing in the result said so, and a reply once called the following day clear without querying it (#554). The memory-guidance half of that failure is fixed in `memory-context`; the result itself still read as wider than its query.

## Decision

`mcp-client` gains `resultNotes`: per raw tool name, a note appended to every successful result, with `{arg}` and `{arg|fallback}` filled from the call's arguments. The Google Calendar connector registers one for `calendar_list_events` that names the window, the calendar and the page, and says the listing covers nothing else. The note travels with the result, so it holds in every conversation, model and persona, and a deployment can add notes for other scoped tools in configuration.

## Alternatives considered

**A rule in the persona or system prompt.** Rejected: behaviour fixes belong in the plugin that owns the behaviour, and a general rule competes with every other instruction while the note sits beside the one result it qualifies.

**Changing the third-party Workspace MCP server.** Rejected: it is a dependency, and the projection layer is where Aeven already shapes MCP results for the model.

## Consequences

Every calendar listing grows by one sentence. A connector whose result is scoped by arguments can state its scope without code.

## Verification

A calendar question about one day shows the note after the listing in the session's tool result, naming that day's window and the calendar queried.
