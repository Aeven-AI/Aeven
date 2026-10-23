# Agent Note: Sidebar tools require an acknowledgement from the session window

Status: implemented

English | [中文](2026-10-24-session-sidebar-open-acknowledgement.zh.md)

## Problem

A model opening a shell or file needs the person to see it beside the conversation. Creating a terminal or resolving a path alone cannot establish that a window displays it.

## Decision

`terminal/show` and `workspace-files/show` ask the window displaying the calling session to open the requested sidebar content. The remote event bridge carries the request and its acknowledgement. Each caller bounds the wait with its configured timeout and cancellation signal. A terminal with no acknowledging window is closed; a file request reports that no window showed it.

## Alternatives considered

**Return success after allocating the resource.** Allocation establishes a shell or path, but gives the model no evidence that the person can see it.

**Ask the person to open every pane manually.** This prevents the model from completing a request to show a file or terminal through the existing sidebar.

## Consequences

Opening depends on a connected window for that session. Headless sessions cannot claim success, and failed display requests do not leave an unseen terminal running. The tools retain the existing session ownership and filesystem access checks.
