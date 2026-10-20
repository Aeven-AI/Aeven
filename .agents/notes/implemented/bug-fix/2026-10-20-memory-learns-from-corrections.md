# Agent Note: Memory learns from corrections, and dev rebuilds reach the desktop page

Status: implemented

English | [中文](2026-10-20-memory-learns-from-corrections.zh.md)

## Problem

On 2026-10-19 four sessions of small CSS requests in this repository ran hundreds of tool calls each, and the user repeated "no tests", "just make the change" and "copy the CSS" without the next turn or the next session doing it. Long-term memory recorded the turns but did not learn from them.

- **No learning stages ran.** No `config.yaml` sits under the MemOS home, so the vendored default `algorithm.lightweightMemory.enabled: true` applied, and lightweight mode never mounts the reward, policy-induction, world-model, skill, or feedback runners. The account database held 434 episodes, every `r_task` null, and zero rows in `policies`, `feedback`, `decision_repairs`, `world_model`, and `skills`.
- **Corrections hid the user's own instructions.** The turn judge set `corrects` whenever the next user message "corrects or contradicts" the reply, and a superseded trace is left out of automatic recall. Angry follow-ups about how the work went superseded the turns that carried the instruction itself, among them "User wants CSS changes implemented directly, not devtools inspection" and "CSS only, no tests".
- **Learned procedures kept the slow path.** The learner joined every direct-user message of a turn into one `<request>`, so it could not see that "no tests" arrived after a test run. Of 27 procedures learned that day, 8 prescribe vitest and 13 prescribe DevTools measuring or screenshots.
- **Rebuilt client bundles never reached the page.** The desktop composition disables `client-hmr`, so `@aeven/client-modules` keeps serving the bundle bytes it read at boot. A development desktop host served a `client-ui-theme` bundle of 101,889 bytes while the rebuilt `lib/client.js` on disk held 102,078, and the user saw none of the theme-token changes that `pnpm run build:client` produced.

## Decision

`@aeven/memory-memos` gains `learning` (default `true`), which sets `algorithm.lightweightMemory.enabled` to its negation over whatever `config.yaml` says. Reward, induction, and feedback reach the model through the Host bridge, because capture, feedback, and session close already run inside `withRoute`; startup and periodic recovery stay off with the bridge.

The turn judge answers `corrects: true` only when the user says a fact the previous reply stated is wrong. A complaint about the approach, its speed, or an unfinished change, and a repeated or new instruction, leave the previous trace recallable.

`ExecutionTracker` keeps direct-user text committed before the turn's first tool call as `request` and records later messages as timestamped `instructions`. The learner renders each one as a `USER (during the work):` line between the calls it followed, and its rules make each such line a requirement from the first step: a call that went against it goes under "Avoid", and tests, browser inspection, screenshots, and measurements enter a fast path only when the user asked for them. The slowness pattern also recognizes "takes ages" and "how hard can it be".

A development desktop host, the one launched with `--allow-linked-profile`, appends a patch layer that enables `client-hmr`, whose 500 ms bundle poll calls `clientModules.rebuilt()` and recomposes the advertised batches. Packaged hosts keep it disabled. The Electron renderer's `/plugins/events` request falls through to `fetchBundle` and answers 404, so only browsers on the loopback port receive reload frames.

The four persona paragraphs that encoded correction, clarification, and visual-verification rules are removed: the persona carries tone of voice, and those rules made the model hesitate between asking and acting and measure after every edit.

## Alternatives considered

**A `config.yaml` in the MemOS home.** It would fix one installation and leave every new one lightweight; the provider row is where Aeven states its product default.

**Keep superseded traces in recall with a marker.** Recall would then show a user's instruction next to the complaint about it, and the model would still have to reconcile them; narrowing what counts as a correction leaves the instruction as one current memory.

**Restart the desktop host after every client build.** It loses running sessions, and the watcher already exists for this purpose.

## Consequences

- Each closed episode spends auxiliary calls on the owning session's route for reward scoring and induction.
- Facts the assistant stated wrongly are still superseded; turns that only drew a complaint stay recallable, including any wrong statement they held.
- Traces superseded before this change keep their tags.
