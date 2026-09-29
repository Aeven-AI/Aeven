# Agent Note: The Office reader ships its engine; document readers have no setup

Status: implemented

English | [中文](2026-09-29-bundled-office-reader.zh.md)

## Problem

`@aeven/document-extract-office` ran a stock LibreOffice. When none was installed, a Settings → Documents tab offered a download of about 300 MB (installed size about 800 MB). Readers therefore had a readiness state that the registry published, the `documents` Remote streamed, and the tab rendered. End users had to understand and act on that setup before legacy Office attachments worked.

## Decision

**The engine is an npm dependency.** The Office reader depends on an exact `@deepseek-ai/libreoffice-kit` version. The kit declares one platform engine per target as a platform-filtered optional dependency (147–190 MB unpacked), the same package DeepSeek Harness bundles. The Desktop seed's pnpm install selects the target's engine. The reader creates one converter factory at startup, so a missing engine fails the plugin at load. It reads `.doc`, `.docx`, and `.odt` as text and converts `.xls`, `.xlsx`, `.ods`, `.ppt`, `.pptx`, and `.odp` to PDF for the registry's PDF readers. It runs after the built-in readers at priority 10.

**Document readers have no setup.** `DocumentPreparation`, provider readiness, the `follow`/`prepare`/`cancelPreparation` operations, the `@aeven/api-document-extract` package, and the Settings tab are removed. The registry is a static set of providers; `accepted()` feeds the composer's file intake.

**Desktop signing grants JIT to the engine.** macOS seed signing gives `com.apple.security.cs.allow-jit` to `bin/libreoffice-kit` in `@deepseek-ai/libreoffice-kit-darwin-*`, as DeepSeek Harness does. Every other Mach-O file keeps the plain hardened runtime. The notices generator accepts MPL-2.0 only for the kit's exact package identities.

## Alternatives considered

**Bundle the stock LibreOffice application.** It adds about 800 MB installed, and trimming it means editing and re-signing a third-party bundle. The kit is a prebuilt, qualified engine that already carries its source and license materials.

**Keep an on-demand download without a Settings tab.** A first-use download still blocks the first legacy attachment on a large transfer and needs progress, failure, and retry UI somewhere. Shipping the engine removes that state.

## Consequences

Pages and Keynote files are no longer readable: the kit's engine does not import them, and the registry rejects them as an unsupported format. Each Desktop target grows by its engine size. Windows needs the Microsoft Visual C++ v14 runtime, which the kit does not bundle. Linux installs the kit's WASM engine.
