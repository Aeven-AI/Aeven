# Agent Note: Account sync carries the running turn and keeps appearance local

Status: implemented

English | [中文](2026-10-30-sync-running-turn-and-device-appearance.zh.md)

## Problem

A client that loads a page while another device runs a turn showed that turn as "Stopped". The Session list reported `running: false` for every stored and shared row, and the mirror only observed live-document changes, so the entries another device had already published never reached a freshly started client. The same account also carried appearance across devices: `ui-theme` registered as account reach, so a synced palette and content font size replaced another device's own. Separately, a publication that did not settle left the Session's index position frozen while every retry appended the same events to the stream again, and nothing reported the stall.

## Decision

`@aeven/api-session-controller` list summaries answer the running bit from the writing device's published live state (`remoteRunning`, reached through `runnerOf` and `liveOf`) for stored, shared and cold rows, and the mirror replays the live entries already present in the document when it starts, so a client that joins mid-turn learns it. `@aeven/client-ui-theme` registers the theme namespace as device reach. A publication uploads attachments before the events that reference them, warns instead of dropping the turn when an upload fails, advances the index position as soon as the events are on the stream, and runs under `publishTimeoutMs` so a call that never settles is reported and retried rather than holding the Session.

## Alternatives considered

**Carry the running bit in the control-stream baseline:** it adds a second wire field and a client apply path for the same fact the list already answers.

**Keep account reach and ignore appearance at apply time:** the account document would still ship one device's palette and font size to every other device.

## Consequences

A Session another device runs shows "Running" from the first list read, without waiting for a live change. A publication that never settles costs at most `publishTimeoutMs` (120 s by default) per attempt and reports a warning; an attachment that fails to upload leaves the objects unpublished while the turn's events still publish.
