# Agent Note: The desktop application bundles ffmpeg

Status: implemented

English | [中文](2026-10-18-desktop-bundles-ffmpeg.zh.md)

## Problem

Video and audio were opaque to Aeven. `packages/attachment/attachment-local` normalises and measures images through sharp and has no video path, so a video attachment arrives with no duration, dimensions, or poster. The WhatsApp daemon, the one consumer that already needs a converter, shells out to whichever `ffmpeg` sits on `PATH` (`native/whatsapp-mcp/source/internal/media/audio.go`), so voice notes fail on every machine without a system install.

## Decision

`native/ffmpeg` owns the executable, beside `native/whisper-cpp` and `native/whatsapp-mcp`. `source.json` pins the upstream 9.0.2 release tarball and its SHA-256; `scripts/build.ts` verifies that archive, builds out of tree per target, strips the result, and stages it into `packages/<platform>-<arch>/bin`. Six platform packages mirror the WhatsApp daemon's layout, and `@aeven/account-integrations` declares them as optional dependencies, resolves the one matching the host, and prepends its directory to the WhatsApp daemon's `PATH` so the daemon's `exec.LookPath("ffmpeg")` finds the bundled copy instead of a system one.

The build is LGPL-only: `--disable-gpl --disable-nonfree --disable-version3 --disable-autodetect`, with zlib, libopus, and on Linux OpenH264 as the only external libraries, all permissively licensed. libopus is compiled statically from its own pinned source on macOS and Linux and taken from the Windows toolchain's own static package, and OpenH264 is compiled statically from its pinned source on Linux, so the executables carry no system or Homebrew dependency. H.264 export comes from VideoToolbox on macOS, Media Foundation on Windows, and VAAPI or OpenH264 on Linux, never libx264. `--disable-network` keeps remote protocols out; the only device is the `lavfi` virtual input, so capture devices stay out of binaries that only read local files. `--disable-programs --enable-ffmpeg --enable-ffprobe` builds the two CLIs alone.

ffprobe ships beside ffmpeg in each platform package, and the build enables `lavfi`, Media Foundation, and OpenH264, because motion films need them; [Motion films](../feature/2026-11-06-motion-films.md) records why.

Building from source rather than pinning a prebuilt LGPL static binary is a size decision. The maintained prebuilts carry their full autodetected dependency set — BtbN's LGPL Windows and Linux executables are 76.9–135.9 MB and pproenca's LGPL macOS executables 33.7–46.0 MB — while this configure line yields 21.0 MB on darwin-arm64, 9.9 MB compressed, with the codecs Aeven needs.

Windows follows MSYS2's own ffmpeg recipe: `--target-os=mingw32`, `--arch`, and an explicit `--cc`, with no cross prefix, because a cross prefix makes configure look for a prefixed `pkg-config` and disable pkg-config entirely when it finds none. macOS signs both executables before packing through `signMacOSPackageExecutables`, the same step the whisper worker and the WhatsApp daemon take. Windows enables Media Foundation, whose encoder loads `mfplat.dll` only when it opens, so `ffmpeg.exe` still starts on N editions without the Media Feature Pack.

## Alternatives considered

**Download on first use, like the whisper models.** Those models are the only downloaded part of local speech; the worker itself ships. Posters and probes run at render time and would race a first-use download, and the shared artifact-cache seam that would make the download honest is worth building when a second downloaded asset appears.

**Ship prebuilt third-party binaries.** Cheaper to wire, but every maintained LGPL option is 1.6–6.5× larger, no single project covers all six targets, and the build flags become someone else's decision.

**Expose a generic "run ffmpeg with these arguments" tool to the model.** Deferred: it hands the model unbounded CPU and a filesystem reach that would need its own sandbox.

## Consequences

Every installer grows by about 43 MB installed on macOS for ffmpeg and ffprobe together; the Linux and Windows targets are measured when their runners build them. Adding a codec means editing the configure line and rebuilding all six targets. Target runners need a zlib development package, pkg-config, and nasm for the x86_64 assembly kernels, and Linux runners also need libva and a C++ compiler for OpenH264; Windows builds through MSYS2 bash, because `configure` is a POSIX script, and its mingw64 and clangarm64 toolchains supply the compiler, binutils, and the static libopus. Without nasm the build still succeeds, with a decode-speed warning. LGPL obligations match any bundled LGPL executable: ship the licence text, state the configure line, and offer the corresponding source, which `source.json` pins exactly.
