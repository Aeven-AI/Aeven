# Agent Note: The authentication gate waits the reader out and boots in place

Status: implemented

English | [中文](2026-09-21-auth-gate-boots-in-place.zh.md)

## Problem

Email sign-in showed a transition that read as a failure: the button spun, the button returned to its idle label, and the preloader appeared with no animation and cut to the application. The reader saw the progress stop and the page start over.

The three symptoms had one cause. `AppWebEntry` treated authentication as a decision rather than a wait:

```ts ignore-check
if (await this.gateOnAuthentication()) {
  hidePreloader()
  return            // the boot ends here, with no plugin graph behind it
}
```

`gateOnAuthentication()` mounted a screen and answered immediately, so a reader who then signed in had a session and nothing running it. The only remaining way to start the application was to load the document again, which is what `mount.tsx` was forced into:

```ts
window.location.assign(window.location.pathname + window.location.search)
```

Two further defects rode on the same cause. `Authenticate.tsx` cleared the sign-in button on the success path before navigating, so the reader was shown an idle button between the wait and the transition. And the reloaded document repainted `#avn-preloader` from the served HTML, which is opaque at first paint by design, so it could not fade in.

Email sign-in never needed a document load. Only a provider sign-in leaves the origin, and it leaves for a reason the gate cannot change.

## Decision

The gate is a wait. `AppWebEntry.gateOnAuthentication()` loops until a session exists, and the boot that follows it runs in the document the reader is already in:

- `restoreSession()` is read per iteration; `disabled` and `authenticated` return, and the authenticated branch still calls `installAuthenticatedTransport()` before the graph boots, because the connection builds its caller once from whatever the transport hook holds at that moment.
- Any other state mounts the screen that owns it — the naming step for `unnamed`, the route's screen otherwise — and `await`s that screen's completion.
- The loop re-reads the session rather than trusting the screen. A restored profile with no chosen name therefore lands on the naming step rather than the application, which is what `unnamed` means whether it came from the first read or the read after signing in.
- `this.page.dispose()` runs before each screen renders over the mount point, so every screen and eventually the application receive a free container.
- The container is a screen's until it settles. An `authenticated` state is not permission to render into a container a screen still owns.

`MountedAuthScreen` gains `readonly authenticated: Promise<void>`, settled when the reader has left that screen with a session established:

- `mountAuthScreen` settles from the same `popstate` path that previously called `window.location.assign` — the screens report success by moving to a path that is not an authentication route, arriving from their own `navigateRoute` or from `OauthResult`'s exchange.
- `mountNameScreen` settles from `NameCheck`'s `onNamed`, after `window.history.pushState(null, '', destination())`. The application reads the address as it boots, and there is no mounted application to hear a navigation.

The cover spans the wait and nothing else. `hidePreloader()` runs while a screen owns the page — the static preloader must not cover a sign-in field. `showPreloader()` runs the moment a screen settles, before the session re-read and the boot that follow it: that is the earliest point at which the sign-in button has stopped meaning anything, and everything after it is not something the reader can watch. `hidePreloader()` at the end of `run()` fades it out over the mounted shell ([when it is dismissed](../../implemented/bug-fix/2026-09-08-web-preloader-waits-for-shell-data.md)).

`Authenticate.tsx` no longer clears the sign-in button on the success path. Its error paths still do: a refused credential or an unreachable API leaves the reader on the screen, where the button must be usable again.

## Where a document still loads

Two remain, both deliberate and neither on the email path:

- A provider sign-in starts with `location.href = oauthUrl` in `Authenticate.signInOauth`, which leaves the origin for the provider's own consent screen. The provider returns the reader to this deployment's `/oauth-result/...`, which is a fresh boot of the kernel and reaches `OauthResult`. The return leg is now one load rather than two: `OauthResult` reports success through `navigateRoute`, which settles the mounted screen and boots the application in that document. Whether the start leg needs the document at all, and whether a desktop deployment should keep the application window out of it, is open — the desktop shell already reaches providers in a separate window and then throws its own application window away with `loadURL`.
- `leaveForSignIn()` reports a session that ends after the application has booted ([when a session ends](../../implemented/bug-fix/2026-09-14-aeven-session-survives-and-ends-visibly.md)): the running application disposes its plugin tree and the gate runs again, which is [the same hand-back this gate introduced](2026-09-22-session-end-hands-the-page-back.md) through `onSessionEnded` in `packages/client/ui-auth-aeven/src/client/auth/services/watch.ts`.

## Alternatives considered

**Keep the load and animate the handoff.** The reported symptom is the hard cut, so the cheap change is to fade the cover in before navigating and let the reload fade it back out. Rejected: the reader still loses the document, the reload is exactly what repaints the cover opaquely, and the kernel already had everything it needed to boot in place.

**Let the screen call back into the boot.** A `onAuthenticated` callback, or a gate object handed to `mountAuthScreen`, would replace the promise. Rejected: one settlement point is one fact, and a promise is that fact with an owner; a callback surface invites a second caller and a second meaning.

**Boot the application behind the screen.** Mount the plugin graph immediately, hide it under the authentication screen, and reveal it once a session exists. Rejected: an unauthenticated plugin graph is what running the gate before the graph exists to prevent, and it would put every client entry's activation and first data reads in front of a reader who cannot use them.

**`location.replace` instead of `assign`.** Rejected: it fixes the history entry, not the load.

## Consequences

The reader's progress no longer stops: the button keeps its state, the cover fades in over the wait, and it fades out over the mounted shell. Email sign-in, the naming step, and the `redirect` provider return all complete in the document they started in, which is also the only shape a desktop deployment can accept.

The gate now owns a control-flow loop where it previously owned a condition, so a screen that never settles holds the boot open forever. That is the intended reading of "the reader has not finished", and `mount.tsx` is the only producer of those promises.

`packages/client/ui-auth-aeven/src/client/auth/views/*.tsx` are excluded from per-file coverage and kept diffable against the Aeven client origin so one stylesheet governs both; removing two lines from `Authenticate.tsx` diverges that diff. `packages/client/web/src/*` and `auth/mount.tsx` are outside the per-file gate too, so neither file this decision is implemented in has coverage evidence. Its guard is behavior: `packages/client/web/tests/boot.client.spec.ts` drives a reader through the sign-in screen and through the naming step, and asserts the application mounts in the same document in both cases — both cases fail against the pre-change source.

`installAuthenticatedTransport()` returns a disposer that the boot does not retain: the page keeps the transport hook across an entry's disposal, which is that function's own contract. A session that ends after the boot still leaves through a document load, as described above.

## Testing

`boot.client.spec.ts` grew a gate suite over one bootable page fixture, which the preloader suite now shares:

- **Signs in.** The API refuses every route until the reader's request succeeds, the gate mounts `/sign-in`, and nothing of the application is mounted behind it. The test then raises what the screen's success path raises — a `pushState` to the application root and the `popstate` that follows it — and asserts the fixture renderer mounted in that document and the cover is dismissed.
- **Names.** The profile is answered without `displayNameSet`, so the gate mounts the naming step and holds the application behind it. The test types a name into the real `Input`, clicks Continue, and asserts the application mounts.

The `Input` value is written through the element prototype's setter and announced with an `input` event, because React tracks the value of each node it renders and a plain assignment is a tracked write the screen reads as no change.

## Related

- [Naming the reader](../../implemented/feature/2026-09-17-naming-the-reader.md) owns the naming step and the `unnamed` state; this note changes where its success lands, not what it asks.
- [Browser token authentication](../../implemented/architecture/2026-08-24-browser-token-authentication.md) owns the bearer and the transport hook `installAuthenticatedTransport()` installs.
- [The static web shell preloader](../../implemented/bug-fix/2026-09-02-static-web-shell-preloader.md) owns the cover's markup and CSS states.
