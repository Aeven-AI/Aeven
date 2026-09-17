# Agent Note: Naming the reader

Status: implemented

English | [中文](2026-09-17-naming-the-reader.zh.md)

## Problem

AVN had no name for a reader who had never chosen one. `ui-account-aeven` drew their `displayName` when the API supplied one and nothing when it did not, so a fresh account showed an empty profile row, and the account menu called them nobody.

Aeven records the name the reader chose on the account, alongside a flag that says whether they chose it: `/get-profile` answers `displayName` and `displayNameSet`, and `POST /set-display-name` writes the pair. The Aeven client asks for it. Its `Home` renders the `initCheck` step in place of the chat while `displayNameSet` is not true, so a reader who has never named themselves sees "Hi there! / Before we continue to chat, how should I call you?" with their name pre-filled when the deployment derived one, and cannot get to the chat until they answer.

AVN read neither the flag nor the route. The profile's `displayNameSet` was dropped on adoption, and the client had no call that could set a name at all.

## Decision

The name is part of identifying the reader, so the boot kernel's gate asks for it, beside the sign-in screens it already mounts.

`restoreSession` answers a fourth state, `unnamed`, whenever the restored profile does not carry `displayNameSet === true` — whether the API answered it `false`, omitted it for an account that never chose, or restored it from the kept profile during an outage. `AppWebEntry` mounts the naming step for that state and does not boot the application, exactly as it does for an unauthenticated reader.

`packages/client/ui-auth-aeven/src/client/auth/views/NameCheck.tsx` is the step, ported from the Aeven client's `initCheck`: the greeting, the reference's own line for an empty field ("You don't have to be anonymous with me ;)"), the name field pre-filled from `session.displayName`, and Continue. Its submit strips what a reader cannot see before it sends anything, refuses an empty name without a round trip, and reports a refused save in place.

`setDisplayName` posts `/set-display-name` with the bearer, then adopts the answer through `session.adoptDisplayName`, which moves `displayName` and `displayNameSet` together and writes them back into the kept `aevenProfile` — a kept profile that still said `false` would send the next load back to the step. A refused bearer sends the reader to the sign-in screen rather than leaving them on a step that cannot succeed.

Success loads the destination the same way the sign-in screens do: `authReferrer` when the reader asked for a path of their own, the application root otherwise. The gate runs again on that load and finds a profile that carries a name.

The step's stylesheet is Aeven's `_initCheck.scss` under this app's scope, with the one rule the step inherited from `_home.scss` at the origin — the home column's `.content-container`, whose flex column and full height are what let `.form-container` centre. The 68px greeting names the Google Sans Flex stack this app ships, because the vendored copy of Aeven's sheet drops the Bodoni faces it declared and never used.

## Alternatives considered

**A modal over the running application.** It keeps the sidebar and the account avatar visible behind the question, which is what the Aeven client's version does. But AVN's only always-present surface is the frame-wide `shell.overlay`, and a reader who cannot dismiss it is looking at a modal in front of an application they cannot use; the gate already owns "this page is not yours yet", and the step is that state.

**A takeover of the conversation column.** It would place the question exactly where the reference places it. `conversation.composer` is the seam for that, and it is deliberately inert on the cold start (`fallbackOnly: sessionId === undefined`) — which is the one state a fresh install is ever in, so the step would be invisible exactly where it is needed.

**Ask on the account page, where a name can already be edited.** Nothing would block the reader, but nothing would make them a name either, and every surface that names them would keep showing an id.

**Let the reader skip it.** The API refuses an empty name, so a skip would have to mean "ask me again next load". The reference blocks on the answer; so does this.

**Treat an omitted `displayNameSet` as named.** That would boot an older API's readers straight through, but it would also boot every reader who has never chosen a name: the flag is absent precisely for them.

## Consequences

A new account meets one screen between signing in and the application, in the reader's language, with the name the deployment already derived for them pre-filled. Once answered, the name is on the account: the account menu shows it, every later load boots straight through, and signing in on another machine does not ask again.

The question is a hard gate rather than a suggestion, which is what the Aeven client does too: an unnamed reader reaches neither the composer nor any other part of the application. A deployment whose API omits `displayNameSet` entirely — one predating the field — would ask every reader once per load; the route it posts to is the same one the Aeven client posts to, so a deployment that satisfies the reference satisfies this.

The step is the third screen the gate can mount, and the first that is not about a credential. `AuthGateResult` carries it, so the kernel decides where a reader goes from one answer rather than by asking the library twice.

A profile kept before this client knew the flag cannot claim a name, so a first load after the upgrade that cannot reach the API lands on the step; the next load that reaches the API rewrites the kept profile with the real answer.

## Testing

`packages/client/ui-auth-aeven/tests/gate.client.spec.ts` covers the flag absent from a live profile, the flag false, the flag true, and both readings of a kept profile during an outage. `api.client.spec.ts` covers the bearer and body `/set-display-name` is sent, the adopted name, the kept profile it rewrites, and a refused name. `session.client.spec.ts` covers `adoptDisplayName` moving both halves and a page that kept no profile. `packages/client/web/tests/boot.client.spec.ts` drives the kernel's `unnamed` branch end to end: the step mounts, its copy renders, and nothing of the application boots behind it.
