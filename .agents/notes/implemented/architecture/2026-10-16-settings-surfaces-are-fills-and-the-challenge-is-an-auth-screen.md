# Agent Note: Settings surfaces are built from fills, and the authenticator challenge is an auth screen

Status: implemented

English | [中文](2026-10-16-settings-surfaces-are-fills-and-the-challenge-is-an-auth-screen.zh.md)

## Problem

The Account, Voice and Personalization settings pages had drifted away from one another and from the rest of the product surface. They drew their boundaries with strokes: the Account page put its protection row inside a bordered card, the plan tiles carried a 1px black outline on the recommended plan, the personalization voice options were cards with a radio ring, and its fields were outlined. The enrolment step those pages open was worse: `MfaForm` rendered a centered card — 410px, 24px radius, its own emblem tile, a 23px heading over a 208px QR code — inside a settings page whose every other row is a hairline cell. Two stylesheets' tokens were also stale: the form asked for `--dsw-alias-background-primary`, `--dsw-alias-border-primary` and `--dsw-alias-status-danger`, none of which this theme defines, so it painted the fallback hexes it shipped with.

The sign-in challenge had the same problem from the other side. `MfaForm` in its login mode drew that same card on the authentication surface, which is why the second-factor step looked nothing like the emailed-code step one screen earlier: different width, different title scale, one text field instead of the six-box code entry, its failure text inline where the auth screens raise a popup.

## Decision

Settings surfaces express a boundary as a change of tone, never a line. The palette is the theme's `--dsw-alias-bg-module-platform` for a quiet surface, white for content sitting on one, and `--dsw-alias-button-primary-fill` for the one call to action in a group. The Account page's protection row is a plain cell like its identity row; its plan tiles are filled cubes whose tone carries the emphasis (the recommended plan is the filled one, with inverted content) and whose actions are white pills; the credits' amount picker keeps its raised white segment on the module track. The Personalization page's voice picker is a stack of filled options whose selected option is the black one, with no radio ring, and its fields sit on the module surface with no edge. The Voice page is one filled card per recognizer, carrying the recognizer's own name at the group-title scale.

`MfaForm` keeps one flow and two presentations. `layout: 'cells'` (settings) draws no chrome of its own — the host row already names the feature and carries its state — states the step left-aligned, and keeps the enrolment code beside the fields. `layout: 'card'` (default) is what the signup, sign-in and naming screens show. The stylesheet no longer carries fallback hexes: it uses the aliases this theme defines, so the two presentations paint the same tokens.

The sign-in challenge is no longer `MfaForm`. `Authenticate.tsx` renders it as its own step beside the emailed-code step, from the same sheet, title scale, code field, info line and button rows, and the same popup for a refused code. The six boxes are `Input`'s `inputNumbers` branch, whose first box the step's label points at. The challenge reports one failure in place of its instruction line: a code the server accepted is spent, so a profile load that fails afterwards is retried by the same button and never answered with a second challenge. `MfaForm` therefore lost its `login` mode and the challenge-only keys of its copy union.

The settings row separators are gone across the settings surfaces — the General, Appearance, Memory, Language, Permissions, Skills, Search-engine and Integrations rows separate by rhythm alone. Tab underlines, field edges and focus rings stay: they are controls, not dividers.

## Consequences

The Account page reads as one page rather than a cell list with two cards dropped into it, and the enrolment step continues the page instead of opening a surface inside a surface. The recommended plan is unmistakable without a stroke, and the sign-in challenge is now indistinguishable in shape from the emailed-code step, so the second factor costs the reader no re-learning.

What it cost: the plan grid can no longer mark the current plan with a ring, so it marks it by tone and by the disabled "Current plan" action alone; a reader comparing four price columns reads fills rather than outlines. The Account page's own hairlines are gone, so its groups rely on the 28px group spacing the section already used. Removing the challenge from `MfaForm` moved its coverage to the auth screen's mounted spec, which is where the profile-retry behaviour belongs; `MfaForm`'s remaining modes are covered through the Account section's spec.

## Alternatives considered

- **Keep the outlines and only restyle the form.** Rejected: the owner's direction is that the settings surfaces use the three tones, and the card-in-card composition was the visible complaint.
- **Give `MfaForm` a third `layout` that mimics the auth screen's markup with its own CSS.** Rejected: "look exactly like the emailed-code step" is only true if both steps are drawn from the same sheet and controls; a copy of that geometry in a second stylesheet drifts the moment either side moves.
- **Have the settings section render its own enrolment UI next to `MfaForm`'s logic.** Rejected: the challenge logic is subtle (spent codes, refusal mapping, recovery-code disclosure) and a second implementation would need the same tests.
- **Drop the hairlines everywhere, including menus and tab underlines.** Rejected: a tab underline marks which tab is open and a menu divider groups entries; neither is a row separator.

## Related

- [Locale-owned client UI copy](2026-08-23-locale-owned-client-ui-copy.md)
