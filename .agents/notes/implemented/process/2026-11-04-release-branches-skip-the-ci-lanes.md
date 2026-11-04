# Agent Note: Release branch pull requests skip the CI lanes

Status: implemented

English | [中文](2026-11-04-release-branches-skip-the-ci-lanes.zh.md)

## Problem

An avn release lands as one commit that rewrites a version field in every workspace manifest and updates the lockfile. The four pull-request lanes exist to inform a behavior change; a version bump carries none, yet every release pull request spent the full matrix on it and only merged because the owner labelled it `skip-ci` by hand. A forgotten label burns the lane budget and traps the release until someone notices.

## Decision

Every job in [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) skips a pull request whose head branch starts with `release/`. The release procedure keeps that prefix, so the release commit's pull request starts no lane and needs no label. `skip-ci` stays for the other changes the lanes cannot inform, such as workflow policy.

The condition reads `github.head_ref`, which is empty on `merge_group` and `workflow_dispatch`, so a queued batch still re-checks the merged result and a manual dispatch still runs the lanes.

## Alternatives considered

**Label each release pull request `skip-ci` by hand.** This is what the release procedure did; it depends on the owner remembering, and the release waits on a label rather than on anything about its diff.

**Match the release commit's subject.** A subject pattern lives only in commit prose, so one renamed convention silently starts the lanes again.

**Run the lanes on releases anyway.** The matrix then costs its full duration per release to inform a diff of version fields, on a tree the previous release already proved.

## Consequences

A release branch that carries anything beyond version bumps keeps its pull request unverified, because the branch name decides and not the diff. Reviewing what the release branch changed remains the owner's task.
