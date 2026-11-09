# Agent Note: Motion films are reviewed apart from being shown

Status: implemented

English | [中文](2026-11-09-motion-review-apart-from-show.zh.md)

## Problem

`show_motion` was both how the user saw a film and the only way the model could look at one: stills came back only from a `show_motion` call, evenly spaced through the whole film. In a 35-minute session the model called it twelve times, mostly to check its own edits, built a separate `_review` composition and even trimmed the real film's `index.html` to look at two scenes, and each of those reached the user. The card made it worse: a running call claimed its folder at once, so the film on screen vanished for the whole render and gave way to a loading row, and earlier films left no trace to compare against.

## Decision

- **Review is its own tool.** `review_motion` ([`avn-tool-motion`](../../../../packages/motion/tool-motion/README.md)) renders a draft and returns stills to the model alone, at given film times, spread through one scene's window, or spread through the whole film. `show_motion` renders nothing and only presents the folder. `ctx.motion` takes explicit still times (`stillTimes`) instead of an evenly spaced count, in [`avn-motion-hyperframes`](../../../../packages/motion/motion-hyperframes/README.md) and in the jail's `render-motion` (`--still-times`).
- **No half-built film is shown.** Both tools first read `index.html` statically and refuse a composition with no root length, a missing scene file, or a scene running past the film. `show_motion` also refuses a film shorter than `shrinkRatio` (default 0.5) of the length last shown from the same folder in the session unless the call passes `force`.
- **The film on screen stays until its replacement is ready.** A `show_motion` card that ran while on screen claims its folder only once its own film is ready; a call that fails never replaces the film. A card that mounts already settled claims at once, as before. While a replacement renders, its row reads "Updating the film…".
- **Earlier versions stay findable.** A replaced card folds into one "Earlier version · time · length" line that opens the film as that call stored it.
- **The skill teaches review, then show.** The `motion` skill checks every round with `review_motion` and calls `show_motion` once per finished round, never for a scratch composition.

## Alternatives considered

**A `present: false` flag on `show_motion`** was rejected: one tool name with two audiences invites the same misuse, and a review's arguments (times, scene) mean nothing to presentation. **Rendering only a scene's own time range** would make scene reviews cheaper but needs a renderer change; spreading stills through the scene's window over a full draft render keeps the renderer contract unchanged. **A contact sheet image** was deferred: up to 12 separate stills at chosen times already reach any moment. **Comparing against the previous length from the session log** instead of the tool's own memory was rejected as heavier for the same guard; after a Host restart the first re-show is unguarded.

## Consequences

A review still renders the whole film at draft quality, so it takes about as long as the film plays. The shrink guard lives in the tool's process memory, so it resets with the Host. Hosted Hosts must reinstall the jail's `render-motion` (`install-motion.sh`) for `--still-times`. A conversation replayed from history shows each replaced film as one line rather than nothing.
