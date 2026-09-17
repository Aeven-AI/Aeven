# Agent Note: Frame breakpoint reads and e2e scaffold admission

Status: implemented

English | [中文](2026-09-08-frame-breakpoint-and-scaffold-admission.zh.md)

## Problem

Two shipped changes left the repository's own lanes red on `main`, each because a consumer of the changed behavior was not moved with it.

`AppFrame` stopped measuring its own width and began reading the narrow breakpoint from `window.matchMedia`. jsdom implements no `matchMedia`, and the assembled web lane boots the real client tree in jsdom, so the unguarded read threw inside the `root` slot: every browser scenario rendered `data-slot-error="root"` and no application. The frame's own unit spec stubbed `matchMedia` in `beforeEach`, so the unit lane stayed green over a tree that could not mount anywhere else — the stub was hiding the defect it was written to model.

The same change removed the sidebar drag handle, its pointer handlers, the viewport concession chain, and the `ResizeObserver` the frame used to observe. Twelve specs still drove `handles[0]` as a sidebar handle, read the details width from an inline `style.width` that had become a custom property, and drove resizes through a `fireResize` that was never assigned again — a call that silently did nothing rather than failing.

Separately, the Aeven identity rows moved into the `avn-web-app` bundle patch, so every composition built from it registers an authority. `identityUsers.enforcing` is true whenever one resolver is registered, and an enforcing authority replaces the launch token: `authenticatedUrl` returns the bare origin and `authorizeIndex` serves the index to anyone. The web e2e scaffold boots that real composition and requires the token handshake — a 303 to `/` carrying a session cookie — so its setup threw for every scenario that used it.

## Decision

The frame reads its breakpoint through `matchNarrow()`, which returns the `MediaQueryList` or `undefined` where the runtime implements no `matchMedia`. Absent the API the shell stays wide, which is the three-column layout it already defaults to. This matches the guard every other `matchMedia` caller in the client tree already uses — `ui-theme`, `TurnNavigator`, and `AttachmentRail` — and makes the client tree mountable in a runtime without the API rather than requiring each harness to stub one.

The frame's spec describes the frame that exists. Its resize signal is `resizeTo()`, which moves the viewport and notifies the stubbed breakpoint listeners, because a media-query change is the only resize signal the frame can now observe; the `ResizeObserver` stub and the `fireResize` handle are gone rather than left as calls that do nothing. Details is the only draggable column, so the handle-count and pointer-sequence specs address it and assert against the `details` preference. The specs that asserted viewport concession now assert its absence: the centre column is `flex: 1` with `min-width: 0`, so CSS absorbs the squeeze and the rendered details width is the clamped preference at every viewport above the breakpoint. One spec covers the missing-`matchMedia` runtime directly.

The web e2e scaffold disables `identity-user-aeven` and `ui-account-aeven` in its patch stack. The scaffold operates no Aeven API, which is the case the bundle patch already names: a deployment that does not run one must disable both rows together. With no resolver registered the authority does not enforce, the launch token decides again, and the scaffold's existing handshake is correct as written — the admission contract did not need a second shape for tests.

## Coverage this does not have

`AppFrame.tsx` sits under the `packages/client/ui-layout/src/*` coverage exemption, so no per-file gate observes these branches; the 60 `ui-layout` specs are the evidence. The scaffold decision costs the e2e lane its coverage of the shipped authenticated path: the lane now exercises the composition without an authority, and nothing keyless covers Aeven admission end to end. Restoring it needs a resolver a test can satisfy without an Aeven API, which does not exist yet.

## Alternatives considered

**Stub `matchMedia` in the assembled web lane instead of guarding the read.** Rejected because it repeats per harness what the tree should carry once, and because it preserves the property that made this defect invisible: a spec-local stub is why a tree that could not mount anywhere else reported green. The guard is also what the client tree's other `matchMedia` callers already do, so the exception was the unguarded read.

**Keep the sidebar drag specs by restoring the handle.** Rejected because the handle's removal is the shipped decision — the sidebar's width is a store preference the column animates in CSS, and re-adding a pointer path to satisfy a spec would reverse that to preserve a test.

**Refresh the failing snapshots and stale assertions without reading them.** Rejected because three of the failures were a real product change (the panel now fades in with the column, and the narrow-viewport content blocker is a new element) and the rest were a crash. A refresh would have recorded the crash as expected output.

**Teach the scaffold to authenticate through the authority.** Rejected because no Aeven API runs in the lane and no stub resolver exists to stand in for one. Building one to unblock the handshake would put a test-only admission path beside the shipped one, which is the fence's own contract to state, not the scaffold's.

**Leave the shipped rows enabled and assert the 200.** Rejected because the API routes behind the index stay fenced: admitting the index proves nothing when every route the scenarios drive still refuses an unauthenticated caller.

## Consequences

Both lanes pass on a clean tree: `pnpm run test` covers 17,888 assertions across 1,066 files, and the web browser lane boots the assembled client again. The client tree mounts in a runtime without `matchMedia`, so a future harness needs no stub to render the shell.

The `ui-layout` specs no longer describe a column solver, because the frame no longer has one. `concede()` in `columns.ts` keeps its own unit spec but has no caller in the frame; whether the details column should still yield to a narrow viewport is a product question this note does not settle, and the function stays until it is answered.

The e2e lane's composition now differs from the shipped one by two rows. That difference is stated at the patch that makes it, so a reader who adds an admission-dependent scenario finds why it is admitted without one.
