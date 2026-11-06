# Agent Note: Motion rendering inside the hosted jail

Status: implemented

English | [中文](2026-11-06-hosted-sandbox-motion.zh.md)

## Problem

On the desktop, `tool-motion` and `api-motion` render GSAP pages to video in a Chromium the Host starts. Hosted keeps both off, because that renderer runs on the Host with network access and writes outside any account folder, so hosted conversations could not produce animations or videos.

## Decision

Hosted renders motion inside the [jail](2026-11-06-hosted-sandbox-jail.md) as an ordinary command. [`host/install-motion.sh`](../../../../packages/sandbox/sandbox-jail/host/install-motion.sh) adds a headless Chromium (`playwright-core`), GSAP, and open-licensed fonts (Google Fonts families under the SIL Open Font License, among them Google Sans Flex, plus Noto for every script, CJK, and colour emoji) to the read-only image, and installs `render-motion`. `render-motion page.html film.mp4` pauses the page's GSAP global timeline, or calls its `window.seek(seconds)`, seeks each frame, takes a screenshot, and pipes the frames into ffmpeg; films are limited to 120 s, 60 fps, and 1920 px per side. GSAP requested from a CDN is served from the installed copy and every other request fails, so pages written for the web still run without network. The hosted jail mounts `/var/cache/fontconfig` read-only so Chromium does not rescan fonts, sets `PLAYWRIGHT_BROWSERS_PATH`, and the model note tells the model how to make a film and share it through `output_files`; `avn-tool-bash` shares `.mp4`, `.webm`, `.mov`, `.mp3`, and `.wav` files with their media types.

## Alternatives considered

Enabling `tool-motion` on hosted with its renderer confined was rejected for now: its renderer, preview server, and storage assume the Host's own folders, and confining them is a larger change than reusing the jail. Fetching fonts at render time was rejected because the jail has no network.

## Consequences

The jail's account limits bound a render: 2 CPUs, 2 GiB of memory, 256 processes, and 512 MiB of `/tmp`. A shared film appears as a file in the conversation and plays when opened, not inline in the tool card. `tool-motion`'s editor and preview stay desktop-only.

## Verification

On the hosted machine, `install-motion.sh` completed in 36 s and installed 505 font faces. `render-motion` turned a page that loads GSAP from jsDelivr and a Google Fonts stylesheet into a 3 s, 1280×720, 30 fps MP4 in 4.5 s, with Google Sans Flex, CJK text, and emoji drawn from installed fonts.
