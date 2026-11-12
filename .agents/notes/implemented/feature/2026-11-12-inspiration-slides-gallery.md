# Agent Note: Inspiration Slides Gallery and the Built-in Slides Skill

Status: implemented

English | [中文](2026-11-12-inspiration-slides-gallery.zh.md)

## Problem

Users asked Aeven for presentations and got improvised decks: the agent searched the web for templates, built PowerPoint files with python-pptx, and round-tripped them through Keynote, which made PowerPoint on Windows ask to repair them. There was no place to choose a design, no repeatable look, and nothing that worked the same on desktop and hosted sessions.

## Decision

The Imagine start address became Inspiration. `/inspiration` is Image & video, and each category pill is its own start address beneath it (`/inspiration/slides`, `/inspiration/letters`, `/inspiration/websites`, `/inspiration/apps`) with its own composer placeholder; the pill strip uses the Bots page's switcher style with 8px between pills on both pages.

The Slides category shows one card per presentation template: the template's cover slide on the image card, as tall as an image card on the four-to-a-row grid. A card opens a popup on the image prompt popup's shell: the slide on show, a strip of all twenty slides, a description, an optional picker for the reader's existing presentation, PDF or document, and `Use template`, which attaches that material and writes a request for a deck in that template into the composer. Attaching documents from a slot component needed `addFiles` on the public input actions, beside `addImageFiles`, backed by the same upload intake as the composer's file attach.

The templates and their generator live in a separate templates repository (`templates/slides`) and are published into the `aeven` preset as the built-in `slides` skill, so every desktop and hosted session has it without an install. A deck is JSON content in fixed slide kinds (cover, agenda, metrics, timeline, chart, custom HTML and the rest); a design system draws every kind, so any deck renders in any of the 36 templates and keeps that template's design. The renderer writes self-contained HTML with embedded Google Fonts; one bundled exporter turns it into PDF, a PPTX of slide pictures under native editable text boxes with speaker notes, and Keynote, using an installed Chrome-family browser, the hosted sandbox's Playwright Chromium, or Chrome Headless Shell downloaded once. The skill tells the agent to run a short wizard: one round of `ask_user_question` questions, an outline to confirm, the build, an overflow check, and refinement. The gallery pictures (`apps/web/public/slide-templates/`) come from the same repository's `gallery.mjs`.

## Alternatives considered

**Keep python-pptx and shape-by-shape PPTX code.** It needed Python on every machine and a second copy of every layout; exporting from the rendered HTML covers any layout once.

**Ship the skill through the skill catalog.** Catalog skills reach a session only after the user installs them, which a one-click `Use template` cannot rely on.

**Run the exporter as a Host tool.** It would avoid Chrome inside the sandbox, but needs a new capability seam; the sandboxed exporter works on desktop and uses the browser the hosted image already carries.

## Consequences

Slides depends on two repositories: template changes are made in `templates/slides` and reach Aeven through `scripts/publish.mjs` and `scripts/gallery.mjs`, which together add about 20 MB (the shipped skill with its fonts, and 36 gallery picture sets). Exports run in the session's sandbox, so a machine without a Chrome-family browser downloads Chrome Headless Shell once, about 100 MB; hosted sessions use the Chromium their sandbox image already carries. PPTX slides are pictures with editable text on top, so layout changes go through the deck JSON rather than PowerPoint. `Use template` writes plain text into the composer, so the skill, not the page, decides the workflow.

## Verification

The Inspiration page, deep links, popup, file attach and all 36 cards were checked in the running desktop app, and a real session went from `Use template` through the question round, the outline and the build to a PDF and PPTX inside the workspace sandbox. Every template's sample deck exports with the overflow check reporting nothing; PPTX output was compared with the PDF through LibreOffice and Keynote.
