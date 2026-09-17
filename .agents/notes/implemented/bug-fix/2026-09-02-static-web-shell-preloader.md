# Agent Note: Static Web Shell Preloader

Status: implemented

English | [中文](2026-09-02-static-web-shell-preloader.zh.md)

## Problem

The Web application must cover its page with a styled loading visual while the entry module and client plugin bundles load. A preloader contributed by a Host plugin is absent from the `apps/web` source document and standalone worker-preview artifact, and assigning its CSS and markup to the dynamic plugin composition makes the earliest visual depend on the system it is meant to cover. A render-blocking linked stylesheet still holds first paint: Vite folds that file into the combined application CSS, Host head injections place a classic bootstrap script before the body, and the browser keeps a white page until those payloads arrive.

## Decision

`apps/web/index.html` contains the preloader markup before the application root and links `src/preloader.css` as the source stylesheet. `inlinePreloaderCss` replaces that link with a `<style>` element containing the file, so first paint does not wait on a stylesheet request. `destageBuiltStylesheets` loads every remaining emitted stylesheet as `rel="preload" as="style"` and promotes it on load, so vendor and application CSS cannot hold the first paint. Head `script-src` injections render with `defer`, keeping bootstrap-before-entry document order with the deferred Vite module tag without delaying body parse.

The preloader stylesheet owns only first-paint layout, its light and dark fallback colors, and its fade and spinner animations. ui-theme's Host half continues to inject the durable preference bootstrap immediately after the opening body tag. That script applies `body[data-ds-dark-theme]` before the parser reaches the static preloader, while browser-side ThemeRuntime remains authoritative after plugin activation.

`avn-client-web/src/preloader.ts` controls the existing element. A successful Web boot fades it for 400ms after the first sidebar lists and selected conversation history have arrived, then removes it from layout; a boot failure hides it immediately before `BootPage` renders the diagnostic. `BootPage` stays visually silent while the static element owns loading and retains its own progress visual for documents without the Web shell. The worker preview hides the static element for its source chooser, then restores it while the selected image and plugin tree boot. The [shell-data wait](2026-09-08-web-preloader-waits-for-shell-data.md) owns that successful-boot timing.

## Verification

Client unit tests cover animated dismissal, immediate hide and restore, cancellation, an absent static element, and the BootPage failure fallback. The built-artifact test requires the markup before the application root, inlined `#avn-preloader` rules in the document `<style>`, and remaining stylesheets present only as preload-plus-onload tags with a `noscript` stylesheet fallback. Head `script-src` rows render with `defer`; body `script-src` rows do not. The real Chromium theme scenario holds extracted stylesheets and application plugin requests open and asserts the visible static preloader uses the persisted dark preference from the inlined CSS. The worker-preview acceptance continues to cover its source chooser and complete boot.

## Alternatives considered

**Keep the visual in Host index injections.** This leaves the source and static preview documents without their own first-paint visual and assigns shell presentation to an optional composed plugin.

**Create the visual from the entry module.** The browser cannot display markup or styling created by that module until it has downloaded and executed JavaScript, preserving the white-page interval this decision removes.

**Keep a render-blocking linked stylesheet, with or without a final-href preload.** Vite combines the source file with every other CSS import, so first paint waits for the full vendor and application stylesheets. A separate unbundled file still costs a round trip before the overlay can paint.

**Keep the bootstrap combo parser-blocking in the head.** The Vite entry is already a deferred module script; `defer` on the head `script-src` tag preserves bootstrap-before-entry order without delaying body parse.

**Move persisted theme resolution into static HTML.** Static HTML cannot embed the Host setting. The existing synchronous Host bootstrap supplies the preference without duplicating ThemeRuntime semantics in the shell.

## Consequences

The application has styled loading content from the document bytes, and normal boot no longer exposes an intermediate empty application root or a white page waiting on CSS. The shell adds a small static markup block and inlines its first-paint CSS. Remaining CSS is a non-blocking fetch that completes while plugins load. The visual and lifecycle controller share the fixed `avn-preloader` id, class names, and 400ms fade duration, so changes to those values require corresponding HTML, CSS, controller, and artifact-test updates. Compositions that do not serve `apps/web` retain the framework-free BootPage fallback.
