# Agent Note: Desktop terminal opens for synced copies

Status: implemented

English | [中文](2026-11-26-desktop-terminal-opens-for-synced-copies.zh.md)

## Problem

The sidebar Terminal on the desktop failed with "Terminal error: session "…" is replicated from another device; fork it to continue" for almost every conversation. Account sync settles an idle conversation as a read-only copy on every device, including the one that created it, and a device writes it again only after claiming it ([session-sync](../../../../packages/session/session-sync/README.md)). Every `terminalController` Remote call took a gateway-resolved `Agent`, and resolving one resumes the Session, which session persistence refuses for a copy. The pane printed that internal error verbatim.

## Decision

- **`hostShells`** in [`@aeven/api-terminal-controller`](../../../../packages/api/terminal-controller/README.md), enabled by the desktop composition: a Session's shells run on the Host's own `subprocess` provider, starting in this device's folder for the Session's workspace. A live Agent supplies the header when this process runs the Session; otherwise `sessionQuery.observeSession` reads the stored header and `workingDirectory.observed` resolves the folder, so no Agent is resumed and no claim is taken.
- **Host-lifetime shells under `hostShells`.** Their owner record no longer ends with an Agent's context, so handing the conversation to another device, which releases the local Agent, leaves the shells running; idle shells are still reclaimed after `unattendedTimeoutMs`.
- **Remote methods take a `SessionId`.** `environment`, `shells`, and `create` resolve where the shells run; `follow`, `write`, `resize`, `rename`, and `close` address the Session's retained terminals, refusing another account's Session as an absent terminal. Client calls are unchanged, since the client already passed the Session id.
- **Without `hostShells`** the Session's Agent is resolved through `sessionController.resolveAgent`, as before, and its shells end with it.
- **Readable failures.** `workspace/no-local-directory` and `session/agent-busy` map to translated issues in the Terminal pane instead of raw messages.

## Alternatives considered

**Claiming the conversation when a Terminal opens**, as a model or title change does, was rejected: the next handover releases the local Agent and would kill the user's open shells. **Running every composition's shells on Host providers** was rejected because a composition whose Agent selects a remote sandbox (the E2B provider) would start shells outside it; Aeven Cloud disables the Terminal entirely. **A friendlier error alone** was rejected: the Terminal is a local shell and has nothing to wait for.

## Consequences

On the desktop a Terminal opens for any conversation whose workspace has a folder on the computer, whichever device writes it. Its shells outlive the conversation's Agent and end with the Host or after `unattendedTimeoutMs` idle. A browser on chat.aeven.io still reaches the cloud Host's terminal service, which is disabled; opening the shell on the desktop that runs the conversation is #821.
