# Agent Note: The account menu reads the plan with the page

Status: implemented

English | [中文](2026-10-17-account-plan-read-with-the-page.zh.md)

## Problem

[The account menu's plan line](2026-10-17-account-picture-and-plan-menu.md) was read on the first open of the panel. A reader who clicked the avatar therefore saw the reader, Settings, and Log out, and the plan line arrived underneath them once the subscription route answered — the panel was already open and being read when the newest fact in it was still on its way. The avatar stands in the resident band from the first paint, so the read could start with the page and be in hand before anyone opens anything.

## Decision

`AccountMenu` asks for the plan as soon as it draws a signed-in reader, not when the panel opens. The read runs from an effect keyed on the reader being present, so the request leaves with the document, and the panel draws the plan line in the frame it opens.

The answer stays component state. The plan changes from the account page this menu leads to, far less often than the panel opens, and no other surface draws it, so it needs no store and the `shell.corner` registration keeps its shape.

An open that still has no plan — the page's read is settling, or it failed — asks again from a second effect keyed on `open`. Both asks go through the same `accountType` injection, and the `createReadCache` that the plugin's `apply` shares with the Account page folds the second into a request already in flight instead of putting another on the wire. A reader who is not signed in asks nothing.

## Alternatives considered

**Warm the read in `apply` and let the menu read the cache synchronously.** Rejected: it needs a second, synchronous accessor on the injection face beside `accountType`, and the component would read a mutable snapshot during render. The effect keyed on the reader reaches the same latency through the face the component already has.

**Read the subscription from the boot kernel.** Rejected: the authentication gate is linked into boot, so boot could make the call, but the plan is account presentation, and boot owns neither the account nor this row. A deployment that mounts no account menu would pay for the request anyway.

**Keep the read on first open and accept the late line.** Rejected: the panel opens on the reader's own click and they are looking at it, so a line that arrives after paint reads as a missing fact rather than one still coming. What the earlier note protected was one request per page load for readers who never open the menu; the panel stays open longer than that request takes.

## Consequences

A signed-in page makes one `/api/cloud/subscription` request it did not make before, whether or not its reader opens the menu, and one more for each open while the plan is still unknown. Once that read has landed, opening the menu costs no request of its own.

The menu keeps the plan it read, so a plan changed from the account page or in another client appears there after the next document load rather than at the next open; the account page's own view is unaffected.

## Testing

`tests/account-menu.client.spec.tsx` pins the timing, not only the text: one read while the panel is still closed, the plan line present in the same render as the open with no further call, and a second ask when the first read left no plan.
