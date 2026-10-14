# Agent Note: Advisory procedure recall

Status: implemented

English | [中文](2026-10-03-advisory-procedure-recall.zh.md)

## Problem

Procedures distilled from previous work can carry outdated steps and task-specific assumptions. Publishing them as skills makes discovery a mandate to load and follow them, and mixes historical experience with authored workflows in `/`.

## Decision

Learned procedures remain in the per-user capability store with the automatic learner, revisions, supporting files, and evidence. They contribute no skill provider. The capability consumer selects non-candidate, non-retired procedures by model-scored task relevance and appends bounded, source-labelled historical context. Current user instructions take precedence; recalled content neither grants authorization nor expands the task.

Exposure and use are separate. Recalled context and deliberate `view` calls make a procedure available for reporting; only reported use contributes execution evidence. Candidates require deliberate validation or restoration before automatic recall.

This decision replaces skill-based exposure in the [learning note](../feature/2026-09-29-capability-learning.md) and skill-load attribution in the [lifecycle note](../feature/2026-09-29-capability-lifecycle.md). Their storage and evidence rationale remains applicable.

## Alternatives considered

Filtering only the `/` menu preserves the imperative model catalog. Softening skill descriptions preserves the same activation mechanism. A separate vector index adds storage and synchronization without a current need; selection uses the existing LLM service and capability registry.

## Consequences

Recall incurs a bounded foreground model call and may omit useful procedures. A relevance score is not a trust judgment. Candidates are retained without automatic exposure. Source labels preserve selected names and revisions in the session log. Automated behavior and conflict tests are deferred at the user's request; TypeScript, build, and live browser verification cover this implementation pass.
