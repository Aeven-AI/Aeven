# Agent Note: A provider sign-in follows the flow the deployment states

Status: implemented

English | [中文](2026-09-21-provider-sign-in-flow.zh.md)

## Problem

Signing in with Google, X, or Apple always navigated the page's own document to the provider (`location.href = oauthUrl` in `Authenticate.signInOauth`). The provider then returned that document to `<origin>/oauth-result/<session>/<challenge>`, which boots the whole kernel again to reach the exchange.

That shape is what a public web client wants: provider registrations are written for it, and the landing is an ordinary page of the application. It is the wrong shape for an application that serves its own page from a scheme or a loopback origin, where a redirected document replaces the shell the reader was using and, on the desktop, opens a window the shell then has to intercept and close. The desktop shell already did exactly that: it keyed `will-navigate` on the provider URL, opened its own hardened window, and threw its own application window away with `loadURL` when the reader came back.

Nothing in the page said which shape the deployment wanted, so the client could not tell a public site from an installed one.

## Decision

**The flow is a deployment fact, stated by the Host and required when a provider is offered.** `identity-user-aeven` gains a validated `oauthFlow: 'redirect' | 'window'` field and states it in `__AVN_AEVEN__` beside the provider URLs. `apply()` resolves it at load and throws when a provider URL is configured without one: defaulting would give a page that cannot leave its document the shape that leaves it, and the deployment that stated the provider is the only party that knows which it serves. A stated flow with no provider URL is ignored rather than refused — there is no sign-in for it to describe.

`packages/bundle/web-app/cordis.patch.yml` states `redirect` (a public page), overridable with `AEVEN_OAUTH_FLOW`. `apps/desktop-host` states `window`, because the shell's page serves itself from `avn-app://`, where a redirected document would replace the shell Electron is holding.

**The shell serves either shape without being told which one it is rendering.** A page that opens the provider gets the shell's own hardened window — scrubbed user agent, no preload, sandboxed — and the landing that window comes back on is exchanged there, through the session that holds the API's refresh cookie, rather than loaded into the application window. A page that navigates to the provider instead keeps the intercept that already served it, and its landing is loaded back into the window it came from, which is the shape that page expects. An adopted Host is a deployment whose flow the shell does not state, and both its cases work.

**Under `window`, the provider is reached from a window of its own and the page never moves.** `openProviderSignIn(url)` opens it under a fixed name, so a second provider button replaces the first window instead of stacking another behind it.

**The session is the handoff, not a message between documents.** The landing window is this application's own `/oauth-result`, so it exchanges the provider's answer itself — the same `checkOauthToken` and `getProfile` a redirected document runs — which establishes the session in the origin's cookies, shared by both windows. `OauthResult` then reports by closing: a landing in a window this application opened is where the sign-in finishes, not where the application belongs ([the boot gate](../bug-fix/2026-09-21-auth-gate-boots-in-place.md) is what would otherwise boot a shell inside it, and the window that opened it is already waiting). The document that opened the window waits for that session with `awaitProviderSession()`, reading the profile until the API answers one, and then continues exactly as it does after the email form: read the profile, move off the authentication surface, and let the gate boot.

**A refusal is still shown where a refused sign-in is shown.** A landing that carries an error, or one whose exchange fails, leaves the apology on screen in the window that opened, exactly as `redirect` shows it; this document keeps waiting, and the reader closing that window leaves them on the sign-in screen with the button in their hands.

## Alternatives considered

**Keep one flow and let the desktop adapt.** The shell could go on intercepting the renderer's navigation for every deployment, which is what it does today. Rejected: it makes the application window's document the thing a sign-in spends, and the reader's page the thing it loses, on the one deployment class that can least afford it. The flow is a fact about the deployment, and only the deployment can state it.

**Default the flow from where the page is served.** The client could read `window.location.protocol` and treat a non-`http(s)` scheme as `window`. Rejected: it puts a security-adjacent routing decision behind a runtime guess, cannot tell a loopback-served page on a real desktop from the same page in a browser, and contradicts the repository rule that a deployment-varying choice is a validated config field rather than a fallback.

**Pass the result between windows.** The landing could report the `session/challenge` pair to its opener, which would then exchange it. Rejected as more machinery for the same outcome: the landing is already the application's own page, so it can exchange the pair itself, and the session it leaves behind is the same one every other sign-in path leaves. The opener then reads a session instead of trusting a message.

**Poll the session forever.** The wait has no ceiling and no cancellation: a reader who abandons the provider window leaves it armed, and the sign-in screen stays. Kept deliberately — that is the same unfinished state the gate models after the interrupted-sign-in change, and the reader's next action is the provider button. The desktop shell is the only deployment that would notice the abandoned window, and it owns that window.

## Consequences

A page that cannot leave its document can now offer provider sign-in at all, which is what the desktop deployment needs before its shell stops reloading for one. A public deployment is unchanged: it states `redirect` and reaches providers exactly as before, and the flag makes that statement explicit rather than implicit.

`oauthFlow` is required for any deployment offering a provider, so an existing `cordis.yml` that configures a provider URL without one now fails to load. That is the intended cost of the choice above — a deployment that states a provider is a deployment that serves provider sign-in, and the shape is now part of what it serves.

The landing `<title>` and window sizing are the provider's own; the application states only that a window is opened, its name, and its size.

`packages/client/ui-auth-aeven/src/client/auth/views/*.tsx` are excluded from per-file coverage and kept diffable against the Aeven client origin, so the two view edits — the flow branch in `Authenticate.tsx` and the close in `OauthResult.tsx` — carry no coverage evidence. `auth/services/oauth.ts` is inside the gate and covered at 100%.

## Testing

- `oauth.client.spec.ts` covers the window: the URL, name, and features it is opened with; that a document is a landing only when another document opened it; and the wait — resolved at once when a session is already there, still waiting while the API answers none, and still waiting through an API that cannot be reached rather than reading that as finished.
- `config.client.spec.ts` covers the resolver: the stated flow, and the fallthrough a page with no provider reaches.
- `packages/identity/user-aeven/tests/resolver.spec.ts` covers the Host side: the flow the page is served with, the refusal to load when a provider is offered without one, and a stated flow ignored when no provider is.
- The assembled browser is unchanged under `redirect`, which is every deployment the web lane runs: the gate, the preloader, and the boot path are covered by the suites that already own them.

## Deferred

The document loads a `redirect` deployment takes are the flow's own statement, not a gap, and the shell's intercept for them stays. The one load left that neither a provider nor a deployment chose is the session-ended load described in [the boot gate's change](../bug-fix/2026-09-21-auth-gate-boots-in-place.md): it needs a running application to hand the page back to the gate.
