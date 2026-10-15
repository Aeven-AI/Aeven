# Agent Note: Apple ticket delivery is repeated instead of failing the release

Status: implemented

English | [中文](2026-10-15-notary-ticket-delivery-retries.zh.md)

## Problem

A signed macOS release failed twice while stapling, not while signing or notarizing. Apple accepted both submissions — the logs carry `• notarization successful`, and the deep strict check that follows them verified the Developer ID identity — and `xcrun stapler` then failed with exit code 68 while looking up the ticket at `api.apple-cloudkit.com`: `NSURLErrorDomain Code=-1005 "The network connection was lost."`, an empty response, and `CloudKit's response is inconsistent with expections: (null)`. One run lost the lookup while electron-builder stapled the application, the other while the DMG hook validated the stapled disk image. Both artifacts were correct, and each occurrence still discarded a finished macOS build and, because the release job needs every target, the whole release with it.

## Decision

- **`apps/desktop/scripts/macos-notarization.mjs` owns Apple ticket delivery.** It recognizes the ticket-lookup failures in Apple's own output, repeats only those, and fails the build on the first attempt for every other failure, such as an invalid signature, a missing ticket record, or a notarization Apple rejected. One `staple` or `validate` gets three attempts, 15 seconds apart.
- **An accepted submission is never repeated.** `notarizeMacOSArtifact` submits once; when Apple accepts the submission and the ticket lookup then fails, it staples the artifact again, because stapling the same artifact twice changes nothing and another submission would spend a second full wait in Apple's queue.
- **The after-sign hook notarizes the application.** electron-builder's `mac.notarize` option staples in one unretried call, so `mac.notarize` is `false` and `notarizeMacOSApplicationAfterSign` submits the application, staples its ticket, requires that ticket, and verifies the release identity before the DMG and ZIP targets are built from the application.
- **The disk-image path keeps its contract.** `notarizeMacOSDiskImageArtifact` still notarizes, staples, and qualifies every DMG, and the `stapler validate` step inside `verifyMacOSDiskImage` runs through the same repeated delivery.

## Alternatives considered

**Repeat the whole notarization call.** `@electron/notarize` couples submission and stapling inside one function, so repeating it after a dropped lookup submits an already-notarized artifact a second time and waits in Apple's queue again: minutes to an hour for a failure that stapling again fixes in seconds.

**Keep electron-builder's notarization option and repair the staple afterwards.** That option's staple failure throws inside electron-builder's signing step, before the after-sign hook runs, so no hook can observe or repair it.

**Patch `app-builder-lib`.** The repository already patches that package, but such a patch would carry a retry policy upstream never asked for, and the DMG path, which the same policy must cover, is this repository's code already.

**Treat every exit code 68 as transient.** An artifact whose ticket Apple never issued also reports 68, so repeating it would hide a real notarization defect. Only the ticket-lookup diagnostics in Apple's output are repeated.

## Consequences

- A ticket-delivery hiccup costs at most 30 seconds of delay instead of a rebuilt macOS target; a lookup that fails all three attempts still fails the build, whose log names both the dropped lookup and the staple that followed it.
- A notarization Apple rejects, an invalid signature, and a missing ticket record all still stop the release on the first attempt, because ticket lookup is the only failure that is repeated.
- Application notarization leaves electron-builder for the after-sign hook, so one script owns the order that qualifies the application — submit, staple, require the ticket, verify the identity — and the DMG and ZIP are built from an application that already carries its ticket.
