# Agent Note: DSH bug fixes from dsh-v0.2.1-rc.3 to dsh-v0.2.2-rc.3, adapted to Aeven

Status: implemented

English | [中文](2026-11-17-dsh-backports.zh.md)

## Problem

Aeven forked DeepSeek Harness (DSH) early. The DSH releases dsh-v0.2.1-rc.3 through dsh-v0.2.2-rc.3 fixed defects that Aeven's copies of the same packages still had: Anthropic requests rejected after compaction rewrote the prefix that signed thinking was bound to, a skill catalog that vanished when one skill root was unreadable, `~/` paths resolved against the session directory, tool calls rejected for empty or unused optional arguments, `web_fetch` failing on `charset=utf-8,gbk`, duplicate prompts admitted when a retry raced attachment preparation, a large project instruction chain pushing the user-global `AGENTS.md` out of the budget, history taken in by a switch to a smaller-window model, and `!` sequences breaking the persistent bash shell. Aeven has since diverged from DSH, most of all in account sync and multi-device input, so a fix carried over unchanged could break behavior that only Aeven has.

## Decision

Each fix was ported against Aeven's current code and checked for its effect on sessions that move between devices and builds:

- **Thinking bound to the request prefix** (`avn-llm-pi-ai`, DSH `prefix-binding`): every Anthropic Messages response records a digest of its request prefix in its replay state, and a later request drops the replayed signed and redacted thinking of any assistant message whose prefix digest no longer matches; text, tool calls, and unsigned thinking stay, so a DeepSeek route through an Anthropic-compatible endpoint keeps its reasoning. Under manual thinking the open tool round keeps its thinking. Builds without the field ignore it (replay-state validation has no unknown-key check), and replay state recorded before it is treated as stale, so only the thinking is dropped and the request never fails. A desktop whose system prompt or tools differ from the one that recorded a turn now sends a valid request instead of a rejected signature.
- **Unreadable skill roots** (`avn-skill-filesystem`, `avn-tool-skill`): a root that fails discovery is skipped with a warning and the lookup is marked incomplete; the catalog still lists the confirmed skills with a notice that discovery is retried, instead of withholding the whole catalog.
- **Home-directory paths** (`avn-fs-local`): a requested path that is `~` or starts with `~/` (and `~\` on Windows) begins at the home directory; `~user`, later `~` segments, and directory entry names stay literal. DSH also resolves `..` through symlinks physically; Aeven keeps its lexical `..`, which this fix does not touch.
- **Lenient tool arguments** (`avn-tool-fs-search`, `avn-tool-goal`): an exact empty `include` in `grep` means no filter, and `update_goal` ignores `objective`, `max_goal_rounds`, and `blocked_reason` for actions that do not use them. The three schema descriptions changed, so the recorded tool-schema snapshots were refreshed.
- **Malformed multi-label charset** (`avn-web-fetch-http`): a comma- or whitespace-joined declaration that contains a UTF-8 label is decoded as strict UTF-8, and invalid UTF-8 still fails. The web-fetch snapshot fixture now serves `charset=gbk,utf-8`.
- **Prompt retries racing admission** (`avn-session-controller`): Aeven's own log check, which already deduplicates a prompt delivered both through the account inbox and from the typing device's queue, runs again after model and attachment preparation and when admission fails, so concurrent deliveries of one request admit one input. DSH's per-session receipt cache was not taken because Aeven's log scan already covers claimed and removed inbox entries.
- **Separate instruction-chain budgets** (`avn-agent-instructions`): the user-global chain and the project chain each render under `maxBytes`, so a message holding both is at most twice `maxBytes`, and a merged frame longer than that falls back to the single-budget rendering. A session whose baseline was recorded under the shared budget receives the omitted user-global file as one additional transition on resume; the baseline is not rewritten. With it, the change section for the user-global file now reads "These user-global instructions apply to all work." instead of naming the internal `user-global` scope key as a directory.
- **Model-switch compaction** (`avn-compaction-basic`): a prepended `agent/request` listener prices the history against the newly selected model's window before the new header is logged, and when it is above that threshold the previous model summarizes it. Unlike DSH, a failure is logged and the request is sent anyway, because the request often fits below the window and overflow recovery handles it when it does not; switching models never fails because of compaction. The only listener that changes the request model in Aeven is the session's own model selection, so the check runs when a person picks another model, from any device.
- **Persistent bash history expansion** (`avn-tool-bash-persistent`): the shell setup sends `stty -echo; set +H`, so `!` sequences reach bash unchanged.

## Alternatives considered

**Dropping `LUA_TOKEN` from the Windows ACL sandbox token** (DSH bdd75ca1a0) — DSH can drop it because its sandbox also lowers the token to Low integrity; Aeven's does not. Without both, a sandboxed command started by an elevated Aeven would keep High integrity and administrator reads, while the benefit — confined launches under the built-in Administrator or WDAGUtilityAccount — reaches no ordinary account. Not taken.

**Refusing late wakes during agent teardown** (DSH 681d947cad) — with the guard, a prompt that arrives while an agent is being disposed is logged in the inbox but not run, and Aeven never runs queued inbox input when a session resumes. Prompts forwarded through the account inbox or racing a runner hand-off could then sit unanswered. Not taken until resumed sessions wake on pending input.

**Failing the request when model-switch compaction fails** (DSH behavior) — fails requests that Aeven sends successfully today. Rejected.

## Consequences

Anthropic sessions lose replayed thinking from turns whose prefix changed, which costs some cached reasoning context but no request. Instruction prompts can grow to twice `maxBytes` when both chains are large. A switch to a smaller-window model can add one summary request before the first request on that model. The Windows sandbox still cannot confine commands under the built-in Administrator account.
