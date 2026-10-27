# Agent Note: Desktop restores the Intel Mac target

Status: implemented

English | [中文](2026-10-15-desktop-restores-intel-mac-target.zh.md)

## Problem

`mac-x64` left the Desktop release set because MemOS embeddings run through Transformers.js, which pins `onnxruntime-node` to 1.24.3, a release that publishes no `darwin/x64` binding; the Intel build therefore shipped an embedder whose native module could not load. ([Removal](../../archived/process/2026-10-02-desktop-drops-intel-mac-target.md), archived.)

## Decision

The Desktop target set is `mac-arm64`, `mac-x64`, `win-arm64`, `win-x64`, `linux-arm64`, and `linux-x64`. [`project-manager.ts`](../../../../apps/desktop/src/project-manager.ts) overrides `@huggingface/transformers>onnxruntime-node` to `1.23.2`, the newest release that still publishes a `darwin/x64` binding, through the same mechanism that already substitutes Transformers.js's `sharp`; `pnpm-workspace.yaml` pins the same release for repository and CLI installs. The seed prune rule names `1.23.2` and removes the other architecture's runtime for every platform, macOS included. Release automation builds `mac-x64` on `macos-15-intel`, signs it with the Developer ID identity and notarization credentials it already uses for `mac-arm64`, and merges the two macOS feeds into one `latest-mac.yml` so an Intel Mac never downloads the arm64 ZIP. The second, always-unsigned DMG variant was [dropped](2026-10-27-drop-unsigned-mac-release-targets.md).

The pin runs the installed Transformers.js against an older ONNX Runtime than it names, so both were measured. A fixed sentence embedded through `Xenova/all-MiniLM-L6-v2` (`q8`, cpu) returns the same vector under 1.24.3 and 1.23.2 on arm64, and under 1.23.2 the darwin/x64 result differs from arm64 by at most 3.4e-08 — float noise, not a changed embedding. A local `mac-x64 --prepare-only --unsigned` build produced the full release payload: 319 first-party and 10 vendored tarballs, the `darwin-x64` whisper worker and WhatsApp daemon, the Node.js runtime, the package set, and a seed whose lockfile resolves `onnxruntime-node@1.23.2` and whose 17 Mach-O objects are all x86_64.

## Alternatives considered

**Ship Intel macOS without local embeddings.** MemOS degrades rather than failing: capture stores null vectors and queues retries, and retrieval falls back to its keyword channels. This removes vector recall, the channel the ranked tiers are tuned around, and leaves the retry queue working forever.

**Vendor 1.23.2's `darwin/x64` binding files into 1.24.3.** A dependency patch keeps the newer runtime's JavaScript, at the cost of an unqualified native/JavaScript pair that a reviewer must re-derive on every ONNX Runtime bump.

**Wait for upstream.** Microsoft states it will not publish official x86_64 macOS builds, and the current release still ships `darwin/arm64` only.

**Keep the target removed.** Intel Macs then install no Desktop release at all, which the previous note accepted because no embedding runtime could load there.

## Consequences

- Every Transformers.js release keeps `onnxruntime-node` 1.23.2 through the override; an upgrade that requires newer ONNX Runtime APIs fails at install instead of at recall time.
- MemOS memory behaves the same on Intel macOS as on Apple Silicon, on the same release cadence.
- The release set holds a sixth target, and the macOS feed merge is what keeps its updates architecture-correct.
- Intel macOS is terminal: macOS 26 is its last release, Apple is retiring Rosetta, and GitHub retires its x86_64 macOS runners with the macOS 15 image in Fall 2027. This decision expires with that support.
- `minimumSystemVersion` stays `14.0`. Release 1.23.2's darwin libraries require 13.4, so a later change could lower it; nothing depends on that today.
