---
description: "Host Remote owner of transient Session-owned user terminals and the sidebar_terminal tool."
kind: "package-reference"
---

# @aeven/api-terminal-controller

English | [中文](README.zh.md)

## Summary

`@aeven/api-terminal-controller` owns `ctx.terminalController`, the Host service behind the sidebar terminal: it reports the Session's working directory and terminal limits, discovers the shells the execution environment provides, allocates a PTY once per caller-supplied terminal id, and retains, follows, writes, resizes, renames, and closes that terminal for its Session. Terminals run with the execution environment's system-user permissions, count against `maxTerminals` per Session, and are reachable only by the account that owns the Session. The same instance registers the `sidebar_terminal` tool over them and asks through `tools/pre-execute` before a call touches a terminal in a Session that is not `danger-full-access`.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Model Experience

### Sidebar terminal control

#### What the model sees

The tool `sidebar_terminal` with `open`, `list`, `read`, `send`, `rename`, `resize`, and `close`: `open` starts a shell in the Session's workspace and asks the window showing the Session, through the `terminal/show` waterfall, to open a Terminal pill on it, returning the terminal's info, or closes the shell again and fails when no window answers within `showTimeoutMs`; a read returns the terminal's info and bounded rendered screen and history text, and every other action names the terminal id it acts on.

#### Token effect

Only the call's own result text: a read is bounded by `maxToolOutputBytes`, and a send is refused above `maxInputBytes`.

#### KV Cache effect

Append-only: the result joins the conversation after the user's message and changes no earlier request.

## Known Limitations and Deferred Work

- **Terminals are Host-lifetime, not durable** — the owner records live in memory and nothing about a terminal is written to the Session log, so a Host restart loses every terminal with its scrollback.
- **One attachment sends input** — input control is exclusive, so the window that attached last writes and the others only read.
- **Unattended reclamation needs provider evidence** — a terminal closes after `unattendedTimeoutMs` of confirmed idle time with no window holding it, and a provider that cannot prove idle keeps it open; zero disables reclamation.
- **Invariant omission** — No invariant companion is published because the controller owns no session-event stream to replay: ownership, the per-Session cap, and close-to-termination are enforced inside the operation that mutates them, each terminal is disposed by its Session owner's effect, and the real-composition tool suite `tests/tools.spec.ts` covers those paths.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
