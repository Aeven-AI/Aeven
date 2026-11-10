# Agent Note: A conversation on Aeven Web runs on the user's desktop when it is on

Status: implemented

English | [中文](2026-11-10-remote-runs-web-chats-on-the-desktop.zh.md)

## Problem

A conversation started on chat.aeven.io always ran in Aeven Cloud's jail, even while the user's desktop was online with its folders, apps, computer use, and browser. The [synced conversation home](../architecture/2026-11-10-synced-conversation-home.md) kept a cloud conversation in the cloud and let a desktop take one, but nothing sent web input to a desktop. The user's product decision was remote by default with no setting or prompt, falling back to the web when no desktop is available.

## Decision

- **Presence.** A device without `keepConnected` stamps `seenAt` on its entry in the account's synced device list every `presenceMs` (60 s) while its relay connection is open (`avn-sync-yjs`).
- **Default.** On the always-on device, `homeOf` sends a conversation no device has run yet to a desktop whose `seenAt` is within `presenceWindowMs` (150 s). With several such desktops it picks the one that ran the account's most recently updated conversation, since every open desktop stamps once a minute and the latest stamp does not say where the user is, and falls back to the latest stamp. It also sends and a conversation whose latest turn ran on a desktop back to that desktop unless its stamp is stale. Otherwise the conversation runs in the cloud as before.
- **Delivery.** Before forwarding, the controller gives back the runner lease this device still holds from creating the session (`endChange`); while held, the relay refused the target's claim and the input fell back to the cloud. The controller then forwards such input through the synced inbox with the sender's session credentials, naming the target in a new optional `to` field. The target takes it at once, another desktop never takes an input addressed elsewhere, and the always-on device waits `remoteFallbackMs` (10 s) and then runs it itself. That wait is longer than the 3 s `inputGraceMs` after which a 0.3.42 desktop takes any input, so a desktop that predates `to` still wins while it is open.
- **Override.** On Aeven Web the options menu offers "Continue on <desktop>" (`session.continueOn` with target `desktop`), and the desktop keeps "Continue in Aeven Cloud" and "Continue on this computer". `moveTo` accepts any device of the account.

No session event, log format, or `SESSION_FORMAT_VERSION` changes; `seenAt`, `to`, and the placement's `desktop` are optional fields older builds ignore.

## Alternatives considered

A heartbeat document per device, or relay-side presence, would need a new synced document or relay protocol; one field on the existing device entry, written once a minute by desktops only, is enough for the always-on device's choice.

Sending every web conversation to a desktop that never stamps presence would delay each one by the fallback whenever that desktop is closed, so a 0.3.42 desktop gets web input only for conversations it already holds or that the user moved to it.

## Consequences

With the desktop app open, a new chat on chat.aeven.io runs on the desktop with its computer use and browser. A desktop asleep or closed for more than 150 s gets nothing, and the cloud answers at once. A desktop that drops off inside that window costs one fallback of 10 s, after which the cloud has run the turn and the conversation stays in the cloud. Default routing needs desktops on the release that stamps `seenAt`; explicit moves work with 0.3.42.

## Verification

The session-sync, sync-yjs, session-controller, and ui-conversation specs pass (1003). The end-to-end check is a computer-use request typed on chat.aeven.io and run by the desktop app.
