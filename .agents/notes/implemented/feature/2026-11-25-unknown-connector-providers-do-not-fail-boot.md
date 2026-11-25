# Agent Note: Unknown connector providers do not fail boot

Status: implemented

English | [中文](2026-11-25-unknown-connector-providers-do-not-fail-boot.zh.md)

## Problem

Desktop builds share `~/.aeven/storages/account_integrations.json`. A connector saved by one build with a provider another build does not list, such as `notion` read by 0.3.66 or a retired `compute-engine` read by a later build, failed the `account_integrations` domain open with `invalid-record`, and the whole plugin tree with it, so the app did not start.

## Decision

`storage-domain` gains the `invalidRecords: 'skip'` policy: a record that fails its table schema stays in the medium untouched, the failure is logged as a warning, and the open continues without it, so the build that wrote it still reads it. `account_integrations` declares it. The existing `'backup-and-skip'` moves the record aside, which would lose a newer build's connector, so it does not fit.

## Consequences

A build that does not know a provider does not show that connector and cannot use it; the record returns once a build that knows the provider opens the store. Builds released before this change still fail on such a record and need an update.
