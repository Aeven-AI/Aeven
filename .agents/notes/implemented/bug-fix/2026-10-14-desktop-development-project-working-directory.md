# Agent Note: Preserve the desktop development project working directory

Status: implemented

English | [中文](2026-10-14-desktop-development-project-working-directory.zh.md)

## Problem

The Desktop Host survives Electron shutdown and keeps the generated development project as its working directory. Windows refuses to remove that directory while the Host owns it, so rebuilding the development project can fail with EPERM before Electron launches.

## Decision

Development preparation refreshes the contents of an existing real project directory without removing the directory itself. A symlink or non-directory at the project path is removed through the existing owned-path cleanup. Dependency links and project metadata are recreated from the current workspace.

## Alternatives considered

**Stop the Host before each launch.** This interrupts browser clients and running work, contradicting the shared Host lifecycle.

**Retry directory removal.** The working-directory owner remains alive, so retries cannot resolve the cause.

**Create a new project directory per launch.** This leaves multiple dependency views and requires tracking which persistent Host owns each one.

## Consequences

The project path remains stable across development launches. Refreshing its links does not restart a running Host or replace modules it has already loaded; backend changes still require a Host restart.

The regression test prepares the project while a child process holds it as its working directory, checks stale content removal and surviving dependency targets, and awaits child exit before temporary-directory cleanup. The existing Windows development project also refreshes successfully with its Desktop Host running.
