# Agent Note: One Æven composition

Status: implemented

## Problem

The Web GUI asked people to pick an agent preset (Standard, PTC, Minimal, Creator) for each new session. The four are not comparable choices: they mix a persona, a tool set, a tool-calling strategy (PTC is one `agent-tool-presentation` row), a benchmark configuration (Minimal), and self-modification (Creator is Standard plus `tool-cordis` and two authoring skills). A person should state what they want, and Æven should decide how to compose itself; the one preset that can extend Æven is also the one its own developers use every day.

## Decision

- **One default composition.** The shipped `aeven` preset is Creator's full assembly with an Æven persona: the everyday agent plus the Cordis toolset, so Æven builds a missing capability instead of asking for a mode switch. The Web bundle's `agent-presets.default` is `aeven`. The composition-authoring skills moved from `cordis/skills` to `aeven/skills`, and `cordis` reads them from its sibling.
- **Presets are developer surfaces.** `ui-settings-general` owns Developer mode (`ui-developer.enabled`, off by default) and its General row. `ui-agent-preset` mounts its chip, header label, and Settings section as one child plugin only while Developer mode is on, so turning it off disposes all of them. Normal sessions get no picker.
- **Legacy presets stay installed.** Sessions record their preset id, and resuming a session whose preset is gone fails. `standard`, `ptc`, `minimal`, and `cordis` therefore remain shipped and are offered only in Developer mode.

## Consequences

- Every new session in the Web GUI runs `aeven`; a user-level `agent-presets.default` still outranks it.
- `cordis_run` keeps its own approval for unauthorized browser packages, so being able to extend itself does not grant Æven new permissions.

## Next

1. Tool-calling strategy as a validated config field on `agent-tool-presentation` in `aeven` (`native` | `ptc`), fixed at session creation and recorded in the session log; `auto` only with evaluation evidence.
2. Self-extension as a capability: `tool-cordis` ships the authoring skills and the self-extension guidance, and a working dynamic plugin needs a durable home, since `cordis_define` definitions live only in memory.
3. A Customize section for persona and custom instructions, recorded per session, replacing per-preset personas.
4. Rename presets to compositions in code, keeping the persisted `agentPreset` field, and retire legacy presets once losing their sessions is acceptable.
