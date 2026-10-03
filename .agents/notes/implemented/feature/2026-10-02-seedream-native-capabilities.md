# Agent Note: Seedream native image capabilities

Status: implemented

English | [中文](2026-10-02-seedream-native-capabilities.zh.md)

## Problem

DeepInfra's OpenAI-compatible image listing omits Seedream 4.5 and 5.0 Pro, and its image route ignores unadvertised fields. Resolution tiers, additional references and native generation controls require a different route; accepting them on the compatible route can charge for an image that ignores the request.

## Decision

The DeepInfra provider discovers non-deprecated image models through `/models/list` and uses native inference for Seedream 4, 4.5 and 5.0 Pro. The media seam and `generate_image` carry guidance scale, output format and prompt optimization alongside size, resolution, seed, references and background. The Aeven provider forwards these controls to its gateway; Image Flash maps to Seedream 4 and Image Pro to Seedream 5.0 Pro. Each provider refuses controls its transport does not support.

Native images are downloaded only from the exact HTTPS Ark CDN hosts the supported models return, without authorization or redirects. The configured byte ceiling is enforced while streaming. DeepInfra credentials remain on the API origin. [Generated-media providers](../architecture/2026-09-03-generated-media-providers.md) continues to own video retrieval through each provider's content endpoint.

Seed is a provider input, not a determinism promise. Native `n` performs independent calls; DeepInfra does not expose Ark's watermark or sequential-generation switches. Returned bytes determine image media types and actual dimensions.

## Consequences

The assistant can request each supported model's native generation settings without an extra discovery call per generation. Native images add one credential-free CDN download each, bounded by the image byte ceiling. The model picker and tool descriptions name the gateway models' current options.

## Verification

TypeScript checking and the full build validate the changed request types and shipped artifacts. A live `avn` profile returned a Seedream 4 JPEG with resolution, seed, guidance and a reference image; native 5.0 Pro accepted four references, JPEG, opaque background and fast optimization at $0.0594. Its result established the second permitted Ark CDN host. Final validation excludes test suites and further generation calls at the user's request.

## Alternatives considered

Sending native controls to the compatible route cannot establish support because unknown fields are ignored. Translating resolution tiers into square pixel sizes loses the model's own sizing behavior. Forwarding the API bearer to a vendor CDN exposes credentials outside their API origin; redirects could also move a download outside the permitted hosts.
