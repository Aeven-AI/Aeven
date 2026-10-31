# Agent Note: A user switch for subagent nesting

Status: implemented

English | [中文](2026-10-31-subagent-nesting-switch.zh.md)

## Problem

The shipped preset composed `maxDepth: 1` on both delegation tools, so children were leaves: a depth-1 child of the session agent could not start a subagent of its own. Recursion was therefore a deployment-only decision, changeable solely by editing `agent.cordis.yml` and restarting the Host, while every other delegation choice a user owns (model selection, background policy) already had a settings surface.

## Decision

`avn-tool-subagent` gains a `nestingSettings` flag that reads the Host-owned `subagent-nesting` user setting at every delegation start. The setting is one boolean, `enabled`, served by `@aeven/tool-subagent/nesting-settings` and edited on the Plugins settings page. Switched off, the tool pins each start to depth one, which is what makes a child a leaf; switched on, the composed `maxDepth` is the ceiling. The shipped preset composes `maxDepth: 2` with `nestingSettings: true` on the `subagent` and `subagent_fork` rows, so enabling the switch lets a depth-1 child start a depth-2 child, which is a leaf in turn.

The switch is read live rather than sampled per top-level Session. Model selection is sampled and recorded as `subagent/model-selection-policy` because it changes the model-visible tool schema, so a running Agent's definition must stay fixed and a resumed Session must rebuild the same schema. Nesting changes neither schema nor prompt text: it decides whether a start is admitted, which the transcript already records as the tool call and its result. Reading the live value therefore needs no session event, and a save applies to the agents already running and to the children they start afterwards. A child inherits its parent's preset, so its own delegation tool resolves the same Host singleton without carrying a copy through the log.

The capability itself stays where it already lived. The provider enforces the depth cap from `request.maxDepth`; the tool only decides which number to send. `nestingSettings` requires a numeric `maxDepth` and the settings service in the Host scope and fails at mount otherwise, because an out-of-process provider owns its own recursion budget and an uncomposed service would silently disable the switch.

## Alternatives considered

**Keep the depth ceiling in deployment configuration only, exposed through the preset.** Rejected because the request was a user-facing switch, and preset edits reach a user only through a Host restart.

**Sample the switch per top-level Session and inherit it like model selection.** Rejected as unused machinery: the setting changes no model-visible definition, so a recorded policy would duplicate a value the live read already answers, and a settings edit would keep applying to new Sessions only for no user-visible reason.

**Express "off" as `maxDepth: 0` on the calling agent.** Rejected because the cap is enforced against the child's resolved depth, not the parent's, so zero would forbid the top-level agent's own delegation instead of the child's.

**Let a switched-off deployment keep its composed ceiling and enforce nesting only in the prompt.** Rejected: prompts are not enforcement, and a configured cap the model is told to ignore is a lie the provider cannot back.

## Consequences

Nesting is now a user decision that also reaches the agents already running, so the depth a child may reach no longer depends on which Session started it. A deployment that wants fixed leaves sets the preset ceiling to one and drops `nestingSettings`, which reproduces the earlier composition exactly. The preset's `maxDepth: 2` is a ceiling the switch can only lower, so no existing child needs re-composition when it flips.

Because the switch is not logged, reconstructing what one start was allowed needs the deployment's settings document: the transcript records the start and its result, not the policy that admitted it. A switched-on deployment also spends real tokens on grandchildren — two delegation levels multiply the sessions one task fans out into, and each child owns its own context window — so the ceiling, not the switch, stays the bound on runaway recursion.
