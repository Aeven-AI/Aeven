# Agent Note: Evidence-based assessments and task complaints

Status: implemented

English | [中文](2026-10-21-evidence-based-assessments-and-task-complaints.zh.md)

## Problem

A complaint about a product comparison triggered personal-support behavior, unrelated personal-history recall, and unsupported reassurance. Competitor marketing claims became verified capabilities and strategic conclusions in saved facts. A turn-level correction also superseded every independent fact remembered during the previous turn.

## Decision

The Aeven persona keeps task complaints in the co-worker role regardless of tone. Comparisons distinguish advertised claims, inspected implementation, demonstrated behavior, plans and assessments, with equal evidence standards. Corrections revise the disputed claim and its consequences while retaining supported conclusions. Memory-writing instructions and capture summaries preserve attribution, dates and uncertainty; single writes accept the bulk tool's knowledge category.

The existing [recall judgment](../../../../packages/memory/memory-memos/README.md) evaluates personal content inside every candidate kind, including experience episodes. Anger at the assistant does not establish personal sharing. Requests for personal support retain relevant personal recall.

Only a positive factual-replacement judgment supersedes the previous exchange. Phrase detection remains outcome evidence, not authority to invalidate memory. Independently remembered facts are not superseded by a judgment about their enclosing conversation; incorrect facts require explicit editing or forgetting.

## Alternatives considered

An instruction to favor Aeven would replace negative bias with praise. Filtering only person-domain memories misses personal history in episodes. Superseding a whole batch assumes every stored fact expressed the disputed claim. A new confidence schema would require a durable-format change without establishing whether the model's assessment is correct.

## Consequences

No storage or session-event format changes. Prompt guidance reduces unsupported judgments but cannot prove model compliance. The recorded headless scenario pins the shipped persona and memory schemas and verifies a knowledge write through an independent workspace result. Focused capture tests cover factual replacement, complaints and independent batch preservation; live model checks remain necessary for relevance and assessment behavior. Stored historical assessments require a scoped audit rather than being upgraded to facts on recall.
