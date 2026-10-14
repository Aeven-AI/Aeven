# Agent Note: The ledger is a developer surface

Status: implemented

English | [中文](2026-10-08-trajectory-behind-developer-mode.zh.md)

## Problem

Two client surfaces presented the trajectory ledger as everyday machinery. Every tool row carried a hover-revealed `Inspect` pill (generic rows, the bash sample, the skill row, and all three Cordis rows), and the Conversation View owner share carried a one-shot focus request (`viewRequest`/`openView`/`completeViewRequest`) whose only producer was that pill: it opened the ledger and scrolled the requested call into view. The pill was noise for anyone reading a transcript, and the ledger itself — request headers, raw tool schemas, token accounting per request — is a surface for people building Æven, not for the sessions they run.

## Decision

- **The ledger mounts only while Developer mode is on.** `ui-trajectory` binds the `ui-developer` settings section (`ui-settings-general`'s namespace; the package imports the type only) and mounts its View entry, its Conversation Definitions, and the Session `trajectory` hook as one child plugin, disposing all of them when the setting turns off. The View roster therefore never lists Trajectory in an ordinary session, and a stored `trajectory` View preference falls back to Chat through the existing `resolveActiveView` ladder.
- **The Inspect affordance is gone.** `ToolCallOwnerProps` no longer carries `inspect`, ui-chat no longer hands keyed Chat renderers an `inspectCall`, and the pill sites in `ui-tool` (generic row, bash row), `ui-skill`, and `ui-cordis` (define, run, stop/remove) render nothing where it was.
- **The cross-view focus request is gone with its producer.** `ConvViewOwnerProps` declares no owner values, the Conversation store keeps only the draft and the selected View, and the ledger no longer resolves an externally requested call. The channel returns when a real producer needs it.

## Alternatives considered

**Keep the `inspect`/`inspectCall` seam and delete only the buttons.** The callbacks would have had no caller in any shipped composition: a public pass-through kept alive for a hypothetical second consumer, which the package rules reject ("require a current owner and need"). The whole seam comes back cheaply if a producer appears.

**Hide the View entry while keeping the rest mounted.** A `visible`-style registration option would have left the Conversation Definitions, the ledger's Session hook, and its dictionaries live behind a hidden tab — more surface, not less, and no other View needs the option.

**A new `developerMode` client service in `ui-settings-general`.** A service is the sanctioned way to cross packages, but Developer mode is one boolean read by a plugin that must also work without a settings document; the settings-scope binding keeps the read local, and `ui-settings-general`'s README already documents this consumer pattern.

**Prompt the reader before disposing a ledger they are looking at.** Turning the setting off already switches the affected Session to Chat through the View-preference fallback, and Developer mode is a deliberate act by the person flipping it; a confirmation dialog would guard a state the person just chose to leave.

## Consequences

- The ledger is unreachable without Developer mode, so the trajectory e2e scenarios and the goldens that captured the View row or an `Inspect` pill must enable Developer mode in their harness (a `ui-developer:` section in the seeded `settings.yaml`) or be re-recorded.
- Reading a specific call from the transcript is no longer one click: the reader switches to the ledger and finds the record there. In exchange, every tool row lost a control that competed with its content, and four packages lost a prop that only ever forwarded a scroll target.
- `ui-trajectory` now depends on `@aeven/client-ui-settings-general` and `@aeven/client-ui-settings` for types, and injects `settingsScope`; a composition without a settings document mounts no ledger.
- The client slot catalog (`cordis_inspect what:"client"`) regenerated with the trimmed owner shares, so a dynamic Plugin author reads the current contracts.
- Removing the pill supersedes part of [web tool-row unified expand and trajectory Inspect](../feature/2026-07-30-web-tool-row-unified-expand-and-inspect.md): that note keeps the unified expand interaction and now points here for the deleted Inspect half.
