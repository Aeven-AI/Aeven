/**
 * The `motion` skill: how to settle a film's look and layout, the HyperFrames composition rules, motion craft, and
 * the author, review, show loop around `review_motion` and `show_motion`.
 * @module
 */
import type { SkillRegistration } from '@aeven/skill'

const CONTENT = `# Motion

You make films the way a motion designer does: an editable HTML composition you check with \`review_motion\`, which the user watches live with \`show_motion\` and exports to MP4 themselves. Nothing here is generated video footage; every pixel is drawn by the composition, so text, data, logos, and the user's own images move exactly as written.

## Plan before building

- Pin the brief in one or two lines: audience, where it plays, length, aspect ratio, and the one idea the film must land. Ask only when a choice changes the whole film; otherwise choose and say what you chose.
- Default canvas: 1920×1080 at 30 fps. Vertical social: 1080×1920. Square: 1080×1080.
- Write a beat list with seconds: hook (0–2 s), development, payoff, and a held end frame (at least 2 s). Short films are 6–20 s; explainers 30–90 s.
- One visual idea carries across scenes (a shape, a color, a line that keeps transforming). Continuity reads as design; unrelated scenes read as slides.

## Settle the look first

Decide these before the first scene and write them once, as CSS custom properties in a \`<style>\` in \`index.html\`'s \`<head>\`; every scene reads them with \`var(--name)\` and declares no sizes, colors, or margins of its own.

- Source of the look, in this order: the user's brand or files, a reference they named, else the subject's own world (its materials, era, signage, light). A look that fits any subject fits none.
- Type: one display family and one text family, chosen for this subject. Any Google Fonts family works by its exact name; so does a file in \`assets/fonts/\` with an \`@font-face\` rule. Do not reach for the same family every film.
- Scale: three sizes and no others. Display 7–14% of the frame's height, text 4–5%, label 2.8–3.2%. Nothing smaller than 2.8% (30 px at 1080p): a phone cannot show it, and \`review_motion\` reports it.
- Color: a ground, an ink, and one accent. Text sits at full or near-full opacity; make a line quieter with size or weight, not by fading it below 60%.
- Grid: one outer margin (5–8% of the width) and one baseline unit for vertical gaps. Every block's edge is the margin or a column line.

## Layout before animation

Build each scene's finished frame as static HTML and CSS first, review it, and only then animate toward it.

- A scene's content sits in one container that fills the frame with the margin as padding and lays its blocks out with flex or grid and \`gap\`. Do not position text blocks one by one with \`left\`, \`top\`, or \`bottom\` in pixels: hand-set offsets drift by a few pixels from block to block, and the eye sees it.
- Blocks that belong together share an edge exactly: the same left edge, or the same baseline. Opposite corners of the frame align to the same margin.
- At most one all-caps label per scene, with letter-spacing of 0.04–0.12em. Wide-tracked small caps in every corner read as decoration, not information; drop a label that carries no fact.
- Headlines: line-height 1.05–1.15. Let long text wrap inside a \`max-width\` instead of forcing breaks.
- A reveal mask (a wrapper with \`overflow: hidden\` that a line rises through) needs room for the glyphs: \`padding: 0.15em 0.05em\` with \`margin: -0.15em -0.05em\` on the mask, or descenders and commas are cut off.
- Text over a photo needs a calm area behind it: a gradient scrim, a darker crop, or a solid panel.

## Project layout

Create one folder per film in the working directory, such as \`motion/<film-name>/\`:

- \`index.html\`: the root composition. It mounts one scene per file from \`compositions/\`.
- \`compositions/<scene>.html\`: one scene each.
- \`assets/\`: images, fonts, and audio the film uses. Copy user-provided files here and reference them as \`assets/<file>\` (no leading slash).

## Composition rules

The renderer seeks a paused timeline frame by frame, so the film is a pure function of time.

1. Root: in \`index.html\`, a \`<div id="root" data-composition-id="main" data-start="0" data-duration="<seconds>" data-width="1920" data-height="1080">\`. The root's \`data-duration\` is the film's length.
2. Scene hosts inside the root: \`<div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="4" data-width="1920" data-height="1080"></div>\`. The host id, the scene root id, and the timeline key are the same string, or the render stalls.
3. A scene file wraps everything (styles, markup, script) in \`<template>\`. Its root is \`<div id="root" data-composition-id="intro" data-width="1920" data-height="1080">\` styled \`position: absolute; inset: 0\`.
4. Every timed element has \`class="clip"\`, a unique \`id\`, \`data-start\`, and \`data-duration\` in seconds, local to its file. It shows over [start, start + duration): land end states before the end.
5. \`index.html\` loads GSAP once in its \`<head>\`: \`<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>\`; scene files use that global \`gsap\` and load nothing themselves. Each composition builds one paused timeline and registers it after its tweens: \`window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); ...; window.__timelines["intro"] = tl;\`. The root registers its own (often empty) timeline under \`"main"\`.
6. Use \`tl.fromTo()\`, not \`from()\`. Never \`play()\`, \`add()\` a scene timeline to another, or use \`repeat: -1\`.
7. No \`Date.now()\`, unseeded \`Math.random()\`, timers, \`requestAnimationFrame\` clocks, or network fetches. Canvas and WebGL drawing reads the timeline's time.
8. Never tween \`display\`, \`visibility\`, or \`autoAlpha\` on a \`.clip\`; animate a child. Animate \`x\`, \`y\`, \`scale\`, \`rotation\`, and \`opacity\`, not \`left\`, \`top\`, \`width\`, or \`height\`, and give no CSS \`transform\` to an element GSAP transforms.
9. Prefix ids per scene (\`#intro-title\`) so they stay unique across the assembled page.
10. Media: \`<video>\` is \`muted playsinline\` unless it keeps its sound with \`data-has-audio="true"\`. Music and voice are separate \`<audio id="...">\` clips with \`data-start\` and \`data-volume\`. Never play, pause, or seek media from script.
11. Keep content inside the central 90% of the frame and key text inside 80%.

## Motion

- Motion has a reason: reveal, emphasize, connect, or transition. Never move everything at once.
- Ease by role: arrivals \`expo.out\` or \`power4.out\`, moves across the frame \`power2.inOut\`, exits \`power3.in\`. Linear only for constant drift, such as a slow push on a photo.
- A move takes 0.3–0.6 s. An exit is about half as long as the entrance it undoes.
- Overlap: the next element starts when the previous one is a third to half done. Stagger words by 0.06–0.12 s and list items by 0.04–0.08 s.
- Hold a line for 0.5 s plus 0.3 s per word after it lands, and the last line for at least 2 s.
- Vary how things arrive. One film uses three to five kinds of entrance and transition (a mask rise, a wipe, a scale from a detail, a cut on motion, a color fill); the same fade-and-slide-up on every element is what makes a film look generated.
- Overlap scene transitions by 0.2–0.5 s so the film never cuts to an empty frame, and let at most a third of the seams be hard cuts.
- Avoid: floating or breathing loops standing in for motion, bounce and elastic eases on text, and motion that continues after its line should be read.
- Numbers count up, charts draw on, and the final frame states the takeaway.

## Review, then show

Two tools, two audiences: \`review_motion\` renders the film and returns stills and measured problems to you alone; \`show_motion\` puts the film on the user's screen and replaces the one already there. Checking never goes through \`show_motion\`.

1. Review: \`review_motion\` with the folder. Spread stills through the whole film for a first pass (\`stills\`), through one scene's window when a scene changed (\`scene\` with the host id), or at exact moments (\`times\` in seconds) to check a transition, an overlap, or the last frame. Pass \`region\` as \`[x, y, width, height]\` to see a corner, a label, or a headline's edge at full size; a whole-frame still is half size and hides small faults. Never edit \`index.html\` or build a separate folder just to look at part of the film.
2. Read the measured problems first. Each names the element, the film time, and the fix: text clipped by its box or mask, text overlapping or off the frame, type under the size floor, faint text, a line on screen too briefly, a font that did not load. Fix every error. Fix a warning or keep it on purpose; trust a measurement over your eye, since a clipped descender looks fine in a small still.
3. Then look at every still: alignment of edges and baselines, overlap, cropping, contrast against the picture, and whether each beat reads. Fix what you see and review again. Expect several rounds; a film you looked at once is unfinished.
4. Show: when a round of the user's requests is done, the measured list is empty or intended, and the latest stills look right, call \`show_motion\` once. Show only the film the user asked for, never a scratch composition, and never mid-edit: \`show_motion\` refuses a composition that cannot render, and a film far shorter than the one last shown unless you pass \`force\` for an intended cut.
5. Reply with what changed and offer one or two concrete revisions (timing, copy, color, pacing). The user's requests for changes edit the same files, so keep ids and structure readable.
6. The user exports the MP4 from the film's own menu. Call \`render_motion\` only when the user asks you for the video file.
`

/** Runtime registration for `ctx.skills`; invocable by the model and as `/motion`. */
export const MOTION_SKILL: SkillRegistration = {
  name: 'motion',
  description: 'Make an animated film (launch or promo video, explainer, animated chart, logo reveal, title card, kinetic type, social clip) as an editable HTML composition rendered to MP4. Use whenever someone asks for motion graphics, an animation, or a video built from text, data, shapes, or images.',
  source: 'runtime',
  content: CONTENT,
}
