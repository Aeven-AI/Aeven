# Agent Note: Motion reviews measure the film

Status: implemented

English | [中文](2026-11-26-motion-reviews-measure-the-film.zh.md)

## Problem

A 10-second film about Amsterdam reached the user with the descender of "light." and the comma of "Brick," cut off, seven all-caps labels at 17 to 22 px, and text blocks whose edges differed by a few pixels. The model had reviewed it: `review_motion` returned stills 960 px wide, half the frame, where a clipped descender and a 19 px label look fine. The headline sat in a reveal mask with `overflow: hidden` whose box was 33 px shorter than its glyphs. The skill gave size floors only for "headlines" and "body", so labels had none, told the model that 18 font families resolve by name, and said nothing about settling a look, a grid, or a type scale before the first scene.

## Decision

- **A review measures the film.** `review_motion` passes audit times, every `auditStepSeconds` (default 0.25 s), with its render. `ctx.motion` returns findings: text clipped by its box or mask, overflowing, overlapping, occluded, or off the frame; type under 2.6% of the frame's short side; text held under 50% opacity; a line on screen for less than 0.5 s plus 0.3 s a word; a font family that rendered in a fallback face. The tool lists them as text before the stills. On the Amsterdam film it reports the two clipped headline lines and the fifteen undersized labels.
- **The page-side audit is HyperFrames' own.** `layout-audit.browser.js` is copied unmodified from the `hyperframes` CLI package into [`avn-motion`](../../../../packages/motion/motion/README.md)'s `audit/` folder; a driver of ours seeks the film and collects its measurements. The Node side of upstream's `check` command is not used: it imports about 150 bundled chunks of the CLI, which carries a second browser driver, a web server, and esbuild.
- **The service judges, the renderers measure.** A renderer returns the page's raw samples; `Motion.render()` turns them into findings under the service's `audit` thresholds. [`avn-motion-hyperframes`](../../../../packages/motion/motion-hyperframes/README.md) loads the bundle in a headless page of its own browser; [`avn-motion-sandbox`](../../../../packages/motion/motion-sandbox/README.md) adds the script to the document it pipes into `render-motion`, which gains `--audit-times`.
- **Persistence filters transients.** A layout problem is reported only when it holds for 0.5 s and for half the element's time on screen. Without that filter the Amsterdam film reports about seventy problems, nearly all of them letters still behind their mask during an entrance or two scenes overlapping during a crossfade.
- **Stills can show part of the frame.** `review_motion` takes `region`; a region narrower than the still width keeps its own pixels, so a label is seen at full size.
- **Fonts travel inside the bundle.** Both renderers and the replay route embed fonts as data URLs after bundling, with HyperFrames' `injectDeterministicFontFaces`. Any family Google Fonts serves resolves by name, on the hosted renderer too, whose sandbox has no network: the Host fetches the files. The skill no longer lists 18 families.
- **The skill teaches look and layout before animation.** It settles type, a three-size scale, color, and one margin as CSS custom properties in `index.html`; builds each scene's finished frame with flex or grid before animating; limits all-caps labels; gives the padding a reveal mask needs; and names easing by role, hold times, and the patterns that make a film look generated.
- **A film is one row in the Turn's file list.** `show_motion` declares the composition's `index.html`, with the stored film as its copy, in its result's `producedFiles`. The list then shows that row alone, where it used to list `index.html` and every scene file as edited files.
- **HyperFrames' core, engine, and producer move from 0.9.19 to 0.9.99.** The functions the renderers call are unchanged. The client's `@hyperframes/player` stays at 0.9.19: the 0.9.99 player imports HyperFrames' 800 KB runtime script lazily, a client bundle is one file, and a 0.9.19 player plays a 0.9.99 bundle, which carries its own runtime.

## Alternatives considered

**Depending on the `hyperframes` CLI and running `check --json`** was rejected: 24 MB unpacked with 18 direct dependencies, a subprocess per review, and no way to run inside the hosted sandbox, whose renderer is a separate script. **Writing our own layout audit** was rejected: upstream's is 3,500 lines that already handle masks, clip paths, gradients, and transforms. **Reporting every upstream code** was rejected: the box, video-matte, and connector codes fire on a photo scaled past the frame for a slow push, which every photo film does on purpose. **An automatic alignment check** was left out: authors align large display type optically, a few pixels left of the labels beneath it, and a check on DOM rectangles reports that as a fault. **Upstream's lint in the review** was left out: its font rule requires an `@font-face` for every family outside the bundled 18, which contradicts fetching by name.

## Consequences

A review launches a second headless page on the desktop renderer, which measured 1.3 s for 40 samples of a 10-second film. Hosted Hosts must reinstall the jail's `render-motion` (`install-motion.sh`) before the Host update: the older script rejects `--audit-times` and `--still-region`. The first bundle of a film that names a new Google Fonts family fetches it; later ones read HyperFrames' font cache. A bundle grows by its fonts, about 1 MB for the Amsterdam film's three families. Updating HyperFrames now includes copying the audit script at the same version, as `audit/README.md` describes.
