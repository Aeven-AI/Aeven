# Agent Note: The signed-in avatar outlives the Session

Status: implemented

English | [中文](2026-09-17-account-avatar-outlives-the-session.zh.md)

## Problem

A fresh install showed no account avatar. Signing in worked — the reader was restored, the profile came back with their picture — and yet the top-right corner stayed empty, while the harness on the same machine showed an avatar whenever a Session was open.

Nothing in the authentication chain was missing. The default Web composition mounts `identity-user-aeven`, the Host injects `globalThis.__AVN_AEVEN__`, and the boot kernel's gate called `restoreSession()`, which published `globalThis.__AVN_AEVEN_READER__` with the reader's `userId`, `displayName`, and `imageUrl`. The served `client-ui-account-aeven` bundle read that global correctly.

The gap was the seat. The account menu registered into `conversation.session.header.utilities`, and that seat's only host was `ConversationSessionHeader`'s `.headerUtilities` row, which lived inside the `<header>` element `ConversationRoot` rendered behind `sessionId === undefined ? null : (…)`. A cold start has no Session, so it renders no header, so the seat had no host and the menu drew nothing — even though the menu needs no Session fact at all: it asks the page who is signed in.

A fresh install lands on exactly that state. With no Workspace and no Session, `/` stays on the hero, so the first screen of a new deployment was the one screen where the avatar could not appear. The harness at 3080 hid the defect: its `/` redirects to the last Session, whose header exists.

## Decision

The conversation column's navigation band is resident, not Session-owned.

`ConversationRoot` renders `<header>` — the bar and its blur background — in the hero and in an active Session alike. Only the Session header's own content stays gated on a Session, and it stays gated at its own `renderSlot` call: crumbs, View tabs, and Session actions appear once one is open.

The resident root declares a new seat, `conversation.navigation.utilities` (`kind: 'list'`, `scope: 'root'`). It is rendered by the same `<header>` in every phase, right-aligned after the header's own action cell.

`conversation.session.header.utilities`, the seat this defect turned on, is deleted together with its only occupant ([title-row utilities removal](../simplification/2026-09-24-remove-the-title-row-utilities-and-their-packages.md)).

`client-ui-account-aeven` registers into the new seat. Whether anyone is signed in is a fact about the app rather than about a Session, so the control that shows it belongs to the band that outlives a Session.

Its position does not move. `.navigationUtilities` continues the row at the same 8px gap the Session header's own action cell uses, so a reader sees the one row they have always seen, in either phase. The stylesheet already anticipated a hero bar — `.root[data-phase="hero"] .header { margin-bottom: 0 }` exists so the bar keeps its 56px band, and the hero composer centres between auto margins in what the bar leaves.

## Alternatives considered

**Widen `conversation.session.header.utilities` to `session-maybe` and render it from the resident shell.** One seat instead of two, but the seat would be named for a header that is not there, and its occupant would have to grow a `sessionId === undefined` guard for a state its name says cannot happen.

**Register the menu into `shell.overlay`.** The frame-wide layer is additive and exists in every phase, but it spans the whole frame: with the details column open its right edge is not the conversation column's, so the avatar would drift out of the bar it shares with the Session log button.

**Register into both seats, one per phase.** Visually equivalent and a smaller diff, but it is two registrations of one control that a reader never sees twice, and every later change to the menu would have to be made in both.

**Render the Session header on the hero too.** Its title, tabs, and actions all read the current Session, so a hero header means turning `ConversationSessionHeader` into a Session-optional component to draw an empty title row above the hero headline.

**Leave it: a reader opens a Session and the avatar appears.** The account control is how a reader signs out, switches night mode, and reaches their account page. A deployment whose first screen cannot reach it presents a signed-in reader it cannot identify, and the defect is invisible in exactly the state a new install starts in.

## Consequences

The avatar is present on the first paint of a fresh install and immediately after signing in, with no Session open, and it keeps the reader's real picture rather than a placeholder.

The hero now carries a 56px navigation band, so its composer centres in the band below the bar rather than in the whole column — the placement the hero rules were written for, and roughly 28px lower than before on a column of ordinary height.

Session behaviour is unchanged: the avatar holds the same corner, at the same size, and there is still exactly one of it.

A seat now exists for app-level controls in the conversation column, and the rule that decided this defect still holds: an entry that reads an app fact belongs in `conversation.navigation.utilities`, and an entry that reads a Session fact belongs with the Session header's own controls in `conversation.session.header.actions`. `ui-account-aeven` mounts with the authority, so a deployment that disables `identity-user-aeven` still disables it with it.

## Testing

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` pins both phases: the cold-start case asserts the bar and the navigation seat render with no Session selected while the Session header and the Session body are not dispatched at all, and the active-phase case asserts the Session seats and the navigation seat render together.

`packages/client/ui-account-aeven/tests/browser-plugin.client.spec.ts` declares the new seat, and covers waiting for it, tearing its entry down, and the injected face the menu draws from.

`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` is regenerated, so the new seat's contract, declaration owner, and occupant are published from the same source as every other seam; `docs/subsystems/slots.md` carries it in the shipped hierarchy.
