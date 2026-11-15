# Agent Note: A Guided Resume Flow

Status: implemented

English | [中文](2026-11-15-cv-guided-flow.zh.md)

## Problem

A live run of the Resumes flow (Black template, an attached CV, no photo) took about five minutes and read as the agent exploring Aeven rather than guiding the user. It asked one question and skipped the outline. When the first export left one education entry alone on page 4, the exporter said nothing, because four pages was within its limit; the agent then read the renderer and the template's `layouts.mjs`, wrote its own Chrome measuring script, tried to change a file in `node_modules`, and measured block heights until a variant fit. The draft from the Resumes page promised "the attached photo" when only a CV was attached, the skill rings showed invented percentages (92, 78) for the CV's "expert" and "advanced", Black without a photo left the right half of its About band empty, and a template started from Inspiration ran in whichever Workspace was selected, so a deck once landed in the aeven checkout and was committed by mistake.

## Decision

The exporter prints a page report after pagination (`templates/cv/scripts/layout-report.mjs`): each page's sections, read from the rendered page and matched against the CV's section titles so it works with every design system's markup, and how full the page is; then either `layout ok` or warnings that name the `cv.json` change. A last page under 35% full gets the number of lines to free and the moves in order: a timeline section on that page as `"kind": "list"`, shorter texts, the oldest entry. The exporter also writes a small picture of every page to a fresh temp directory and prints the paths, so the agent looks at the pages without `pdftoppm` or files in the CV folder.

The `cv` skill reads as a fixed path the agent walks the user through, with a one-line status per step: one round of questions (photo when the template shows one, length, role, language), an outline confirmed every time, also for an attached CV, the build, the report's first content-keeping change, a look at the previews, and a hand-over that lists the files by full path and closes on a "What next?" question. It tells the agent not to read the scripts or layouts, measure pages, or write helper scripts, and to ask the user when the output leaves it unsure. Skill levels use the person's number or a fixed word table (expert 90, advanced 75, intermediate 60, basic 40); a skill with neither goes into a tags list.

The Resumes popup writes one of three requests by what was attached: resume and photo, resume only, or photo only. Black and White without a photo give About's copy the band's full width at its own height. A start-address claim can set `builtInWorkspace`, and every Inspiration address does, so its blank Session opens in the built-in Workspace instead of the current Session's.

## Alternatives considered

**Fit pages automatically in the renderer.** Switching sections to lists or trimming text on its own would decide content for the person; the report names the change and the agent makes it in `cv.json`, where the user sees it in the hand-over.

**Per-template block attributes for the report.** Black, White, Slate and Fresh write their own markup; reading each block's first line and matching section titles from `cv-data` covers all forty templates without touching their layouts.

**Start every start address in the built-in Workspace.** Automations also claims start addresses, and its pages may belong to a project; the claim makes the choice per page.

## Consequences

The report's line count is an estimate from the page's body line height and the space left on the page before; an entry's own padding can make the real need smaller. Section names in the report come from the rendered text, so a template that prints a heading differently from its `cv.json` title shows the printed form. The skill and exporter change in `templates/cv` and reach Aeven through `scripts/publish.mjs`, as before.

## Verification

The live run repeated after the change took 2 minutes 8 seconds: one question round, the outline with the skill-level mapping disclosed, one `cv.json` edit taken from the report, previews read from the temp directory, and no reads of the skill's internals. On a reproduction of the four-page case the report named Education → list first, and that change alone gave three pages and `layout ok`; eight sample templates (cover, sidebar, card and one-page designs) report without errors. With a blank Session selected in a project Workspace, opening Inspiration opened a blank Session in Chats. `tsc` passes for `ui-imagine`, `ui-workspace` and `ui-automations`, and `build:client` is green.
