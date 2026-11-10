# Agent Note: Which device runs a synced conversation

Status: proposed

English | [中文](2026-11-10-synced-conversation-runner.zh.md)

## Problem

A conversation of a synced account has no fixed home. While a turn runs, other devices forward input to the device running it; once the conversation is idle, whichever device the user types on claims it and runs the next turn (`claimRunnerAccount` in `packages/api/session-controller/src/commands.ts`, `runnerOf` in `packages/session/session-sync/src/mirror.ts`). That rule loses work in two directions.

On 2026-11-10, a hosted conversation cloned a repository and started `pnpm install` in Aeven Cloud's account folder. The user's next message, typed in the Mac's desktop app, ran on the Mac, where neither the clone nor the background job exists, so the request to stop the install could not reach it. Files, background jobs, and sandbox state stay on the device that created them, and the next turn landed on another one.

In the other direction, a conversation started on the web always runs in Aeven Cloud's jail, even when the user's own computer is online with their folders, tools, and computer use. Claude Code in VS Code and Codex can run a turn on the user's machine from elsewhere; Aeven cannot.

## Proposal

A conversation stays on the device that ran it last, Aeven Cloud included, unless the user moves it or that device is unreachable. A new conversation started on the web runs on the user's computer when one is online ("remote"), and otherwise in Aeven Cloud.

### The rule

Every device evaluates the same rule over the same synced state, so they agree without coordinating:

1. A turn is running: it stays on that device.
2. The user moved the conversation with "Continue on this computer" or "Continue in Aeven Cloud": the chosen device runs it.
3. No device has run it yet: a reachable desktop able to run it, the primary desktop when one is set and reachable, otherwise the most recently active one; with none, the device the user typed on.
4. The device that ran it last is reachable and able to run it: that device.
5. That device is unreachable: for a folder session, a desktop that has the workspace's folder, primary first, then most recently active; for a chat without a folder, a reachable desktop by the same order, otherwise Aeven Cloud.
6. Nothing else is reachable: the device the user typed on.

"Able to run it" means the device is online by relay liveness, runs a build that reads every event type in the log, may run turns, and, for a folder session, has that workspace's folder.

Input never blocks. The device the user typed on forwards the input through the synced inbox and waits a short, configurable time (about 3 s) for the chosen device to take it; without a pickup, the rule continues at step 5 and then step 6. The relay lease and the log fold already keep a turn from running twice, and a batch from a device that fell behind is dropped and its prompts resubmitted.

### Product decisions

- Remote is on by default for every account, with no setting shown and no per-device permission prompt until every phase below has shipped. Regular users are never asked about it.
- Forwarded input runs under the desktop's normal permission presets, the same as input typed on that desktop.
- The desktop that runs a conversation is the most recently active one; an explicit primary desktop overrides that. The primary desktop has no UI until the plan is complete.
- UI stays minimal and appears on request: the two "Continue …" actions sit in a workspace's or conversation's existing options menu, and nothing else is shown until the plan is complete. Their exact placement and copy (zh, en, es) still need sign-off.

### Phases

1. **Sticky last device.** Steps 1, 4, and 6, with Aeven Cloud as the only always-on device. A conversation that last ran in Aeven Cloud keeps running there when the user types on another device. The model's runtime context says when files from an earlier turn stayed on another device. No UI. This fixes the 2026-11-10 failure.
2. **Explicit moves.** Step 2, through the two "Continue …" actions in the options menu, after UI sign-off.
3. **A desktop that runs without a window.** The desktop keeps its sync connection when no window is open (`keepConnected` is hosted-only today, `packages/sync/sync-yjs/src/index.ts`). It stores a per-user model credential, such as a refresh token in the OS keychain keyed by user id, because `llm-aeven` holds the user's token only while a client is signed in. Each device publishes presence: its kind (desktop or cloud), build and forwarding-protocol version, and whether it may run turns. Liveness comes from the relay seeing the socket, with ping and pong every 10–15 s so a sleeping Mac stops counting as online, and not from a heartbeat in a synced document.
4. **Remote by default.** Steps 3 and 5 for chats without a folder. This phase ships only together with its protections:
   - Inbox entries are signed by a per-device key held in the OS keychain, and a desktop runs only input signed by a device of the same account.
   - Forwarded input carries the device it came from.
   - A desktop that becomes preferred again after dropping out waits until it has been connected steadily for a while, and Aeven Cloud keeps an idle conversation it took until that turn ends.
   - A turn a device ran while it had fallen behind is recorded as a visible "turn on X was discarded" event instead of a silent resubmission.
   - Files a turn produces become content-addressed session attachments, which sync on request, because the folder itself does not move between devices.
5. **Folder sessions, several desktops, automations.** Step 5 for folder sessions, primary-desktop override, automations under their existing per-automation lease with the same rule, and web input for folder sessions forwarded to a desktop that has the folder instead of the "Available in Aeven Desktop" dialog. The setting, the primary desktop, and a status line ("Running on MacBook", "Computer offline, running in Aeven Cloud") become visible only when this phase ships.

## Alternatives considered

The current rule, where the device the user typed on takes an idle conversation, needs no presence or forwarding, but it moves a conversation away from its files and jobs whenever the user switches devices, as on 2026-11-10.

Preferring the user's desktop for every idle conversation, which an earlier draft of this plan proposed, chose "the last desktop that ran it" and fell back to Aeven Cloud only with no desktop online. It would still have sent the 2026-11-10 message to the Mac, because that conversation last ran in Aeven Cloud. Preferring the last device, whatever its kind, keeps the desktop preference for new conversations without that failure.

Always running in Aeven Cloud is the simplest and the safest, but gives up the user's own folders, tools, and computer use from the web.

A one-time "Allow this computer to run web conversations" prompt per desktop, as Codex and ChatGPT ask, was rejected as a product decision: regular users must not be asked. Device-signed inbox entries take its place, and they ship with remote rather than after it.

Sharing the conversation's folder between devices was rejected in favor of synced attachments for produced files: two-way file sync across a laptop and a jail brings conflicts and quota questions that attachments avoid.

## Acceptance criteria

- With the desktop app open, a message typed on the Mac in a conversation that last ran in Aeven Cloud runs in Aeven Cloud and can stop that conversation's background job (phase 1).
- "Continue on this computer" moves a conversation to that desktop, and the next turn runs there; "Continue in Aeven Cloud" moves it back (phase 2).
- With every window closed and the desktop app in the background, a web message in a new chat runs on the desktop within the pickup wait, under the desktop's presets; with the desktop asleep or offline, it runs in Aeven Cloud after the pickup wait without the user doing anything (phases 3–4).
- An inbox entry not signed by a device of the account is not run on any desktop (phase 4).
- A turn interrupted by a device dropping out and answered elsewhere shows a "turn on X was discarded" event, and its prompt runs once (phase 4).
- A desktop whose build cannot read the log is never chosen (phase 3).

## Risks

- With remote on by default and the desktop's normal presets, anyone who takes over the user's web login can run on that desktop whatever its presets allow. Device-signed inbox entries limit this to devices of the account, which a stolen web session alone does not hold, but there is no per-device consent.
- A turn moving between devices changes the tool set and breaks the prompt cache at each switch.
- Side effects of a discarded turn, such as files a desktop wrote before it dropped out, stay on that desktop's disk.
- A flaky desktop could cause conversations to switch back and forth; the steady-connection wait and Aeven Cloud keeping an idle conversation it took are the guard.
- The stored model credential on the desktop is a new secret at rest.
- Aeven Cloud deploys from `main` continuously while desktops lag behind, so version skew is ordinary; a desktop that would refuse the log must not be chosen.
