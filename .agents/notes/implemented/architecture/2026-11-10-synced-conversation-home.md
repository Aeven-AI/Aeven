# Agent Note: A synced conversation stays on the always-on device that ran its latest turn

Status: implemented

English | [中文](2026-11-10-synced-conversation-home.zh.md)

## Problem

A conversation of a synced account had no home. While a turn ran, other devices forwarded input to the device running it; once the conversation was idle, the device the user typed on claimed it and ran the next turn. On 2026-11-10 a hosted conversation started `pnpm install` in Aeven Cloud's account folder, and the user's next message, typed in the Mac's desktop app, ran on the Mac, where neither the clone nor the background job exists. Files, background jobs, and sandbox state stay on the device that created them.

This is phase 1 of the [proposed plan for which device runs a synced conversation](../../proposed/architecture/2026-11-10-synced-conversation-runner.md).

## Decision

A conversation whose latest turn ran on an always-on device, such as Aeven Cloud, stays on that device while it answers.

- `avn-sync-yjs` marks a device with `keepConnected` as `alwaysOn` in the account's synced device list. Only hosted Aeven sets `keepConnected`.
- `avn-session-sync` records in the session index entry the device that ran the latest turn (`writer`): a published suffix that contains a `turn/start` sets it to the publishing device, and any other publication, such as a rename or a model selection, keeps the previous value.
- `ctx.sessionHandoff.homeOf(owner, sessionId)` names that device when it is always on and is not the asking device.
- `avn-session-controller` forwards a turn-starting input (prompt, edit, retry) for such a conversation through the synced inbox instead of claiming the conversation.
- The inbox gives the always-on writer the first chance at a forwarded input, otherwise the device it was typed on. When the first device does not take it within `inputGraceMs` (3 s), any device may claim and run it, so input never blocks; the device that runs it becomes the conversation's writer.
- An input a device applies from the inbox runs on that device; the controller never forwards it again.
- A claim taken for a rename or a model selection holds the relay's runner lease, which only the end of a turn released. `ctx.sessionHandoff.endChange` gives the lease back once the change is applied and no turn runs, so the always-on home can take the next turn at once.

### Compatibility

No session event type, session log format, stream batch format, or `SESSION_FORMAT_VERSION` changes, so builds before and after this change read the same histories. The two new fields are optional members of synced maps: a build that does not know them ignores them, a conversation that lacks `writer` behaves as before, and an older build that publishes a conversation rebuilds its index entry without `writer`, which returns that conversation to the earlier behavior until an updated device runs a turn. An older desktop keeps claiming conversations it is typed on, because it does not know the rule.

## Alternatives considered

Recording the last device that published any events was rejected: a rename on the Mac would have moved a cloud conversation to the Mac.

Changing `holdRunner(false)` to release the lease of a claim without a turn was rejected: the session-sync plugin calls it on every agent status change, so it could drop a lease between a claim and the turn the claim was taken for. `endChange` is called only after a change.

Releasing the runner lease when no turn runs on any claim was rejected for the same reason; the lease still guards the window between a claim and its turn.

## Consequences

A hosted conversation keeps its files, background jobs, and sandbox when the user types on another device, which fixes the 2026-11-10 failure.

A cloud conversation cannot move to a desktop on purpose yet; the "Continue on this computer" action is phase 2 of the plan. While Aeven Cloud does not answer, for example during a deploy, an input typed on a desktop runs there after the input grace, and the conversation then stays on that desktop.

The rule treats only always-on devices as reachable without presence, because no device publishes liveness yet; desktops gain it in phase 3.

## Verification

On a local stack (the Aeven API and sync relay on ports 9000 and 9010, and two Hosts from this branch on one account, one with `keepConnected`):
- a message typed on the ordinary Host in a conversation the always-on Host ran last ran on the always-on Host;
- with the always-on Host stopped, a message typed on the ordinary Host ran there after the input grace;
- after a rename on the ordinary Host, its next message still ran on the always-on Host, and the index still named that Host as writer;
- a later fresh message with the always-on Host stopped ran on the ordinary Host about three seconds after it was sent.

The first run of the stopped-host case and the rename case failed, which found the re-forwarding loop and the held lease fixed above. An in-memory run of two mirrors also confirmed that an index entry without `writer` and a writer that is not always on give no home. Typecheck and build pass. An older desktop against the same relay was not run.
