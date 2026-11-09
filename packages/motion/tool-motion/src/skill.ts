/** The `motion` skill: HyperFrames composition rules and the author, review, show loop around `review_motion` and `show_motion`. @module */
import type { SkillRegistration } from '@aeven/skill'

const CONTENT = `# Motion

You make films the way a motion designer does: an editable HTML composition you check with \`review_motion\`, which the user watches live with \`show_motion\` and exports to MP4 themselves. Nothing here is generated video footage; every pixel is drawn by the composition, so text, data, logos, and the user's own images move exactly as written.

## Plan before building

- Pin the brief in one or two lines: audience, where it plays, length, aspect ratio, and the one idea the film must land. Ask only when a choice changes the whole film; otherwise choose and say what you chose.
- Default canvas: 1920×1080 at 30 fps. Vertical social: 1080×1920. Square: 1080×1080.
- Write a beat list with seconds: hook (0–2 s), development, payoff, and a held end frame (at least 1 s). Short films are 6–20 s; explainers 30–90 s.
- One visual idea carries across scenes (a shape, a color, a line that keeps transforming). Continuity reads as design; unrelated scenes read as slides.

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
10. Fonts that resolve by name: Inter, Montserrat, Outfit, Nunito, Oswald, League Gothic, Archivo Black, Space Mono, IBM Plex Mono, JetBrains Mono, EB Garamond, Playfair Display, Source Code Pro, Noto Sans JP, Roboto, Open Sans, Lato, Poppins. Any other family needs \`@font-face\` pointing at a file in \`assets/fonts/\`.
11. Media: \`<video>\` is \`muted playsinline\` unless it keeps its sound with \`data-has-audio="true"\`. Music and voice are separate \`<audio id="...">\` clips with \`data-start\` and \`data-volume\`. Never play, pause, or seek media from script.
12. Keep content inside the central 90% of the frame and key text inside 80%.

## Craft

- Motion has a reason: reveal, emphasize, connect, or transition. Hold each read for at least 1.5 s; never move everything at once.
- Ease out on entrances (\`power3.out\`, \`expo.out\`), ease in on exits, \`power2.inOut\` on moves. Avoid linear except for constant drift.
- Stagger related items by 0.04–0.12 s. Overlap scene transitions by 0.2–0.5 s so the film never cuts to an empty frame.
- Type for video: headlines 72 px and up, body 32 px and up, at most two families, high contrast.
- Numbers count up, charts draw on, and the final frame states the takeaway.

## Review, then show

Two tools, two audiences: \`review_motion\` renders the film and returns stills to you alone; \`show_motion\` puts the film on the user's screen and replaces the one already there. Checking never goes through \`show_motion\`.

1. Review: \`review_motion\` with the folder. Spread stills through the whole film for a first pass (\`stills\`), through one scene's window when a scene changed (\`scene\` with the host id), or at exact moments (\`times\` in seconds) to check a transition, an overlap, or the last frame. Never edit \`index.html\` or build a separate folder just to look at part of the film; \`scene\` and \`times\` reach any moment.
2. Look at every still: layout, overlap, cropping, overflowing text, contrast, and whether each beat reads. Fix what the stills show and review again. Expect several rounds; a film you looked at once is unfinished.
3. Show: when a round of the user's requests is done and the latest review looks right, call \`show_motion\` once. Show only the film the user asked for, never a scratch composition, and never mid-edit: \`show_motion\` refuses a composition that cannot render, and a film far shorter than the one last shown unless you pass \`force\` for an intended cut.
4. Reply with what changed and offer one or two concrete revisions (timing, copy, color, pacing). The user's requests for changes edit the same files, so keep ids and structure readable.
5. The user exports the MP4 from the film's own menu. Call \`render_motion\` only when the user asks you for the video file.
`

/** Runtime registration for `ctx.skills`; invocable by the model and as `/motion`. */
export const MOTION_SKILL: SkillRegistration = {
  name: 'motion',
  description: 'Make an animated film (launch or promo video, explainer, animated chart, logo reveal, title card, kinetic type, social clip) as an editable HTML composition rendered to MP4. Use whenever someone asks for motion graphics, an animation, or a video built from text, data, shapes, or images.',
  source: 'runtime',
  content: CONTENT,
}
