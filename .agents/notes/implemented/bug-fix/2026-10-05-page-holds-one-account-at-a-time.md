# Agent Note: A Web page holds one account at a time

Status: implemented

## Problem

A reader with the Web GUI open in more than one tab saw their history vanish: the sidebar showed only a handful of Sessions, and the conversation already open reported `Failed to load history: session "session-…" not found (session/not-found)`. Signing out and signing in again in that tab restored everything, which is why the report arrived as "the state the UI was in was probably not signed in".

Nothing durable was lost. Every Session log was intact, and the Host answered the same reads for the same reader once the page held one identity again. The state was entirely this document's:

- `appBearers` and `userId` are per-origin, so every tab of the GUI shares them. A sign-in in one tab writes its account id there.
- `heldBearer()` read that id, adopted it into the page session (`session.userId = userId; session.userSignedIn = true`), and returned that account's token — for a document that had restored a *different* reader, and without touching the reader the account menu draws or the Session the conversation pane has open.
- `exchangeRefreshCookie()` did the same when the API answered a renewal: the refresh cookie belongs to whichever tab signed in last, so an exchange could return another account's grant and the page adopted it.

From then on the document rendered one account's chrome and read another account's Sessions. The Host is right to answer `session/not-found`: a Session another account owns reads exactly as an absent one ([`callerMayAccessSession`](../../../../packages/api/session-controller/src/agent.ts), [per-account isolation on a shared Host](../architecture/2026-09-30-per-account-isolation-on-a-shared-host.md)). The session list is filtered by the same rule, so the sidebar showed only what the adopted account owns — the reader's own history, gone.

The watcher's multi-tab guard covered only half of that: `onStorage` reacted to `appBearers` losing *this* page's bearer, never to `userId` naming somebody else, and it ignored `userId` events entirely.

Two related dead ends made the same state possible without another tab:

- `restoreSession()` rebuilt a signed-in application from the kept `aevenProfile` on any failure that is not a refusal, including a transport failure. That is deliberate while the refresh cookie still identifies the browser ([an Aeven outage leaves the application running](2026-09-15-aeven-outage-leaves-the-application-running.md)), but a Host 401 to a request that presented no bearer is proof it does not.
- `installAuthenticatedTransport` returned a Host 401 unchanged when it had no bearer to renew, so nothing ended the session and the page kept calling.

## Decision

**An account change outside this document's own sign-in ends this document's session.** `tokens.ts` never adopts a stored id or an exchange grant that names another account: `servesPage()` refuses both, and the exchange reports [`IDENTITY_CHANGED_CODE`](../../../../packages/client/ui-auth-aeven/src/client/auth/services/errors.ts) instead of storing the grant. `watch.ts` turns that — and a `userId` storage event naming another account — into `replacePageAccount()`, which resets the page session and notifies `onSessionEnded`. The boot kernel already owns that signal ([a session that ends hands the page back to the gate](2026-09-22-session-end-hands-the-page-back.md)): it disposes the plugin tree and runs the gate again, so the whole document is rebuilt as the account whose credential the browser now holds, with that account's reader, navigation and history.

`replacePageAccount()` discards no stored bearer, unlike `leaveForSignIn()`. The account that replaced this page's is signed in; its session belongs to the tab that established it, and deleting its token here would sign that tab out instead of this one.

**Between sessions the transport presents nothing.** `pageIsLeaving()` is true from the moment a document's session ends until the gate that follows starts its watcher, and the hook answers 401 without reaching the Host. A request sent in that window would be authenticated by the refresh cookie of whichever account replaced this one's — the same defect by another route. Outage behavior is unchanged: a transport failure leaves the session in place and the request still goes out with no `Authorization` header for the cookie to identify, which is what `packages/client/ui-auth-aeven/README.md` documents.

**A Host refusal ends the session, whatever it was presented.** A 401 to a bearer renews and retries once, as before. A 401 to a request that presented no bearer cannot be renewed: the cookie identified nobody either, so `noteHostRefusal()` is recorded and the page leaves for the sign-in screen. `restoreSession()` then refuses to rebuild a reader from the kept profile for that pass, so a page whose every call would be unauthenticated shows the sign-in screen instead of an application that looks signed in. The latch is cleared by the watcher the next gate starts, and a reader who signs in clears it by succeeding.

## Alternatives considered

**Let the page adopt the account the browser stores, and reload the Sessions it shows.** Rejected: it keeps the rendered reader, the account menu and the open conversation belonging to the account the gate restored while the page acts as another, which is the state being removed. The reader would also have no way to tell which account they are acting as.

**Re-run the gate only on the storage events, without the guard in `heldBearer`/`exchangeRefreshCookie`.** Rejected: storage events do not fire in the tab that writes, they can be missed while a document is suspended or restored from the back/forward cache, and the renewal path reaches the API without touching storage first. The guard at the two adoption points is what makes "one document, one account" an invariant rather than a race.

**Discard the other account's bearer, as `leaveForSignIn()` does.** Rejected: it ends a session this document was never part of. The reader who signed in would be signed out by a tab they are not looking at.

**Send nothing at all and let callers fail while the page is between sessions, without a 401 answer.** Rejected: the connection plugin's caller already treats a non-OK response as a transport failure, and a synthetic 401 states exactly what happened — this document had no session to present.

## Consequences

A document now runs as exactly one account for its whole life. A sign-in in another tab rebuilds it into that account rather than half-adopting it; the account menu, the session list and the open conversation all move together. A page whose session the Host refuses reaches the sign-in screen instead of issuing calls that cannot be authenticated.

`packages/client/ui-auth-aeven/tests/watch.client.spec.ts` covers the three new behaviors: another tab's sign-in ends this document's session while leaving both stored bearers in place, a renewal answered as another account is refused with nothing stored, and a page holding another account's stored credentials presents nothing to the Host (the host mock is never called and the caller sees 401). It also covers the bearer-less Host 401: the session ends, the refusal is recorded, and the address is not moved — the kernel owns that. `packages/client/ui-auth-aeven/tests/gate.client.spec.ts` pins that the kept profile no longer restores a reader once the Host has refused the page. The existing test that another tab's *sign-out* still reports the end of the session is unchanged and passing, as is the one that ignores a storage change leaving this reader signed in.

The spec `retries a Host 401 once with a renewed bearer` narrowed its assertion to the call under test: installing the transport also starts the watcher, whose credential handover on `api/credential` carries the same bearer, so recording every request made the expectation depend on microtask order rather than on the retry.
