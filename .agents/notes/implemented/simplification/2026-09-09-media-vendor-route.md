# Agent Note: One Vendor Route Behind the Media Adapters

Status: implemented

English | [中文](2026-09-09-media-vendor-route.zh.md)

## Problem

The DeepInfra and OpenRouter media adapters were written independently and converged on the same code. Credential resolution, the JSON call against a pinned origin, the byte retrieval under a size ceiling, and the job-body translation were duplicated between them, along with the `available()` predicate and the shape of the video provider itself. Clone detection reported six overlapping regions across the two files. The duplication was not incidental: three of the video provider's four methods differed only in their route paths, so a fix to any of them had to be made twice and could silently be made once.

## Decision

`@aeven/media` publishes the shared plumbing its providers build on. `vendorRoute(ctx, config)` answers `available`, `apiKey`, `json` and `bytes` for one vendor given its registry key, credential reference, origin, and display name. `vendorJob` maps a job body onto the seam's status union against a vendor-supplied status table. `vendorVideoProvider` assembles a complete `MediaVideoProvider` from the three route paths, the size ceiling, the status table, and the one function that shapes a start request. Each adapter keeps exactly what its route shapes differently: its origin, its status vocabulary, its model-listing filter, its image request and response handling, and its start-request body. The seam package takes `@aeven/credentials` as a peer dependency, which is what the shared credential resolution needs.

The route's operations are declared as property function types rather than methods, because adapters hand them straight to a provider field and a detached method would carry no receiver.

## Verification

Both adapters' existing suites pass unchanged except for one expectation: DeepInfra's failure text for a terminal status with no error body now names the vendor, matching OpenRouter's existing wording, because the two messages became one. The shared module reaches full statement, branch, and function coverage through those suites, and clone detection reports no remaining duplication between the two packages.

## Alternatives considered

**A new `media-http` package.** A package brings a README, a tsconfig, a registration and a place in the layout for what is a handful of functions with exactly two consumers, both of which already depend on the seam package.

**Leave the duplication and suppress the clone report.** The markers exist for code that must stay diffable against an origin it was ported from, which is not what these adapters are: they are owned source, and a fix to a credential or ceiling rule has to land in both.

**Share only the HTTP call.** That leaves the video provider's three near-identical methods in both files, which is where most of the duplicated lines and all of the path-shaped risk actually were.

## Consequences

A change to credential resolution, upstream failure text, the size ceiling, or job-status handling is made once and both vendors follow. A third vendor adapter states its origin, paths, status table and request bodies rather than restating the transport. DeepInfra's terminal-status message changed wording as the cost of that single implementation.
