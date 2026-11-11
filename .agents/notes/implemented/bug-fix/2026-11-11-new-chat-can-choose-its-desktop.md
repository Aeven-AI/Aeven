# Agent Note: A new chat can choose its desktop

Status: implemented

English | [中文](2026-11-11-new-chat-can-choose-its-desktop.zh.md)

## Problem

On 2026-11-11 the user reported that a new chat on chat.aeven.io offers no Choose desktop row in its options. `SessionCommands.placement` asks `sessionHandoff.placementOf`, which answered undefined for a session absent from the account's sync index, and a new chat is absent by design: `publishSession` holds a conversation back until it has activity, so an unsent draft never reaches other devices. `moveTo` refused such a session too.

## Decision

On an always-on device, `SessionMirror.placementOf` answers for an unpublished session with the account's desktops, and its home is where the first input would go: the user's choice, else the present desktop that ran the latest conversation. `moveTo` on an unpublished session keeps the choice in memory, a desktop or null for this device, and `homeOf` routes the first input by it. The choice is dropped once `publishSession` writes the session's index entry, whose writer then says where it runs.

## Alternatives considered

Publishing the draft on a choice would put an empty conversation on every device. Keeping the choice in the client would leave the Host's routing, which forwards the first input, unaware of it.

## Consequences

A desktop app still offers no row for an unsent chat, because it does not route first inputs. A choice made on one browser is held by the Host process and is lost if it restarts before the first message; the default routing then applies.

## Verification

Typecheck and the full build pass. Not yet exercised live with desktops.
