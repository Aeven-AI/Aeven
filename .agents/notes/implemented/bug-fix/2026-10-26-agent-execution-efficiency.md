# Agent Note: Efficient execution and evidence-backed progress

Status: implemented

English | [中文](2026-10-26-agent-execution-efficiency.zh.md)

## Problem

A long local session spent little time inside file tools but repeatedly requested one tool per model response, retried guarded edits without a recorded read, and ended with unfinished work. Promises without mutations bypassed turn review. Documentation checks also skipped without evidence that their current inputs had passed.

## Decision

The shipped persona groups independent native tool calls, reads before guarded edits, checks coherent patches once, and continues authorised work to completion or a concrete blocker. Progress describes dispatched actions and observed results.

Turn review also screens final replies for selected English first-person action commitments. The auxiliary reviewer checks whether action actually occurred and whether requested work remains; ordinary conversation is not reviewed solely because it contains text. Existing review budgets and failure handling remain in force.

Documentation aggregates always schedule their leaves. The link gate records a versioned successful fingerprint covering Markdown, verifier scripts, package metadata, the lockfile, cache implementation, and discovered local targets. Missing targets and legacy cache records invalidate reuse.

## Alternatives considered

Reviewing every reply adds latency to ordinary conversation. Lowering model quality, bypassing file guards, and trusting a clean Git status do not address execution overhead safely. Enabling code execution requires separate evaluation.

## Consequences

The model and reasoning settings remain unchanged. Batching depends on model decisions; the English commitment screen can miss other wording or languages, and bounded review is advice rather than guaranteed completion. Cache reuse requires a prior successful check over matching inputs.
