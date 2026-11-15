# Agent Note: The Pages and Keynote Conversion Runs Without Asking

Status: implemented

English | [中文](2026-11-16-pre-approved-conversion.zh.md)

## Problem

Every resume or deck made on the desktop stopped at a sandbox approval for its Pages or Keynote file, and a conversation driven from a phone waited until someone answered it. The conversion has to run outside the workspace sandbox: macOS refuses Apple Events from a process under `sandbox-exec` even with `(allow default)` and the font folder writable, which a run of the CV exporter under the desktop's profile confirmed (`sending Apple Events to Pages was refused`). Separately, hosted Aeven Web listed the `computer-use` skill once it received the preset's skills, although it composes no computer-use tools.

## Decision

`avn-tool-bash` gains `escalationSkillScripts`: a requested escalation runs without asking when the whole command is exactly `[cd <dir> && ] node <script> <arg> <arg> <final>`, every token plain or double-quoted without `$`, backquotes, or backslashes, the script resolving (by `realpath`) to the configured file in the resource directory of a skill whose source is `custom` or `bundled`, and the final argument allowed. The mode checks of `approveEscalation` still run; only the question is answered. `avn-web-app` lists the CV exporter with `pages` and the slides exporter with `key`, and both skills tell the model to run the exporter's printed command exactly. Any other escalation asks as before.

`avn-skill-filesystem` gains `excludeSkills`, names it never lists or loads, and `avn-hosted-app` excludes `computer-use`.

## Alternatives considered

**Widen the desktop sandbox.** Allowing Apple Events or the font folder for every confined command would let any command script any app.

**Match on the approval's reason text.** The reason carries the model's justification, not the command, so a model could reuse it for any escalation.

## Consequences

A project or user skill named `cv` or `slides`, which a command could write into the workspace, never qualifies, because its source is not `custom` or `bundled`. A command the model changes in any way, such as an added `sleep` or a different argument count, asks again. Pre-approved runs record no approval event; the tool call keeps its `sandbox_permissions` and justification in the log.

## Verification

A check of the matcher against the real skills folder accepted the CV and slides conversion commands, with and without `cd … &&`, and refused chained commands, `$()` and backquotes, an extra argument, a Node flag, an environment prefix, a newline, a look-alike script path, a relative path, and a project skill of the same name. `tsc` passes for `tool-bash` and `skill-filesystem`; `verify-cordis-config` passes.
