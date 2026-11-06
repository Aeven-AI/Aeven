# Agent Note: a Host that serves many people opts into per-account behavior; desktop keeps its defaults

Status: implemented

English | [中文](2026-11-06-hosted-account-behavior-is-opt-in.zh.md)

## Problem

The hosted profile (`@aeven/hosted-app`) serves the accounts of different people from one Host, so theme, dictation, onboarding, provider routes, and Grok Build and Codex subscriptions must be each account's own there. The first changes for it altered shared registrations and defaults that the desktop app also loads:

- Theme, speech-to-text, onboarding, and `llm-pi-ai` registered with `reach: 'account'`, so `@aeven/settings-sync` started copying them between a desktop's devices.
- `sync-yjs` fetched seven documents ahead of every catch-up on a new device by default.
- The workspace registry imported a workspace another device published without a directory as a workspace of its own, instead of as that device's.

## Decision

Per-account behavior is opt-in configuration that only the hosted bundle sets; every default keeps desktop behavior.

- `SettingsRegisterOptions.perAccount` (and `SettingsSectionHooks.perAccount`) registers a namespace with `account` reach only on a provider whose `accountSections` is on (`settings-file` `accounts: true`); any other provider registers it with its declared `reach`. Theme keeps `device`, the others keep the `device` default.
- `sync-yjs` `firstDocuments` defaults to none; the hosted patch lists the documents a browser opens on.
- `@aeven/workspace` `pathlessWorkspaces` defaults to false; the hosted patch turns it on.
- Subscriptions per account run only with `avn-subscription-auth` `accounts: true` (`src/accounts.ts`): each account's credentials, model listings, and selection live under `accounts/<account>/subscriptions/`, the routes answer the account a request carries, and changing requests must come from a page of this Host. Without it the owner routes and `~/.grok` sign-in run as before.

## Alternatives considered

Keep `account` reach for these namespaces everywhere. Rejected: on desktop it changes which device a theme, a dictation choice, or a provider route belongs to, and a configured provider endpoint would follow the account to devices where it is not reachable.

Have the hosted settings provider list per-account namespaces in its configuration. Rejected: the owning plugin knows whether its section is a person's choice; the provider only knows whether it keeps account sections.

## Consequences

A desktop app built from this tree registers, syncs, and imports exactly as before. The hosted patch is the one place that turns the per-account behavior on, so a new hosted-only behavior needs a default-off option and a patch row.
