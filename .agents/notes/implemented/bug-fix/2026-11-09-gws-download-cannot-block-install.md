# Agent Note: A gws download failure cannot block an install or update

Status: implemented

English | [中文](2026-11-09-gws-download-cannot-block-install.zh.md)

## Problem

On 2026-11-09, Desktop 0.3.39-alpha could not start after an update on macOS x64, macOS arm64, Linux, and Windows. The update's profile install runs `@aeven/host-account-integrations`'s postinstall, `scripts/ensure-gws.mjs`, which downloads the `gws` binary from the `googleworkspace/cli` GitHub release. GitHub's browser download route (`github.com/<repo>/releases/download/...`) answered 504 for some assets, and which assets failed changed from request to request. The postinstall threw, `pnpm install` exited 1, and the staging install stopped Desktop startup. Only the Gmail, Google Drive, and Google Calendar connectors run `gws`.

## Decision

**Downloads retry over two routes.** Each attempt tries the browser download route and then the REST asset route (`api.github.com/repos/<repo>/releases/assets/<id>` with `Accept: application/octet-stream`), which served assets the browser route answered 504 for. There are three rounds with 1 s and 2 s waits between them, the archive must still match its published `.sha256`, and the binary is renamed into place only after it is fully written.

**The postinstall is optional; the connector installs on demand.** The postinstall passes `--optional`, so a failed install prints a warning and exits 0. `googleConnection` runs the script without `--optional` when the `GWS_BIN` path is missing. Concurrent connections in one Host process share one install, and a failed install fails only that connection and is retried on the next one.

## Verification

On macOS arm64: a fresh run installed `gws 0.22.5`. With the network blocked through an unreachable `HTTPS_PROXY`, `--optional` exited 0 with the warning and the strict run exited 1. Two concurrent `googleConnection` calls with the binary removed reinstalled one binary byte-identical to the original. The x64 macOS asset that the browser route answered 504 for downloaded through the REST route and passed its checksum.

## Consequences

- An install that could not reach GitHub leaves Google connectors to install `gws` when they first connect, and that connection waits for the download.
- The REST asset route uses GitHub's unauthenticated API quota (60 requests per hour per IP), and only after the browser route fails.
