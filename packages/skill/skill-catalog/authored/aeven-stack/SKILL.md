---
name: aeven-stack
description: Route a task to the right skill in the aeven-stack pack and explain how the pack fits together. Use when the user asks which skill to use, what the pack contains, or where to start on a coding task in Aeven.
---

# The aeven-stack

Match the task to one skill, say why in one line, then run it.

## Pick a skill

| If the task is... | Use |
|---|---|
| Any coding session (always on) | avn-mode |
| Vague or high stakes | avn-sharpen, then avn-plan-loop |
| More than one file or step | avn-plan-loop |
| A new module or API shape | avn-blueprint |
| Any code change | avn-verify-loop |
| A bug with a cheap test target | avn-tdd |
| The same failure twice | avn-unstick |
| A long run or a full context | avn-context-reset, avn-ledger |
| A hard artifact where one try may miss | avn-best-of-n |
| Wide coverage, audits or races | avn-swarm |
| A review before merge | avn-review-loop, or avn-jury for several models |
| A risky change | avn-blast-radius |
| A new UI | avn-design |
| A UI that looks generic | avn-design-audit |
| Opening a PR | avn-pr |
| Watching CI and bots | avn-watch-pr |
| Change to merged PR, unattended | avn-ship |
| Same, but stop before merge | avn-ready |
| Someone else's PR or branch | avn-adopt |
| An old PR | avn-revive |
| Understanding code | avn-explain |
| Coming back after a long run | avn-catchup |
| Repeated agent mistakes | avn-lessons |
| Writing prose or docs | avn-unslop |
| Rules of thumb | avn-principles |

## How the pack fits together

Every skill is one loop with a hard stop condition and a demand for evidence rather than a claim. avn-mode is the standing working style; avn-plan-loop, avn-verify-loop, avn-unstick and avn-review-loop are the loops; avn-blueprint, avn-design, avn-tdd and avn-ship are the build path; avn-ledger, avn-context-reset, avn-catchup and avn-lessons keep a long run honest.

## Rules

- Recommend one skill. Name a second only if the task clearly has two phases.
- If no skill fits, say so and work with avn-mode alone.
