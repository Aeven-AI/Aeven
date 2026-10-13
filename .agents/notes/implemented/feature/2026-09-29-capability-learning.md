# Agent Note: Capability learning

Status: implemented

## Problem

An agent that works out a multi-step procedure, often after errors or a correction, loses it when the session ends. Hermes shows that a plain written procedure (`SKILL.md` plus supporting files, created by the agent) already makes an agent better for its user over time. Two risks come with copying it directly: a skill body is loaded as trusted instructions, so a procedure the agent wrote from tool output becomes a persistent prompt-injection path; and a learning system can become so careful that nothing useful is kept.

## Decision

Three rules govern capability learning:

- **Complex learning, simple capability.** The executable artifact is an agentskills-compatible directory: `SKILL.md` with the procedure and optional supporting files. Status, revision, source, and provenance live beside it in `capability.json` and never reach the model.
- **Remember immediately, trust gradually.** Anything the agent learns is durable at once as a `candidate`. It becomes `learned`, and so executable, only when the user confirms it. Evidence decides how far a capability is trusted (the next roadmap step), never whether it is remembered.
- **Execution never depends on memory.** Capabilities live in an Aeven-owned registry (`ctx.capabilities`, local files under `$AVN_HOME/capabilities/<owner>/`). The memory provider may help find them; running one needs only the registry and the skill catalog.

`@aeven/capability` stores capabilities per signed-in owner and publishes each owner's learned capabilities as the `learned-capabilities` skill provider. `SkillLookupOptions` gained `owner`, set by the skill tool, the model-facing catalog, and the Web skill catalog, and it is part of the registry's catalog cache key.

`@aeven/tool-capability` gives the model `capability_manage`. `learn` saves a candidate and then asks the user through `ctx.userQuestions`; the tool asks, so the model cannot skip the confirmation. `ctx.approval` is not used because its `never` policy, the full-access preset, rejects every request instead of allowing it. Changing or deleting a learned capability also asks. A short system-prompt section, shown only in sessions with an owner, says when to learn: on request, or after a recurring procedure was worked out through errors, dead ends, or a correction. Unconfirmed drafts that match a request are recalled once per session as a labelled `<capability_drafts>` block.

## Consequences

- A browser check taught `check-node-toolchain` in one session with one confirmation; a new session found it in the skill catalog, loaded it with the `skill` tool, and followed it.
- A capability confirmed by the user is trusted instructions for every later session of that user. Execution records, validation, and degradation follow in the capability lifecycle step.
- Automatic proposals from recorded evidence are not generated yet; the model proposes from the learning guidance.
