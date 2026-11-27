# Agent Note: Launcher pipe errors end the Host

Status: implemented

English | [中文](2026-11-27-launcher-pipe-errors-end-the-host.zh.md)

## Problem

On 2026-11-25 at 17:24 UTC the hosted Host exited with status 1 on an unhandled `write EPIPE` `error` event on a `Socket`, raised from `Socket.end` in `spawnProcess` of [`@aeven/subprocess-executor`](../../../../packages/subprocess/subprocess-executor/README.md) called by `spawnSubprocess`. `spawnProcess` writes the command script to a ready launcher's control pipe with `control.end(script)`; the launcher had ended while it waited in the pool, so the write failed. No listener was attached to any launcher pipe, so Node raised the error as an uncaught exception and every hosted account lost its running turns.

## Decision

`Executor` attaches one `error` listener, `ignoreLauncherPipeError`, to each pipe the helper hands over (stdin, stdout, stderr and control) when the pipe arrives. The command's outcome already arrives separately: the helper sends `exit` for a launcher the Host took, or `gone` with the exit status when the launcher ended before the `taken` notice, and `Executor` settles every running command when the helper itself ends. A caller listening on the command's stdio still receives the same error.

## Alternatives considered

**Catching only the `control.end(script)` write** was rejected: the launcher's other pipes can fail the same way while it sits in the ready pool, before any command uses them. **Checking that a launcher is alive before handing it out** was rejected: the launcher can still end between the check and the write.

## Consequences

A launcher that ends before or as it receives a command produces a command that settles with the launcher's exit status instead of ending the Host. The command does not run; the caller sees it exit, as with any process killed at start.
