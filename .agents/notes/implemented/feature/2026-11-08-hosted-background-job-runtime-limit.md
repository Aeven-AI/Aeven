# Agent Note: Runtime limit for hosted background commands

Status: implemented

English | [中文](2026-11-08-hosted-background-job-runtime-limit.zh.md)

## Problem

On hosted Aeven Web a user asked to see an HTML file, and the agent started `python3 -m http.server` as a background bash job in the account's jail. Nobody could reach it: every jailed command has its own network namespace, so the port existed only inside that command. The job still kept running, because a background bash job has no timeout and nothing ends it before the Host restarts. Each such job keeps part of its account's cgroup share (2 CPUs, 2 GiB, 256 processes), and a handful of accounts holding busy jobs can fill the jail-wide share (12 CPUs, 32 GiB) and slow every other account's commands.

## Decision

`avn-jobs-local` gains `runtimeLimitMs`, a map from job kind to milliseconds. The registry kills a job of a listed kind once it has run that long, with the detail `stopped at the <limit> runtime limit for <kind> jobs`; unlisted kinds keep no limit. The hosted patch sets `{ bash: 900000 }`, so subagent and workflow jobs are unaffected. The sandbox-jail `modelNote` tells the model that a listening port is reachable only from inside the same command, that it must not start a server for the user to visit, how to show a page instead, and that background commands stop after 15 minutes.

## Alternatives considered

Disabling `run_in_background` on hosted Hosts was rejected: long renders and data jobs would then hold the turn or detach anyway after `detachAfterMs`.

A limit inside `avn-tool-bash` was rejected: the registry already owns job lifecycle, kill reasons, and settlement notices, and a per-kind map there serves any future producer.

## Consequences

A legitimate background command longer than 15 minutes on a hosted Host is killed; the model reads the reason in the settlement notice. The `tool-bash` schema still says no timeout applies to a background job, which remains true of the command's `timeoutMs`; the limit reaches the model through the hosted `modelNote`.
