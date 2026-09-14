# Agent Note: Desktop packaging reads the repository `.env` file

Status: implemented

English | [中文](2026-09-14-desktop-packaging-reads-the-repository-env-file.zh.md)

## Problem

Every `package:desktop:*` command reads `DSH_DESKTOP_APP_ID`, `DSH_DESKTOP_AUTO_UPDATE_ENV`, and `DOWNLOAD_TEST_ORIGIN` from the shell. The repository root ships a `.env` file for exactly this kind of local setting, and the product CLI already loads it at startup, so a workstation that keeps the packaging settings there still has to export them again before packaging and again inside every fresh shell, because the loading path belongs to the CLI rather than to the packaging scripts.

Packaging cannot simply adopt the product's loading path: a package command is a plain pnpm script that starts no Cordis application, so no boot layer fills the environment for it.

The Linux container build makes the gap visible. `package-linux-container.ts` forwards those three names into the container with `--env`, and a name the shell never sets is forwarded as nothing.

## Decision

`apps/desktop/scripts/desktop-environment-file.ts` exports `loadDesktopPackagingEnvironment(path, environment)`, which reads one env file with `parseEnv` and copies only the names in `DESKTOP_PACKAGING_ENV_NAMES` — `DSH_DESKTOP_APP_ID`, `DSH_DESKTOP_AUTO_UPDATE_ENV`, and `DOWNLOAD_TEST_ORIGIN` — into an environment that does not already hold each name. It returns the names it copied and returns an empty list for an absent file.

Both `package-target.ts` and `package-linux-container.ts` call it once at the start of `main` with the repository root `.env`, so host packaging and container packaging resolve the same three settings from the same file. `package-linux-container.ts` derives its `--env` forward list from the same exported `DESKTOP_PACKAGING_ENV_NAMES` constant, so the container path cannot forward a set of names that drifts from what the loader supplies.

The three names remain the complete set. `OPENROUTER_API_KEY`, COS secrets, and every other root `.env` entry stay out of a packaging subprocess environment, and no packaging code reads them from there. A value the shell already sets wins, so a CI job or a one-off override keeps its meaning, and the shell stays the higher-priority source.

`.env` is gitignored, and the loader reads no absolute home path, so `.env` means the repository root file only. A packaging run in a checkout that has none behaves exactly as before: it reads the shell, and a missing setting fails at the same place it always did.

## Alternatives considered

**Load the whole file into `process.env`.** electron-builder and its hooks spawn subprocesses, and the product's canonical rule is that a key's environment wins; filling the environment with every entry of a developer's `.env` would hand unrelated secrets to those children and hide the mistake. The explicit name list is the entire safety property here.

**Use the credentials `.env` provider.** That provider belongs to a running Cordis application and resolves `$DSH_HOME/.env` and an invocation-working-directory `.env` for credential references. A package command starts no application, and packaging settings are not credentials, so adopting the provider would mean booting a harness to build an installer.

**Require release automation or shell exports.** Packaging must work from a workstation, and the environment is already the documented interface for CI. Keeping `.env` as a second source adds no variable and requires no second file, and a value the shell sets still wins.

## Consequences

A workstation build can keep the three packaging settings in the repository root `.env` and stop exporting them per shell. CI is unchanged: it supplies the names as environment entries, which the loader leaves alone.

The loader runs before argument parsing in both commands, so a bad `.env` value surfaces as the packaging configuration error that the setting already produced, not as a new failure mode.

`DESKTOP_PACKAGING_ENV_NAMES` becomes the single list that the Linux container forward list and the loader both use, so adding a fourth forwarded setting is one edit in one file rather than two that can disagree.

## Testing

`apps/desktop/tests/desktop-environment-file.spec.ts` covers the three contract points: only the packaging names are copied while another entry in the same file is left out, a value the target environment already sets is kept, and an absent file supplies nothing.
