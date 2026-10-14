# Agent Note: A packaged Desktop carries its deployment settings and its sign-in peer

Status: implemented

English | [中文](2026-10-14-desktop-packaged-deployment-and-peer-alias.zh.md)

## Problem

`dev:desktop` worked while the packaged application did not, for two reasons the development path hides. `dsh-coding-oauth-core`, which `@aeven/subscription-auth` loads, imports `@deepseek-ai/dsh-llm` as a peer; the repository install adds that peer automatically, but the Desktop profile sets `autoInstallPeers: false`, so the staged Host failed its health check with `ERR_MODULE_NOT_FOUND`. The shipped profile rows also read the Aeven account, web, media, and sign-in URLs from the Host environment; `dev:desktop` loads them from the repository `.env`, while an installed copy has none, so sign-in targeted `http://localhost:9000` and offered no provider.

## Decision

- **The seed satisfies the peer with the core tarball.** `desktopCorePackageOverrides` adds `@deepseek-ai/dsh-llm` as an alias of the `@aeven/llm` tarball, both as an override and as a root dependency, which the hoisted layout places where `dsh-coding-oauth-core` resolves it. A lockfile scan of the seed found no other unmet peer that the Host loads.
- **Packaging records the deployment settings in the application.** `AEVEN_API_URL` is required; `AEVEN_WEB_URL`, `AEVEN_MEDIA_URL`, the three `AEVEN_OAUTH_*_URL` values, and `SLACK_CLIENT_ID` are recorded when set. electron-builder writes them as `aevenDeployment` into the application's `package.json`, packaging reads them from the repository `.env` like `AVN_DESKTOP_APP_ID`, and the release workflow passes them from repository variables.
- **The shell hands them to its Host at launch**, keeping any value the launching environment already sets.

## Alternatives considered

**Declare `@deepseek-ai/dsh-llm` as a dependency of `@aeven/subscription-auth`.** It would fix every install, but the npm package pulls further DSH packages into the product graph, and an alias to `@aeven/llm` in the workspace changes the development graph and lockfile beyond this fix.

**Enable `autoInstallPeers` in the Desktop profile.** It would also install the browser-library peers the seed deliberately drops from the Host graph.

**Bake the URLs into the profile rows as defaults.** The rows serve every deployment, and the repository's configurability rule keeps deployment-varying values out of plugin defaults.

## Consequences

- A packaging run fails without `AEVEN_API_URL`, before electron-builder starts.
- A release built without the other repository variables omits those sign-in providers and keeps the media default.
- The seed's offline installation proof still does not boot the Host, so a missing runtime import surfaces only at the application's own health check.
