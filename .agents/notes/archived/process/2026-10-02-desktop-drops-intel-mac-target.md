# Agent Note: Desktop drops the Intel Mac target

Status: implemented
Archived: 2026-10-15

English | [中文](2026-10-02-desktop-drops-intel-mac-target.zh.md)

## Problem

The Desktop release set included `mac-x64`, an Intel macOS build that Apple Silicon hosts produced through Rosetta. MemOS long-term memory is part of every Desktop installation and computes embeddings with Transformers.js, which pins `onnxruntime-node` 1.24.3 exactly. That package publishes native bindings for `darwin/arm64`, `linux/{arm64,x64}`, and `win32/{arm64,x64}` only, and its loader requires `bin/napi-v6/<platform>/<arch>/onnxruntime_binding.node` when Transformers.js loads it. An Intel Mac Desktop therefore shipped MemOS without a runtime that could load, while still carrying its 57 MB embedding stack.

## Decision

The Desktop target set is `mac-arm64`, `win-arm64`, `win-x64`, `linux-arm64`, and `linux-x64`. [`package-target.ts`](../../../../apps/desktop/scripts/package-target.ts), [`desktop-build-paths.mjs`](../../../../apps/desktop/scripts/desktop-build-paths.mjs), ``desktop-auto-update-environment.mjs``, and ``desktop-upload-plan.ts`` no longer accept `mac-x64`; an Intel Mac build host without an explicit target fails as an unsupported host instead of selecting it. The `package:mac:x64*` and `upload:mac:x64` scripts, the Rosetta execution check in runtime preparation, and the Intel LibreOffice engine in the macOS JIT signing pattern are removed.

The CLI keeps its Intel macOS platform packages, such as `@aeven/whisper-cpp-darwin-x64`: npm users choose their own installation, and this decision covers only the Desktop release set.

## Alternatives considered

**Pin an older `onnxruntime-node` with an Intel macOS binary for that target.** Transformers.js 4.2.0 pins 1.24.3 exactly, so an override would ship a runtime and model-loader combination nobody qualifies, on one platform only.

**Run MemOS embeddings on the WebAssembly backend on Intel Macs.** MemOS hard-codes `device: "cpu"` in its local embedder, so this requires patching a pinned third-party package and accepting slower embeddings on a platform Apple no longer ships.

**Keep the target and disable MemOS there.** MemOS is part of the product on every Desktop installation; a target without it would be a different product.

## Consequences

Intel Mac users cannot install Desktop releases. The CLI still installs there, but its MemOS embeddings depend on the same `onnxruntime-node` binary and do not load. Release automation builds five targets, and the update server no longer receives a `mac-x64` stream; earlier `mac-x64` releases remain on the server because upload never deletes historical objects, but no later version reaches them.
