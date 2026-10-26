# Agent Note: Desktop production service endpoints

Status: implemented

English | [中文](2026-10-14-desktop-production-service-endpoints.zh.md)

## Problem

The Desktop Host inherits development URLs from the base and Web bundles. An installed app launched without environment settings addresses localhost ports 9000 and 9020, and supplies no OAuth provider URLs. A repository `.env` does not accompany the installed application, so a successful backend startup can leave the page waiting for an unreachable API.

## Decision

The [packaged Desktop Host overlay](../../../../apps/desktop-host/config/desktop.cordis.patch.yml) owns production defaults matching the repository operator's confirmed deployment: `https://aeven.io/api` for the API and `https://aeven.io` for web, media, and OAuth. The identity authority, model route, media provider, and account integrations use the same API default and accept `AEVEN_API_URL` overrides. The search route resolves that base from the launched environment and appends `/v1`, so the overlay carries only its credential reference and model, and the shell supplies the base when the launching environment names none, since a packaged app ships no `.env`. Web, media, and provider URLs accept their corresponding environment overrides. Desktop OAuth uses `window` because redirecting the application document would replace the shell.

Only public service URLs enter the overlay. Packaging does not copy `.env` or its credentials into release artifacts. The base and Web bundles retain their development defaults. The [packaging environment loader](../process/2026-09-14-desktop-packaging-reads-the-repository-env-file.md) remains responsible for build settings rather than installed runtime service discovery.

## Alternatives considered

**Create a home `.env` during installation.** This makes ordinary startup depend on mutable machine configuration and leaves clean installations without the application's own deployment defaults.

**Copy the repository `.env` into the release.** It mixes public deployment settings with credentials and other workstation configuration. The installed app requires public URLs, not the build machine's environment.

**Patch only the identity authority.** Sign-in could reach production while inference, search, media, and account integrations still address development servers.

## Consequences

Clean Desktop installations reach the configured production deployment without a home `.env`; operators can still select staging or local services with environment overrides. Replacing a plugin config replaces every field, so the search model and credential reference and Slack callback settings remain explicit in the overlay. Production URL changes require a release or an explicit operator override.

The [composition regression tests](../../../../apps/desktop/tests/service-endpoints.spec.ts) load and compose the actual base, Web, and Desktop patch files and evaluate service configs with an isolated empty environment and with deployment overrides. Both cases fail against the overlay without these defaults. They cover configuration rather than network availability or a packaged Electron login; no session-log output changes.
