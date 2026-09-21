# Agent Note: A session that ends hands the page back to the gate

Status: implemented

English | [中文](2026-09-22-session-end-hands-the-page-back.zh.md)

## Problem

The boot gate waits the reader out and boots in place ([the gate's change](2026-09-21-auth-gate-boots-in-place.md)), so signing in, naming, and a provider return all happen without a document load. A session that ends *after* the boot was the exception: `leaveForSignIn()` deleted the held bearer, remembered the path in `authReferrer`, and called `window.location.assign(AUTH_ROUTES.signIn)`.

That load was the last one no provider or deployment had chosen, and it cost the reader the page they were on: an RPC whose renewal the API refused, or another tab's sign-out, replaced the whole shell to reach a screen the kernel already knows how to present.

## Decision

**The end of a session is reported, not performed.** `watch.ts` keeps a listener set and exposes `onSessionEnded(listener)`, which returns a disposer. `leaveForSignIn()` discards the held bearer, resets the session, and notifies every listener. It no longer touches the address: whoever owns the page moves it, and the gate records the reader's own path as the referrer when it does — the same two things its unauthenticated branch already did for a reader who never signed in.

**The boot kernel owns the hand-back.** `AppWebEntry.run()` subscribes once, runs a pass, and then follows the document's session detached:

- `run()` still resolves once the pass *it* started has settled, which is the contract the shell and every boot spec already rely on. Awaiting the loop inside `run()` would hang every caller the moment the application came up.
- Each pass opens a latch. A screen mounted by the gate waits on `Promise.race([screen.authenticated, latch.promise])`, so a session that ends *while a screen is up* also stops that screen's wait: the loop re-reads the session, finds none, and mounts the sign-in screen.
- When the latch fires, `leavePage()` disposes the plugin tree. Every effect's disposer runs, which is what takes the mounted renderer off the container, and the next pass starts on a free one. The boot page keeps its own disposal, which the gate already performs before each screen.
- A pass that failed clears its latch, so the following ends: the failure stays on the page and there is nothing left to present over it.

**A second install replaces its watcher.** `installAuthenticatedTransport()` is called by the gate on every authenticated pass, and each call starts a renewal watcher. It now stops the watcher the previous install started, so a page that boots again after an ended session runs one renewal timer rather than one per session.

**`watchSession()` is what says the page is not leaving.** `leaving` gated the renewal loop; it is now reset by `watchSession()` itself, because watching a session is the fact that says the reader has one. Without that reset, a reader who signed in again after an ended session would never be renewed — the new watcher would return at its first check.

## Alternatives considered

**Keep the load and make it cheaper.** Rejected for the same reason the boot gate rejected it: the reload is what repaints the cover opaquely, and the kernel can present the sign-in screen in the document the reader is already in.

**Let `leaveForSignIn()` navigate, and have the kernel only handle the running case.** Rejected: `navigateRoute` inside the service would move the address while a screen — or a plugin tree — still owns the container, and the kernel would then have to detect a navigation it did not make. One owner, one mechanism.

**Report through a browser event (`window.dispatchEvent`).** Rejected: a page-level event is reachable by anything on the page, including plugins, and the kernel is the one consumer. A module seam with a disposer keeps the subscriber list and its lifetime explicit.

**Expose `leaveForSignIn` from the package's `/client` entry so tests can trigger it.** Rejected: the boot spec imports the module directly through the package's `./src/*` subpath, which is what those tests are for. Widening the entry for a test is the rule the client packages state explicitly.

## Consequences

An RPC refused for an expired session, and another tab's sign-out, now return the reader to the sign-in screen in the document they are in, and signing in again resumes where they were. No document load remains on any path a session can take.

The cost is that the kernel holds the page's session state across passes: a pass that ends leaves its `Context` disposed, its container empty, and its latch spent, and the next pass rebuilds all three. A plugin that kept process-wide state outside its fiber would survive that teardown; the repository's registration rules already require every contribution to be an effect, which is what makes it safe.

`packages/client/web/src/*` and `.../auth/mount.tsx` remain outside the per-file coverage gate; the guard for this decision is behavior: `boot.client.spec.ts` boots the application, ends the session, and asserts the tree was disposed, the sign-in screen mounted in the same container, the address moved by `pushState`, and the reader's path recorded as the referrer. It fails against the pre-change source.

## Testing

- `boot.client.spec.ts` — the hand-back above, through `leaveForSignIn()` imported from the same module instance the kernel subscribes through.
- `watch.client.spec.ts` — the refusal and the cross-tab sign-out report the end once each, discard the held bearer, and leave the address and the referrer to the page owner.
- `name-check.client.spec.tsx` — a refused name reports the end rather than navigating, so the naming step is left by the kernel, not by the screen.
- `config.client.spec.ts` — an unparseable provider URL passes through, which is the statement the provider path's own catch makes.
