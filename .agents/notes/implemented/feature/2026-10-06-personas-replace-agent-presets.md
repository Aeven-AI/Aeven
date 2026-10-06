# Agent Note: One Aeven composition, an adaptive persona, and per-account personalization

Status: implemented

## Problem

The Web GUI offered five agent presets (`aeven`, `standard`, `ptc`, `minimal`, `cordis`) behind Developer mode, a hero chip, a header label and a Settings section. Even the developer of Aeven found the choice hard to explain, and it is meaningless to a person who is not a developer. The presets also mixed two different things: what a session can do (tools) and how it talks.

How Aeven talked was not designed anywhere. Every Web session opened with "You are an AI agent powered by Aeven", the Web bundle set a "You are a coding agent" persona, and every person saw developer-only text: the harness checkout path and the GUI rebuild rules. The rest of the prompt was tool policy. In practice the voice was an accountant's in every situation, including personal ones, and it switched to report form (bold labels, memory trace ids, database names) whenever facts came up.

## Decision

- **One composition.** The Web composition runs every session on the shipped `aeven` composition with the harness-home user root off. The `standard`, `ptc`, `minimal` and `cordis` presets and `@aeven/client-ui-agent-preset` are deleted. Changing what a session can do means editing `presets/aeven/agent.cordis.yml`. PTC mode (`tool-presentation`) and the Cordis self-extension toolset (`tool-cordis`) remain as rows in that file that ship disabled.
- **Identity.** The persona opens with "You are Aeven". The Web bundle turns off `includeHarnessIdentity` and drops its deployment persona. The model name is stated only as the answer to "which model are you".
- **Developer orientation is config.** `@aeven/web-app` gains `developerContext` (default `false`), which gates the `harness:source` section and the GUI rebuild and replacement-server rules. The Markdown rendering rules stay for everyone.
- **An adaptive persona, not a picker.** The persona matches the person first: their tone, energy and language outrank the subject. It uses the precise work register only while the person is actually working with it. Personal matters get a really warm, friendly register in plain paragraphs, and coaching an encouraging one. Machinery stays out of sight (no memory ids, files, databases or tool names unless asked). Workspace instruction files govern the work, not how Aeven talks. The visual-work loop moved out of the persona into the shipped `visual-work` skill.
- **Per-account personalization.** `@aeven/personalization` stores a voice (`automatic`, `warm`, `direct`, `playful`) and free-text notes per signed-in account, and renders them as the `user:personalization` system-prompt section right after the persona. It is model-visible through the system prompt, so every `request/header` records it. Settings → Personalization (`@aeven/client-ui-settings-personalization`) edits it.
- **The name has one home.** "How should Aeven call you?" is the Aeven account display name that the sign-up naming step (`ui-auth-aeven` `NameCheck`) sets through `/set-display-name`. The published reader gains `setDisplayName`, which stores the name and restates the reader, so the Settings field, the account menu, the greeting and the `<user_profile>` block of the next message all follow one value.
- **Memory recall stays natural.** The memory guidance tells the model to use recalled facts naturally and never to quote their ids or storage unless asked.

## Rejected

- **A persona picker per conversation** (a composer seat and hero chip, as `agent-presets` had). People who are not developers do not pick personas; the persona reads the moment, and Settings holds the few standing preferences a person has.
- **User-editable persona prompt text with `{{model}}` and `{{cwd}}` templating.** This asks people to write prompts. Plain-language voices with example replies and free-text notes cover the need.
- **Storing the name in the personalization document.** It would duplicate the account name and drift from it.

## Deferred

- The roster service, the `agentPreset` session header field and the SDK projections still exist for the single composition. Collapsing them into one composition path touches the session format, both SDKs, webhook, ACP and subagents, and belongs in its own change.
- Style requests made in conversation land in long-term memory, not in the personalization document.
