# Agent Note: Aeven inline image history respects the gateway body budget

Status: implemented

English | [中文](2026-10-08-aeven-inline-image-body-budget.zh.md)

## Problem

The Aeven gateway accepts 8 MiB JSON bodies, but its client inherits a 20 MiB inline image budget from the direct DeepSeek route. Accumulated uploaded and generated previews cause successful image generation to be followed by a rejected reasoning request; later turns fail with the same 413.

## Decision

The Aeven route defaults to a 6 MiB base64 image budget and a 3 MiB offload quantum. Existing request projection replaces the oldest previews with attachment handles and normalized reference paths. Durable images and image-generation reference inputs remain unchanged. Configuration can override both budgets.

## Alternatives considered

**Increase the gateway ceiling.** This changes the gateway abuse control rather than matching this client's image history to the deployed route.

**Change direct DeepSeek defaults.** Its endpoint has a different budget; the Aeven route owns its defaults.

## Consequences

The request reserves 2 MiB for text, tool schemas, and JSON fields. A deployment with larger non-image content or a different gateway ceiling must configure a matching image budget. Models can recover offloaded images through their retained local paths.
