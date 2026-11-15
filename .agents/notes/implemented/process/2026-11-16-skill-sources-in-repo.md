# Agent Note: The CV and Slides Skill Sources Live in the Repository

Status: implemented

English | [中文](2026-11-16-skill-sources-in-repo.zh.md)

## Problem

The `cv` and `slides` skills Aeven ships were edited in a folder outside the repository, `~/Projects/Nodejs/Aeven/templates`, which had no commits, and reached the repository only as the bundled copy `scripts/publish.mjs` wrote into `packages/preset/agent-presets/presets/aeven/skills/`. The source had no history or review, and the shipped copy drifted from it whenever someone forgot to publish.

## Decision

The sources live in `skills-src/cv` and `skills-src/slides` at the repository root: `SKILL.md`, the render and export scripts, the design systems, the sample photos, and the fonts as WOFF2 files with their manifests. They stay outside the pnpm workspace, each with its own `package.json` and lockfile (`pnpm install --ignore-workspace`), so their tooling (puppeteer-core, esbuild, docx, pptxgenjs) does not join the harness packages and their gates. `node scripts/publish.mjs` publishes into the checkout it sits in when given no path. TTF files, build output (`dist/`, `out/`), and Figma rips stay out of git; the exporters download a template's TTF files from Google Fonts when they need them.

## Alternatives considered

**A separate repository.** It keeps the source out of the harness checkout, but every skill change then spans two repositories and two reviews, and the shipped copy still drifts.

**Workspace packages under `packages/`.** The harness package rules (`@aeven/*` naming with Cordis peers, publint, exports, constraints) fit plugins, not a design-tool folder whose output is a published skill.

## Consequences

A skill change is edited in `skills-src/`, published with `node scripts/publish.mjs`, and lands with its published copy in one PR. The first export of a template on a machine downloads its TTF files once. The old `templates/` folder outside the repository is no longer the source.

## Verification

Publishing both skills from `skills-src/` reproduced the published copies in the repository, so nothing the build needs is missing. `pnpm run hygiene` and `verify-translation-pairing` pass.
