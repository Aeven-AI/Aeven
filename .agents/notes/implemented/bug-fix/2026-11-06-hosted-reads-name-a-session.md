# Agent Note: Hosted browser reads name a Session of the reader's account

Status: implemented

English | [中文](2026-11-06-hosted-reads-name-a-session.zh.md)

## Problem

On hosted Web, the authenticated `/api/file` route served any absolute path the Host's composed filesystem could read, so any signed-in account could read the Host's own files and other accounts' folders. `session.openWorkspacePath` ran the native opener without checking `canOpenWorkspacePath()`, so a created file's row asked the server to run `xdg-open`; it failed only because the binary is absent. The Files sidebar and the produced-files row had no viewer for video or audio, so an MP4 a command made appeared only as a row that failed to open.

## Decision

`session-controller` gains `pathReads` (default `true`); hosted sets it `false`, and `/api/file` does not register. `openWorkspacePath` refuses with `session/open-unavailable` while native opening is unavailable. `api-workspace-files` registers `/api/workspace-file?sessionId&path`, which resolves the path against that Session's workspace root under the same rule as a text preview (inside the workspace when `confineReads` is on), refuses a Session of another account as absent, and answers one byte range with `206`. The Files sidebar reads images, video, audio, and downloads through it, and downloads a file it cannot preview where the Host has no desktop. The produced-files row plays a produced video or audio file in place and downloads other unpreviewable files on such a Host. `FileKind` gains `video` and `audio`.

## Alternatives considered

Confining `/api/file` to the caller's account folders was rejected: the route carries no Session, so it would need a second account-to-folder rule beside the working-directory binding that `workspace-files` already resolves. Streaming ranges straight from disk was deferred, because the composed filesystem exposes only whole-file reads and its verified reads are what stop a jailed command from swapping a path under the Host.

## Consequences

On hosted, a Markdown image that names an absolute Host path no longer loads. Each media byte range reads the whole file, up to `maxFileBytes`. Desktop keeps `/api/file`, and its Files sidebar now also plays video and audio.

## Verification

Typecheck, lint, duplication, and build pass. On chat.aeven.io before the change, `/api/file?path=/etc/hostname` answered 200 for a signed-in account.
