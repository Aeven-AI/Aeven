---
description: "The built-in task-first Automations sidebar screen."
kind: "package-reference"
---

# @aeven/client-ui-automations

English | [中文](README.zh.md)

## Summary

The sidebar opens `/automations`, including direct navigation and refresh. Creation and adjustment use the ordinary composer and conversation approval. The wide page shows next runs, latest outcomes, trigger-gated starter templates grouped by category with their local schedule, a personal suggestion starter, pause/resume, manual execution, deletion, each automation's runs, a Runs view across automations, retries of failed runs, removal of single runs, and clearing the finished run history. Every run row links to the run's conversation, which holds its result. Deleting an automation, removing one run, clearing the runs, and retrying a failed run each ask in the page's own dialog before acting. Clearing the runs removes every finished record and archives each one's conversation, so it leaves the sidebar. A single 30px control row carries the view switcher and the primary action. Cards are flat white blocks at the 30px surface radius without a stroke, and card actions come from the shared button primitive at its compact size. Starters that read email, calendar, or GitHub show a Connect action while the signed-in account has none of that group's connectors connected and enabled; it opens that connector in Settings. Compositions without account integrations show no Connect actions. The screen uses the same authenticated Connection as conversations and never stores authoritative schedules in the browser.

## Model Experience

This package adds no tools or prompt sections. Starter selections fill a localized draft with the task, schedule, required sources, guardrails, and confirmation instructions, and ask the model to use what it already knows about the user before asking; the personal suggestion starter asks for three automations fitted to the user; they send nothing until the user submits. The owning [core service](../../core/automations/README.md) documents conversational management and execution effects.

## Known Limitations and Deferred Work

The screen manages local execution. It refreshes visible history every five seconds. Notifications, a view of saved approvals, and cloud placement are deferred. No invariant installer is needed because this surface owns no durable state.
