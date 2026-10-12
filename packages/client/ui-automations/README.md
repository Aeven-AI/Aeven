---
description: "The built-in task-first Automations sidebar screen."
kind: "package-reference"
---

# @aeven/client-ui-automations

## Summary

The sidebar opens `/automations`, including direct navigation and refresh. Creation and adjustment use the ordinary composer and conversation approval. The wide page shows next runs, latest outcomes, trigger-gated starter ideas, pause/resume, manual execution, deletion, expandable results, linked retries, explicit result confirmation, and clearing the finished run history. A single 30px control row carries the view switcher and the primary action. Cards are flat white blocks at the 30px surface radius without a stroke, and card actions come from the shared button primitive at its compact size. The screen uses the same authenticated Connection as conversations and never stores authoritative schedules in the browser.

## Model Experience

This package adds no tools or prompt sections. Starter selections fill a localized draft with the task, schedule, required sources, and confirmation instructions; they send nothing until the user submits. The owning [core service](../../core/automations/README.md) documents conversational management and execution effects.

## Known Limitations and Deferred Work

The screen manages local execution. It refreshes visible history every five seconds. External write approval continuation, notifications, and cloud placement are deferred. Run results link to ordinary conversation addresses. No invariant installer is needed because this surface owns no durable state.
