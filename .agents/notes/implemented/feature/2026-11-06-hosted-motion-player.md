# Agent Note: The live motion player on hosted Web

Status: implemented

English | [中文](2026-11-06-hosted-motion-player.zh.md)

## Problem

Hosted Web mounted no motion renderer, so `show_motion` was never registered there and a hosted conversation never showed the Motion card. The model wrote pages with bash and rendered them with the jail's `render-motion` ([hosted motion](2026-11-06-hosted-sandbox-motion.md)); a render longer than the foreground threshold moved to a background job, whose files are never shared, so the user saw neither a player nor the MP4. The base `bash-edit-guard` also refused in-place rewrites and pointed the model at edit and write tools that hosted does not mount.

## Decision

Hosted mounts `ctx.motion` with [`avn-motion-preview`](../../../../packages/motion/motion-preview/README.md), a renderer that only bundles: it copies the composition folder through `ctx.fs`, keeping files whose resolved target lies inside the folder, and returns HyperFrames' single-document bundle. `show_motion` stores that document with the call, and the card plays it from the attachment, as it already did on the account's other devices. `avn-tool-motion` gains `render: false`, which drops stills and `render_motion` and teaches the show-only loop; `avn-api-motion` gains `folderRoutes: false`, because its folder routes read any absolute Host path. Hosted turns `bash-edit-guard` off, and the model note sends films to the motion skill and keeps `render-motion` for an MP4 the user asks for.

## Alternatives considered

Rendering stills and exports on the Host with the HyperFrames renderer was rejected: it runs Chromium over a model-written page outside the account's jail. Running HyperFrames renders inside the jail was deferred: `render-motion` drives a page's GSAP global timeline, while a composition needs the HyperFrames runtime's own seek, and `ctx.motion` receives no session to choose the account's jail.

## Consequences

Hosted films play and scrub live; the model reviews no stills, and the card's menu downloads the bundled page rather than an MP4. Bundling reads the account folder on the Host with the same resolve-then-read containment as the hosted read tools.

## Verification

Bundling a composition through `fs-local`, `motion`, and `motion-preview` inlined its scene and the runtime, left out a file reached through a symbolic link to another folder and an 80 MB file under `renders/`, and `render()` rejected.
