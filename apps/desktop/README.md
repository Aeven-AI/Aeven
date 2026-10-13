# Aeven Desktop

English | [中文](README.zh.md)

The desktop application is an Electron shell around the shared avn Web UI. Web and Electron reuse one GUI Host per Aeven home through kernel-owned startup exclusion and an authenticated HTTP endpoint. Electron starts a bundled upstream Node.js Host when none exists; quitting Electron detaches the shell while the Host continues serving browser clients and running work. Explicit Host shutdown or process death releases ownership. A desktop-started Host defaults to loopback port 3080.

An adopted Host owns its backend package graph. Desktop package updates require that Host to stop before validation and activation; adopting a running Host does not replace its packages. The first launcher determines the serving profile and capabilities. Both clients use the same Session and workspace state.

## Key technical decisions

| Decision | Why | Direct consequence |
|---|---|---|
| Release identity | The shell API, Web client, backend, and plugin graph are qualified as one combination; independent versions would create untested combinations and ambiguous update availability. | Electron and `@aeven/cli` always have the same exact version. A avn upgrade is a Desktop release, even when the shell code is unchanged. |
| Runtime | Electron's Node.js carries Electron patches, fuses, ABI, and lifecycle constraints, while system runtimes and package-manager state are uncontrolled. | avn runs under the bundled upstream Node.js and every package operation uses the bundled pnpm. Electron's Node.js, system Node.js, system pnpm, and user package-manager configuration are outside the execution path. |
| Package sources | The exact avn source build must be packageable before npm publication and install offline; plugins must remain ordinary user-selected npm packages. | The signed application carries locally packed first-party avn packages and an offline seed store. Desktop plugins remain ordinary npm dependencies resolved from the fixed Desktop registry. |
| Seed transport | Apple notarization inspects code inside archives; shipping every pnpm store file separately would also make the application signature inventory tens of thousands of cache entries, while one compressed archive would amplify small package changes. | macOS packaging signs every Mach-O CAS object, rewrites its pnpm hashes, and proves another offline install before assigning store files to 16 deterministic uncompressed tar shards. The outer installer compresses them, and differential updates can reuse unchanged shards. |
| State ownership | Sharing executable dependency graphs would let CLI and Desktop change each other's avn, Cordis, plugin, or native-module versions, while two desktop processes could race on the same profile. | Electron acquires its process-lifetime single-instance lock before any profile access and exclusively owns `$AVN_HOME/profiles/desktop` plus its package-manager state. CLI and Desktop share supported product data under `$AVN_HOME`, but never executable packages, plugin activation, lockfiles, or `node_modules`. |
| Transport | One serving Host owns Session execution and durable account state; both clients need its authenticated endpoint. | Electron and ordinary browsers use the same HTTP application. Node IPC carries child startup and explicit shutdown; the shell custom protocol serves shell-owned resources. |
| Activation | Dependency resolution, lifecycle scripts, native modules, and plugin startup can fail, and a process can stop during directory replacement. | Release and plugin changes install in staging, boot a complete backend health check, and replace the active profile only after success; a journal and one rollback profile cover interrupted replacement. |
| Updates | Independent shell and avn updates would recreate version splits, while unchanged shell blocks should not require a complete transfer. | The Electron shell, matching avn seed, Node.js, and pnpm form one signed update unit. Platform update artifacts may reuse unchanged blocks, but runtime version selection never splits from the Desktop release. |

The [Electron packaging and update Agent Note](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) owns the rationale, alternatives, security constraints, and release qualification requirements behind these decisions.

## Installation ownership

Electron owns the reserved profile at `$AVN_HOME/profiles/desktop`. Its manifest lists the built-in and installed plugin bundles in `avn.profile.bundles`, while its `node_modules` contains the exact `@aeven/cli` release, its matching private `@aeven/desktop-host`, and every desktop plugin. Keeping the Electron-only process entry and overlay in a private app package prevents Desktop implementation from becoming part of the public CLI package. The CLI cannot boot or mutate this profile. Electron always invokes its bundled Node.js and pnpm with the store at `$AVN_HOME/desktop/pnpm/store`; it never uses system pnpm or the caller's npm/pnpm configuration.

The main avn renderer receives only the desktop protocol marker. The separate plugin window receives structured list, install, remove, update, and update-check operations; neither renderer receives filesystem access, raw Electron IPC, a shell, or arbitrary pnpm arguments.

Link clicks and right-click menus are split the same way. The window opens no browser of its own: an address its content asks to open is reported to the page (`external-links.ts`), which opens it in the sidebar's browser, in the Host's Chromium that the agent drives, or in the system browser, and a page that never subscribes keeps the operating-system handoff. A right-click menu is drawn in this process but described by the page (`app-menu.ts`, `context-menu.ts`), because the page knows what its own links and file names mean: the shell validates the rows, pops the native menu, and reports the chosen row back. The sidebar address bar and agent navigation accept HTTP(S) and `file:` URLs; local pages retain the guest's sandbox, context isolation, and disabled Node integration.

Electron chooses typed English or Chinese shell copy from its application locale and falls back to English. Menus, native dialogs, and the plugin-management renderer use the same locale payload; the repository Client UI i18n gate checks these desktop sources.

### Seed installation

The packaged seed is an installation kit, not a ready-to-run `node_modules` tree. Its generated pnpm workspace explicitly allows required native dependency builds and denies onnxruntime-node's CUDA provider download, matching the repository policy. Its `overrides` remove dependency edges the Host never loads, namely the browser libraries the web frontend `dist` and plugin client bundles already contain; Transformers.js shares the attachment reader's `sharp` release. Packaging creates the lockfile, materializes the production graph online with lifecycle scripts disabled, prunes third-party files the runtime never loads from the store, deletes `node_modules` and every temporary pnpm cache, config, and state directory, and proves one complete installation offline from the final store alone with the private Desktop Host entry and overlay present. A macOS build stages every Mach-O object from pnpm's content-addressed store, Developer ID signs at most four independent copies concurrently, and updates the affected SHA-512 index records only after all signers succeed. Another offline install proves the rewritten store before sharding; preparation then extracts the final archives and verifies every embedded signature. The signed seed retains the release identity, local first-party tarballs and their descriptor, project metadata, lockfile, integrity inventory, and pnpm store content required to repeat that installation on the user's machine.

| Seed content | Writable destination or use |
|---|---|
| `integrity.json` and `desktop-packages.json` | Verify every inventoried seed file, local tarball hash, and the bound avn and Desktop Host versions before package state changes. |
| `store-archives.json` and `store-archives/*.tar` | Validate the deterministic uncompressed shards, extract them into a unique Desktop staging directory, replace matching immutable store files, and transactionally merge pnpm's versioned SQLite package index into `$AVN_HOME/desktop/pnpm/store` without removing packages already downloaded for Desktop plugins. |
| Project metadata and `desktop-packages/` | Copy into a unique `$AVN_HOME/desktop/staging/<transaction-id>/profile` project. |
| Lockfile and local package mappings | Drive the bundled pnpm installation without resolving a packaged core name from npm. |

Startup installs or reconciles the seed as one serialized transaction:

1. Recover an interrupted activation journal, verify the complete seed inventory and local package set, and require the seed version to equal Electron's application version.
2. If the active profile already contains that release plus the matching avn and Desktop Host versions, verify its local package set and reuse it without reinstalling.
3. Otherwise validate every archive entry, extract all store shards into a temporary Desktop-owned staging directory, merge the package files and SQLite package-index records into the private store, create a staging profile, and run `pnpm install --offline --frozen-lockfile --trust-lockfile` through the bundled Node.js and pnpm. Seed records replace matching index keys while plugin-only records remain available.
4. During an Electron upgrade, read every plugin name and exact version from the old active profile and add those versions to staging with `--offline` from existing Desktop pnpm state. A first installation has no plugin-restore step.
5. Stop the active backend, boot and stop the complete staged backend as a health check, then restart the active backend before activation. This serialization prevents two desktop backends from sharing `$AVN_HOME`; installation or plugin incompatibility before activation deletes staging and leaves the active profile unchanged.
6. Persist each next activation phase before its directory move, move the active profile to `$AVN_HOME/desktop/rollback/profile`, and move staging into `$AVN_HOME/profiles/desktop`. Recovery combines the journal with the actual profile, rollback, and staging directories, so interruption in either write-to-move gap restores or retains a complete profile.

GUI plugin mutations use the same staging, health-check, activation, and rollback path after installing registry packages into the shared Desktop pnpm store.

The process-lifetime Electron lock is the primary desktop owner. The transaction lock is depth defense: it records Electron while preparing local state, records the spawned pnpm worker while that worker can still write, and returns ownership to Electron after the worker exits. A later process cannot treat a live orphaned worker as a stale transaction.

## Develop

`dev:desktop` builds the current Host, client bundles, Web frontend, and Electron shell, projects the built CLI and private Desktop Host packages with their workspace dependencies into a disposable desktop npm project, and launches Electron without downloading the packaged Node.js runtime or resolving avn from npm:

```sh
pnpm run dev:desktop
```

Development uses the reader's Aeven home, so the development app shows the same sessions and workspaces as the CLI and Web; when an `avn web` Host already serves that home, the shell adopts it instead of starting a second Host on it. A Host claims the home's lease when it starts booting, so a shell launched during that boot waits up to 30 seconds for the leased Host to advertise its URL and answer; when the shell starts its own Host instead, it prints the reason. The disposable npm project lives at `apps/desktop/.desktop-build/development/project`, and Electron browser data lives at `apps/desktop/.desktop-build/development/electron-user-data`. An explicit `AVN_HOME` selects another Aeven home. Renderer DevTools opens automatically; Main, Renderer, and avn Host debugging listen on ports 9229, 9222, and 9230. `AVN_DESKTOP_MAIN_INSPECT_PORT`, `AVN_DESKTOP_RENDERER_DEBUG_PORT`, and `AVN_DESKTOP_HOST_INSPECT_PORT` replace those ports, while `AVN_DESKTOP_OPEN_DEVTOOLS=0` keeps the detached Renderer tools closed.

After an explicit build, `start:desktop` reconstructs the disposable project and launches the existing artifacts without building again:

```sh
pnpm run start:desktop
```

Workspace development runs the current CLI and private Desktop Host packages under the invoking Node.js and disables desktop package mutations. Its explicitly linked disposable profile is the only mode allowed to resolve bundles outside its own directory. Use an unpacked application to exercise the bundled Node.js, bundled pnpm, release seed, plugin installation, staging, and rollback paths.

## Package

The normal packaging path is one complete command. It performs release preparation before creating the host platform's installers and update metadata. Every target requires a reverse-DNS `AVN_DESKTOP_APP_ID`. macOS targets additionally require the electron-builder certificate qualifier in `AVN_DESKTOP_MACOS_SIGNING_IDENTITY`, its 10-character Apple Team ID in `AVN_DESKTOP_MACOS_TEAM_ID`, and one complete notarytool credential strategy. The App Store Connect API-key strategy uses these variables:

```sh
export AVN_DESKTOP_APP_ID='<reverse-DNS application ID>'
export AVN_DESKTOP_MACOS_SIGNING_IDENTITY='<certificate name without the Developer ID Application prefix>'
export AVN_DESKTOP_MACOS_TEAM_ID='<10-character Apple Team ID>'
export APPLE_API_KEY='<absolute path to the .p8 file>'
export APPLE_API_KEY_ID='<App Store Connect API Key ID>'
export APPLE_API_ISSUER='<App Store Connect issuer UUID>'
```

`prepare:desktop` is not a prerequisite:

```sh
pnpm run package:desktop
```

Release automation uses fixed target commands so runtime preparation, seed installation, and electron-builder receive the same platform and architecture:

```sh
pnpm run package:desktop:mac:arm64
pnpm run package:desktop:win:arm64
pnpm run package:desktop:win:x64
```

The macOS arm64 command requires Apple Silicon; Intel Macs are not a Desktop target because onnxruntime-node, which MemOS embeddings require, publishes no Intel macOS binary. Each Windows command requires a Windows host whose Node.js process has the target architecture: arm64 Node.js for `win:arm64` and x64 Node.js for `win:x64`. Windows on ARM also builds `win:x64`, running the x64 Node.js runtime and Whisper worker under emulation; it needs Visual Studio's x64 build tools (`MSVC … x64/x86 build tools`) alongside the ARM64 ones. The Linux arm64 and x64 commands require a Linux host with the same architecture.

Each target owns its packed package inputs, prepared runtime, package set, seed, pnpm preparation state, unpacked application, update metadata, and final artifacts under `apps/desktop/.desktop-build/targets/<target>/`. The Node.js archive cache remains shared under `.desktop-build/downloads` because every archive name includes its version, platform, and architecture and is verified before extraction. A target build never consumes another target's mutable preparation state.

### Icons

`resources/` holds the application icons and `installer/assets/` the NSIS sidebar; each raster is rendered from the SVG beside it at its own edge length. macOS uses `icon-macos.icns` for the application and the mounted DMG volume, Windows uses `icon-windows.ico` for the executable, installer, and uninstaller, and Linux uses `icon-macos.png`. `installer-sidebar.bmp` fills the welcome and finish pages of the Windows installer and uninstaller. `tray-windows.ico` (16–64 px) and the macOS menu bar template `trayTemplate.png` (16 px, with `@2x`) are not packaged until the application shows a tray icon.

### Linux packages

Linux targets produce an AppImage and a `.deb` without code signing. Build on a matching Linux host, or from any Docker host with the `:docker` command:

```sh
pnpm run package:desktop:linux:arm64:docker
pnpm run package:desktop:linux:x64:docker
```

The Docker command builds `linux-builder.Dockerfile` for the target architecture, streams the files git would commit together with `.git` into a container, runs the Linux package command there after a fresh install, and copies the top-level artifacts into `apps/desktop/.desktop-build/targets/<target>/artifacts`. It forwards `AVN_DESKTOP_APP_ID` and keeps the pnpm store in the `avn-desktop-linux-pnpm-store` volume. A target whose architecture differs from the Docker host runs under emulation. The `.deb` installs Chromium's sandbox helper; distributions that restrict unprivileged user namespaces, such as Ubuntu 24.04, may refuse to start the AppImage without it. The release workflow does not build Linux targets.

### Publish a release

Releases are GitHub Releases of `Aeven-AI/Aeven`, built and published by `.github/workflows/release-desktop.yml`. Push a tag that matches the root `package.json` version, such as `v0.1.2-alpha.5`, or start the workflow by hand. It builds `win-x64` on `windows-latest`, `win-arm64` on `windows-11-arm`, and `mac-arm64` on `macos-15`, then publishes the installers, the macOS ZIP, the blockmaps, and the update feeds as one release; a version with a prerelease identifier is published as a prerelease. The two Windows feeds are merged into one file that lists both installers (`scripts/merge-update-manifests.ts`), and electron-updater picks the installer whose name carries the running architecture.

Each target signs when its secrets exist and builds with `--unsigned` otherwise, so a release always completes. Windows signing uses Azure Trusted Signing (below); macOS signing needs `MACOS_CERTIFICATE_P12` (the Developer ID Application certificate and key as base64), `MACOS_CERTIFICATE_PASSWORD`, `AVN_DESKTOP_MACOS_SIGNING_IDENTITY`, `AVN_DESKTOP_MACOS_TEAM_ID`, and an App Store Connect API key as `APPLE_API_KEY_P8` (the `.p8` contents), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. The `AVN_DESKTOP_APP_ID` repository variable sets the application id and defaults to `com.aeven.desktop`. Locally, `AVN_DESKTOP_APP_ID` is the one packaging setting read from the repository root `.env` when the shell does not set it.

The macOS configuration uses the required release environment instead of accepting whichever certificate appears first in a keychain. It rejects empty values, a malformed Team ID, a signing identity that includes electron-builder's unsupported `Developer ID Application:` prefix, and incomplete notarization credentials. macOS packaging requires the configured identity and its private key. Seed preparation applies that identity, a secure timestamp, and hardened runtime to every embedded Mach-O file; after signing the application, a deep strict check rejects any other leaf authority or Team ID before artifact creation. Electron-builder notarizes and staples the application before packaging and signs the DMG. The DMG artifact-completion hook then notarizes and staples it before requiring its exact identity, ticket, and Gatekeeper acceptance; only after the hook succeeds can electron-builder publish the file. The private key can come from the login keychain or electron-builder's standard `CSC_LINK` input; ambient `CSC_NAME` and certificate discovery order do not select the release owner. Notary credentials may instead use electron-builder's complete Apple ID or keychain-profile strategy. The two macOS identity variables are also required when repeating the application check manually with `pnpm --dir apps/desktop run verify:mac-signature -- <path-to-app>`.

### Windows signing

A signed Windows build signs the executables, the installer, and its uninstaller through Azure Trusted Signing with electron-builder's `win.azureSignOptions`. It reads `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, and `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`, and the Azure SDK authenticates the service principal from `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`. No certificate or token lives on the build host. Packaging withholds these fields from build and seed-preparation subprocesses and gives them to electron-builder alone; without them a signed Windows build stops at its preflight check, and `--unsigned` builds without signing.

Create a runnable application directory instead of an installer by using the matching `:dir` command, such as:

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:mac:arm64:dir
```

Build artifacts without an Apple Developer ID or a Windows code-signing certificate by using the matching `:unsigned` command:

```sh
pnpm run package:desktop:mac:arm64:unsigned
pnpm run package:desktop:win:arm64:unsigned
pnpm run package:desktop:win:x64:unsigned
```

An unsigned build skips seed signing, application and installer signing, macOS notarization, and the DMG notarization hook. On macOS, electron-builder ad-hoc signs the application without hardened runtime because Apple Silicon does not launch code that has no signature; Gatekeeper blocks a downloaded copy until the tester removes its quarantine attribute. Windows SmartScreen warns before an unsigned installer runs. Each target still requires its own host platform and `AVN_DESKTOP_APP_ID`.

Unsigned artifacts carry an `-unsigned` suffix, such as `aeven-<version>-win-arm64-unsigned.exe`, so they cannot be mistaken for release installers in the shared artifacts directory.

Every package command first checks that the desktop and avn versions match, builds the electron-builder configuration for the target (application ID, macOS signing and notarization settings, Windows Azure Trusted Signing fields), and runs `tar`, `npm`, Go and CMake, reporting every problem before any build step starts. A preparation-only run skips the signing settings. Add `--check` to stop after these checks:

```sh
pnpm run package:desktop:win:arm64:unsigned --check
```

To inspect or troubleshoot the prepared host-target resources without invoking electron-builder, stop the same pipeline after preparation:

```sh
pnpm run prepare:desktop
```

This diagnostic command is an alternative stopping point, not the first half of a two-command build. A later `package:desktop*` command repeats the official build and preparation so it cannot consume stale avn packages, runtime files, or seed content.

Every package command performs the official repository build, packs the avn and vendored package families, locally packs the private Desktop Host package, and packs the Landlock entry before preparing release resources. `prepare:packages` selects the union of the first-party production closures rooted at `@aeven/cli` and `@aeven/desktop-host`, verifies that the private Host tarball contains `lib/index.js` and `config/desktop.cordis.patch.yml`, copies the selected tarballs into the seed input, and records their sizes and SHA-512 integrity. The Host package is never published to npm; its `files` manifest contains only that runtime entry and overlay. Public package tarballs remain the official `pnpm pack` outputs governed by each package's publication manifest, so Desktop adds no second filter, retains published declarations such as `lib/types`, and neither strips nor adds source maps independently. Registry packages instead lose the files no Desktop code path loads before the seed is sharded: source maps, TypeScript declarations and sources, Windows debug symbols, release-history Markdown, prebuilt binaries for other platforms and architectures, and the pinned per-package entries in `scripts/seed-store-prune.ts` (unused Tesseract cores, the unused Tesseract language model, pdf.js browser builds, and node-pty's ConPTY payload outside Windows). Pruning rewrites each affected SHA-512 index record and deletes content no record references, so the offline installation proof, macOS signing, and `integrity.json` all cover the pruned store; a pinned rule that removes nothing fails the build until someone reviews it against the upgraded package. Plugin installations that reuse a seeded registry package get the pruned file set. The avn release bump updates both private Desktop manifests together with the root and publishable workspaces; packaging also requires the root avn package, Desktop Host package, and Electron package to have the same version. Neither avn nor the private Host needs to be published to npm before the Desktop application is built. `prepare:runtime` downloads Node.js 24.17.0 from the official Node.js release service, verifies its SHA-256 entry before extraction, and executes the prepared target binary on a compatible build host to verify its reported version. It copies the pnpm version declared by the desktop package and records both runtime versions in the release seed. `prepare:seed` runs that target Node.js and bundled pnpm, so platform- and CPU-filtered optional dependencies make the pnpm store and seed target-specific. It generates local core-package mappings, disables the global virtual store, materializes external production dependencies from npm without lifecycle scripts, deletes `node_modules` and all temporary pnpm cache, config, and state, proves the complete graph installs offline with the private Host entry and overlay, performs the macOS rewrite when applicable, proves the rewritten store with another offline installation, removes temporary pnpm project registrations, and replaces the loose store with 16 deterministic uncompressed tar shards. It extracts those final shards and verifies every embedded macOS signature before inventory generation. Later GUI plugin operations retain the local core mappings while resolving plugin packages and their external dependencies from the fixed Desktop npm registry. `electron-builder` emits each target's platform artifacts under `apps/desktop/.desktop-build/targets/<target>/artifacts`; a later version keeps differently named immutable installers and blockmaps while replacing that target's unpacked application, diagnostics, completion record, and channel metadata.

An unpacked artifact contains four independent size contributors: Electron, reduced to the Chromium locale packs for the client's `en` and `zh` locales, the offline seed store shards and local avn tarballs, the upstream Node.js and pnpm runtime, and the small shell application. The shards are uncompressed so the outer DMG, ZIP, or NSIS compressor and differential updater can operate on stable ranges. Filesystem size is not installer download size, so measure both separately. First packaged startup also extracts the seed store into `$AVN_HOME/desktop/pnpm/store` before installing the writable profile, so release qualification must measure both application and Harness-home disk use.

## Updates

A packaged application checks its target-specific release stream ten seconds after the main window opens; the localized **Check for Updates…** menu item triggers the same check manually. An available release opens one native confirmation dialog. Accepting it waits for an in-flight check, downloads and verifies the signed Desktop release, stops the avn child, and hands installation plus restart to electron-updater. The next launch reconciles the version-bound seed before reopening the product window.

Electron-builder emits GitHub-provider channel metadata (`latest.yml`, or `alpha.yml` and the like for a prerelease), and the packaged updater reads the newest release of `Aeven-AI/Aeven`. NSIS differential packages and the macOS ZIP target allow electron-updater to reuse unchanged blocks; the manually installed DMG is notarized without a blockmap because it is not a macOS updater payload. The seed and shell still form one Desktop release, signed when its platform signing is configured.

## Low-level development overrides

`AVN_DESKTOP_NODE_BINARY`, `AVN_DESKTOP_PNPM_ENTRY`, `AVN_DESKTOP_SEED_DIR`, and `AVN_DESKTOP_DEV_PROJECT_DIR` select explicit resources for an unpackaged Electron process. Packaged applications ignore these variables and resolve signed resources from `process.resourcesPath`.

## Known limitations

- The Web "Open In..." action is disabled in Desktop because its host plugin requires HTTP routes; Desktop does not provide a `webServer`.
- Release signing, notarization, update hosting, and previous-version installed-artifact qualification require the production release environment.
- Desktop plugins with dependency lifecycle scripts are rejected unless their package appears in the desktop project's reviewed `allowBuilds` policy.
- The desktop shell shares sessions, settings, credentials, workspaces, and storage under `$AVN_HOME` with CLI avn, while executable packages, plugin activation, lockfiles, and package-manager state remain separate.
