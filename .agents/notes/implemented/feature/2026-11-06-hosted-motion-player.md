# Agent Note: Motion films on hosted Web

Status: implemented

English | [中文](2026-11-06-hosted-motion-player.zh.md)

## Problem

Hosted Web mounted no motion renderer, so `show_motion` was never registered there and a hosted conversation never showed the Motion card. The model wrote pages with bash and rendered them with the jail's `render-motion` ([hosted motion](2026-11-06-hosted-sandbox-motion.md)); a render longer than the foreground threshold moved to a background job, whose files are never shared, so the user saw neither a player nor the MP4. The base `bash-edit-guard` also refused in-place rewrites and pointed the model at edit and write tools that hosted does not mount.

## Decision

Hosted mounts `ctx.motion` with [`avn-motion-sandbox`](../../../../packages/motion/motion-sandbox/README.md). Its `bundle()` copies the composition folder through `ctx.fs`, keeping files whose resolved target lies inside the folder, and returns HyperFrames' single-document bundle; `show_motion` stores that document with the call, and the card plays it from the attachment. Its `render()` pipes the same document into the jail's `render-motion` under the calling session's sandbox policy, which `MotionRenderRequest.sandboxPolicy` carries from `avn-tool-motion` and from `avn-api-motion`'s `POST /api/motion/export-call`. `render-motion` steps a HyperFrames composition through its runtime's own player (`__player.renderSeek`), so the MP4 and the review stills match the live film. The card exports through that call route where it has no folder to name; the route takes the folder from the caller's own log, answers 202 while a render runs past `exportWaitMs`, and returns the MP4 bytes. `avn-api-motion`'s `folderRoutes: false` keeps the routes that read any absolute Host path off, hosted turns `bash-edit-guard` off, and the model note sends films to the motion skill.

## Alternatives considered

Rendering on the Host with the HyperFrames renderer was rejected: it runs Chromium over a model-written page outside the account's jail. Writing the bundle into the account folder for the jail to read was rejected: a Host-side write could follow a symbolic link a command placed there, so the bundle travels on the command's stdin.

## Consequences

The sandbox image must carry the `render-motion` that reads stdin and answers JSON; `host/install-motion.sh` installs it. A render runs under the account's CPU and memory limits, about three times the film's length at 1080p30. Review films land in the composition's `renders/.review.mp4`, replaced by each review, because the renderer may write only inside the workspace.

## Verification

Bundling a composition through `fs-local`, `motion`, and the renderer inlined its scene and the runtime, left out a file reached through a symbolic link to another folder and an 80 MB file under `renders/`. `render-motion - out.mp4 --stills 3 --json` turned a desktop-made 6 s composition's bundle into a 1920×1080 H.264 MP4 of 6.00 s in 18 s, with stills at 1, 3, and 5 s showing the bars at their scripted heights.
