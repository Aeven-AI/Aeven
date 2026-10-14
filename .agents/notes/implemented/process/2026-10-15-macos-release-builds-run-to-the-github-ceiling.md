# Agent Note: macOS release builds run to GitHub's job ceiling

Status: implemented

English | [中文](2026-10-15-macos-release-builds-run-to-the-github-ceiling.zh.md)

## Problem

The `build` job in `.github/workflows/release-desktop.yml` gave every matrix target the same `timeout-minutes: 150`. The signed macOS target notarizes inside its `Package` step, and that wait is Apple's queue rather than the runner's work, so it can outlast the window and have the job killed mid-package. `release` needs every build job, so a killed macOS target takes the whole run with it: the finished targets' installers and update feeds are discarded and nothing is published.

## Decision

- **The macOS targets take GitHub's six-hour job ceiling.** `timeout-minutes` became `${{ startsWith(matrix.target, 'mac-') && 360 || 150 }}`. Both macOS targets get 360 minutes, the longest a GitHub-hosted job may run; the Windows and Linux targets keep 150.
- **The window is derived from the target, not added to the target list.** The `plan` job's JSON entries keep describing where a target builds and through which script, and the build job derives its own window from `matrix.target`.

## Alternatives considered

**One 360-minute window for every target.** The smallest edit, but a package step that hangs on Windows or Linux would hold a runner for six hours before failing, where those targets package in about twelve minutes.

**Notarizing outside the build job.** `notarytool submit --no-wait`, with the ticket polled and the disk image stapled in a separate job, moves the waiting off the packaging runner — but publishing still waits for the staple, so the release is gated on the same Apple queue, and the submission id would have to survive between jobs.

**A `timeout` field on each entry of the target list.** It reads the value beside the runner it applies to, at the cost of repeating 150 across the four short targets and expanding a list the `plan` job already emits as a JSON literal.

## Consequences

- A signed macOS build occupies its runner for as long as notarization takes; GitHub ignores a `timeout-minutes` above 360 on hosted runners, so nothing in the workflow extends the window further.
- A notarization Apple's queue holds past six hours still kills the target and, with it, the release. Beyond that the answer is not a workflow setting: it needs a self-hosted runner or notarization that does not happen on CI.
