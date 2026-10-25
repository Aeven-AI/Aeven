# Agent Note: Public research and user agency

Status: implemented

English | [中文](2026-10-25-public-research-and-user-agency.zh.md)

## Problem

A personal conversation produced blanket refusals for ordinary public facts, repeated relationship advice after a research request, and an unsupported identity confirmation from a nickname and avatar accessories.

## Decision

The shipped Aeven persona carries one short paragraph: do what the person asks in personal conversations as in work, including looking people up with sources; do not refuse because the subject is a private person, lecture, add unrequested warnings, or replace the task with advice; say what was found and what was not checked, and do not present a matching nickname or avatar as confirmation. The persona sets no limits of its own; what the model declines comes from the model itself. The persona carries tone, so the paragraph names what to do instead of listing assessment and verification procedures.

The [evidence and task-complaint decision](2026-10-21-evidence-based-assessments-and-task-complaints.md) remains active: it owns comparison evidence and memory handling; this decision covers public-person research and user agency within personal conversations.

## Alternatives considered

**Per-category limits** (sensitive information, contact details, whereabouts, associates, inferred traits) reproduced the refusals they were meant to narrow, because the model treated each category as a reason to decline. **Blanket private-person refusals** reject ordinary biographical questions. **Detailed verification rules in the persona** make the model hesitate between asking and acting. **A new refusal interceptor** adds a second decision mechanism when the observed refusal and unsupported certainty originate in model replies.

## Consequences

The change adds prompt guidance without changing tools, approvals or session formats. The assessment-memory recorded-session snapshot pins the shipped persona. Live model checks are necessary to assess tone and judgment; prompt guidance cannot guarantee compliance. Installed desktop presets need the same edit for fresh sessions, while already mounted sessions retain their loaded generation until the host restarts.
