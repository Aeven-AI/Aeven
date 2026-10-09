# Agent Note: Chat control of sidebar terminals

Status: implemented

English | [中文](2026-10-09-chat-sidebar-terminal-control.zh.md)

## Problem

The sidebar owns user shells through `terminalController`, while persistent agent tools use `ctx.terminals`. Chat cannot reach a sidebar shell through the agent terminal registry.

## Decision

`api-terminal-controller` registers `sidebar_terminal` when the tool registry is available. Operations resolve terminal ids within the calling Agent's Session. Rendered reads are bounded by `maxToolOutputBytes`; sends accept raw text and optionally append Enter. A successful send acknowledges input acceptance, not command completion.

Agent input shares the PTY operation queue without claiming the browser's exclusive attachment. User typing and tool input remain ordered by whole writes. Restricted sessions request approval through the tool pipeline because user shells are not confined by the agent sandbox. Session grants name the account, terminal id, and operation; danger-full-access sessions need no additional grant.

## Alternatives considered

Registering these shells in `ctx.terminals` would conflate user shells with sandbox-confined agent shells. Driving the sidebar through browser automation would make shell control depend on DOM discovery and browser focus.

## Consequences

Web and Electron use the same Host service. The model can list, read, send, rename, resize, and close existing sidebar terminals. Creating a shell remains a sidebar action. Tool calls and results supply durable model history; raw PTY output and shell processes remain Host-local. Concurrent user and agent command editing can still interleave separate writes.

Three focused Loader tests exercise real shell state, live browser followers, raw Ctrl-C, owner isolation, invalid input, and restricted-session approval reuse. A live chat on the web app sends and reads `AEVEN_SIDEBAR_CONTROL_OK` through its visible zsh pane.
