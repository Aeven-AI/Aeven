# Agent Note: The auth screens carry the website's mark

Status: implemented

English | [中文](2026-11-02-auth-screens-carry-the-mark.zh.md)

## Problem

`@aeven/client-ui-auth-aeven` ports the Aeven website's sign-in and sign-up screens verbatim, and the port kept the layout but left the black half of the split empty: on the website that half draws the Æven mark out of the dark, keeps a light inside it that answers the pointer, and lets that light walk on its own while the pointer rests. The ported screens showed a blank column where the two surfaces should look the same, and their password fields offered no way to read what had been typed.

## Decision

The mark and its motion move into the ported package as the website's own code, not an imitation of it:

- `MarkBackdrop` renders the website's layer tree — `.auth-corner`, `.auth-graphic` with the `.wide` and `.tight` glows, `.auth-mark`, and `.auth-torch` wrapping the light — inside `.graphics-container`, and starts the same GSAP timelines with the same values: the arrival (corner to `0.9` over 2.6 s; the graphic from `xPercent: -92` to `0` over 1.9 s at `0.12` with its fade at 1.7 s; the mark at 1.5 s from `0.55`; the tight glow to `0.62` and the wide to `0.4`), the handover at 2.8 s to the 17 s breathing scale of `1.014` around `62% 38%`, the pointer `quickTo` pair at `0.3`/`0.34` s on `power3`, the parked light at `(-0.24 w, -0.28 h)`, and the 8.5 s idle walk that starts 2600 ms after the pointer stops.
- `gsap` becomes a dependency of the package. The requirement was that both surfaces move identically, and the website's motion is a coupled timeline whose arrival hands over to a loop and whose pointer follow hands over to an idle walk; a hand-written equivalent drifts from the original on the first change.
- The stylesheet stays the vendored one. The new rules are appended to `src/vendor/aeven-auth.css` under the auth view's selector chain, so no rule reaches the header's own `.auth-mark`, and the file stays diffable against the website's `_Authenticate.scss`.
- `prefers-reduced-motion` shows the settled picture and starts nothing: the stylesheet carries the final opacities, and the component sets the same values instead of running the arrival.
- A password field gains a reveal control: Lucide's `eye` and `eye-off` paths in a `type="button"` button that flips the input between `password` and `text`, keeps focus in the field, and takes its label from the locale dictionary (`field.showPassword` / `field.hidePassword`, in all three dictionaries).

## Alternatives considered

- **Reimplementing the motion in CSS or the Web Animations API.** Neither expresses the handover the website's script owns — an arrival timeline that starts a loop, a follow that yields to an idle walk — without rebuilding the same scheduler, and the result is a second animation that has to be kept in step with the first.
- **Copying the website's compiled SCSS wholesale.** The website's rules are global, and the auth screens are not the only place this client draws `.auth-mark`: the screens' header carries one too, so every appended rule is scoped to the auth view's chain.
- **A reveal control on a shared input primitive.** No other consumer asks for it yet, and the primitive takes a fixed input `type`; the auth package's own `Input` component is where the toggle belongs until a second consumer exists.

## Consequences

The auth screens now depend on `gsap` at runtime, shipped in the client bundle that boots before the plugin graph. The timeline values are the website's numbers, so a change to the website's mark motion has to be mirrored here — the file says so at its head. The reveal control only appears for `type="password"`, and its copy is locale-owned like every other product-visible string in this package.
