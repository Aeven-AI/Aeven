# Agent Note: Workspace files follow the account

Status: proposed

English | [中文](2026-11-03-workspace-file-sync.zh.md)

## Problem

[Account sync](2026-10-27-account-sync-network.md) makes conversations, memory, settings, and the workspace list the same on every device of an account, but not the files a workspace points at. `@aeven/workspace` publishes a workspace's title, order, and owner through the account's `workspaces` document and never its directory ([`sync.ts`](../../../../packages/workspace/workspace/src/sync.ts)). A device that receives the workspace stores it as `kind: 'remote'` ([`index.ts`](../../../../packages/workspace/workspace/src/index.ts)), and a session imported into it resolves no directory until this device binds one ([local-binding Agent Note](../../implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.md)).

The only way to bind it today is the sidebar's **Link workspace** action, which opens a folder picker ([`ui-workspace` `bindWorkspace`](../../../../packages/client/ui-workspace/src/client/index.ts)); until then the New Session hero shows its generic **Choose workspace** chip. That assumes the user already copied the files to the second machine and can find them, and nothing checks that the chosen folder is the same project. A user who signs in on a new laptop sees their conversations and memory but cannot continue any task that touches files, which is most of them.

Workspaces range from a folder of documents to a full repository with a `.git` directory, gigabytes of dependencies, build output, secrets that Git ignores, and files that only make sense on one machine. A single byte-copy mechanism serves the first well and the second badly: two machines that both run Git, an editor, and an agent against one replicated `.git` directory race on `index.lock`, packed refs, and the object store, and replicating `node_modules` or `target/` costs bandwidth for files each machine regenerates.

Regular users must not have to understand any of this. The product promise is that a workspace on any signed-in computer already has its files, its secrets, and its dependencies when the user opens it, with no setup, no questions in the normal case, and no noticeable cost to battery or responsiveness.

## Proposal

Every workspace carries a synchronized description of where its files come from, and every device of the account materializes them without the user choosing how. Two transports cover the two kinds of workspace, and the device picks one by inspecting the folder, never by asking:

| Workspace | Detected by | Transport | What crosses devices |
|---|---|---|---|
| **Repository** | The bound folder is a Git work tree | Git: clone from the remote, or from another device or the cloud copy when the remote is unreachable; work-state checkpoints carry uncommitted and unpushed work | Remote URL without credentials, branch, location hint, encrypted work-state checkpoints, encrypted environment files |
| **Folder** | Anything else | [Syncthing](https://github.com/syncthing/syncthing), peer to peer between the account's own devices plus an encrypted cloud copy on Aeven's servers | Folder id, size and file count, location hint, the folder contents encrypted end to end |
| **Chats only** | The user removed the files from this device, or declined a download that would not fit | None | Nothing beyond what account sync already carries |

Four defaults make the feature work out of the box:

- **Ready before it is opened.** Workspaces used on any device in the last `prefetch.recentDays` (default 30) arrive in the background within a disk budget; others arrive on first open.
- **Available while the other computer sleeps.** An encrypted copy of every folder workspace on Aeven's servers, which the servers cannot read, serves files when no other device is online ([cloud copy](#cloud-copy)).
- **Nothing to set up on the new computer.** Git is bundled when the system lacks it, environment files that Git ignores travel encrypted, and dependencies install in the background ([fresh computer](#a-fresh-computer)).
- **Work never waits for the whole folder.** A file the user or the agent opens is fetched first; only commands that read the whole tree wait ([on-demand files](#on-demand-files)).

### UX principles

1. **No mode choice.** The device classifies a workspace by inspecting its folder. Neither "repository" nor "folder" appears in the UI as a choice.
2. **No location question.** The device derives the local folder from the location hint and the placement rules below, shows it after the fact, and offers **Use a different folder…** from the workspace menu.
3. **One question, only when the disk cannot take it.** The only confirmation in the normal flow is a download that exceeds the disk budget. Credential failures, two versions of a file, sleeping devices, and missing tools are resolved automatically or reported as status, never as a modal.
4. **Nothing is lost silently.** Files deleted or replaced by another device stay recoverable for a retention period, a work-state checkpoint never overwrites local changes without first saving them, an environment file never overwrites a local one, and conflicting edits keep both versions.
5. **No transport vocabulary.** User-visible copy never says Syncthing, device id, folder id, bundle, stash, relay, checkpoint, or conflict. It says *files*, *your MacBook Pro*, *getting files*, *two versions*, *preparing*. All copy goes through the locale dictionaries ([locale-owned UI copy](../../implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
6. **Never in the way.** Background work runs at low priority, pauses its bulk transfers on battery and metered networks, and never delays the composer, a model request, or a file the user opened.

### What the user sees

#### Device A: creating a workspace

Nothing changes. Binding a folder publishes the file descriptor in the background: the device detects whether the folder is a Git work tree, records the remote URL (credentials stripped) and branch for a repository, and records size and file count for a folder. Once the account has a second device, device A indexes its folder workspaces in the background on AC power and uploads them to the cloud copy, so another device can start receiving without waiting for a scan ([scheduling](#indexing-and-transfer-scheduling)).

#### Device B: first sign-in

Account sync's existing progress runs. Workspaces from other devices appear in the sidebar with their normal titles, in account order. Recently used workspaces start arriving in the background at once, most recently used first; their rows show a thin progress line and nothing else. Workspaces outside the prefetch set show a small download glyph whose tooltip says "Files arrive when you open this workspace."

#### Device B: opening a folder workspace

1. The user clicks the workspace or one of its conversations. If prefetch already finished, the files are there and nothing else happens.
2. Otherwise the device picks the local folder ([placement](#placement)) and receives from every source that has the files at once: device A, other devices of the account, and the cloud copy, preferring the local network. The row and the conversation header show "Getting files · 34%". The Files sidebar lists the whole folder immediately; files not yet here open as soon as they arrive, ahead of the rest.
3. If the folder would exceed the disk budget ([configuration](#configuration)), one inline card asks first: "Notes is 14 GB and this computer has 20 GB free. Download it?" with **Download** and **Just the chats**. "Just the chats" marks the workspace chats-only on this device; the workspace menu offers **Get files** later.
4. When complete, the indicator disappears. The workspace is now an ordinary bound folder that stays in sync.

#### Device B: opening a repository workspace

1. The user clicks the workspace. If prefetch already finished, it is ready.
2. If a checkout of the same remote already exists in a likely place ([checkout discovery](#checkout-discovery)), the device binds it and shows a toast: "Using ~/code/aeven". No download happens.
3. Otherwise the device clones the remote into the placed folder, with submodules and Git LFS objects: "Getting aeven · 60%". It uses this computer's own Git credentials (SSH agent, credential helper, Git Credential Manager), and the bundled Git when the system has none.
4. If cloning fails for authentication or network reasons, the device copies the repository from another device or the cloud copy instead ([peer clone](#peer-clone)) and sets `origin` to the remote URL. A notice says "Copied from your MacBook Pro. To push from this computer, sign in to github.com." No dialog appears.
5. The device restores the workspace's environment files and applies the newest work-state checkpoint, so the user's uncommitted changes from device A are present.
6. If the repository has a recognized lockfile and its toolchain is installed, the device installs dependencies in the background: "Preparing aeven…". The workspace is usable meanwhile.

#### Continuing a conversation on another device

Session handoff already moves the runner lease between devices ([`@aeven/session-handoff`](../../../../packages/session/session-handoff/README.md)). File sync makes the claiming device's files match the previous runner's before the next turn acts:

- **Previous runner online**: the claiming device asks it for a fresh work-state checkpoint (repositories) or an immediate scan of the files it wrote (folders), and receives them directly. With changes under 50 MB this finishes in seconds and shows "Catching up…" only while it runs.
- **Previous runner offline**: the claiming device uses the newest checkpoint and the cloud copy. Devices write a checkpoint after every turn that changed the work tree, before the system sleeps, and before the app quits, so the newest one reflects the last state the runner saw.
- **Repository with local changes on the claiming device**: those changes are saved as a named stash first and a notice says so.

#### Two versions of a file

When two devices change one file before they exchange it, both versions survive. The device resolves automatically when the versions are byte-identical or one side changed only metadata. Otherwise the workspace row shows "1 file has two versions"; clicking it opens a comparison with **Keep this one**, **Keep the other**, and **Keep both**. Text files show a diff; other files show size, time, and device. Nothing blocks work while the badge is shown. Because the runner lease lets one agent write at a time and handoff aligns files before a turn, two versions arise only from concurrent human edits on two devices.

#### Removing and deleting

- **Remove from this computer** (workspace menu) stops file sync on this device and keeps the local files; the workspace becomes chats-only here and stays intact on other devices. A separate **Remove and delete local files** deletes the local copy after one confirmation.
- Deleting the workspace from the account (the existing delete) stops file sync on every device, deletes the cloud copy, and deletes no files on any device.
- Deleting a file inside a synchronized folder is an ordinary change and propagates; every device keeps the old version for `versionRetentionDays` (default 30).

#### Settings → Sync → Files

One section beside the existing account sync controls ([`ui-settings-sync`](../../../../packages/client/ui-settings-sync/README.md)):

- **Files on this computer**: **Recently used workspaces** (default), **All workspaces**, or **Only when I open them**.
- **Keep an encrypted copy in the cloud** (on by default), with the storage used and the account's quota.
- **Pause file sync** on this computer.
- Storage used on this computer, and a list of workspaces with their status and local folder, each with **Show in Finder/Explorer** and **Remove from this computer**.

### Status vocabulary

Each workspace has one file status per device, shown on its sidebar row, its conversation header, and the Files sidebar:

| State | Copy (English) | Meaning |
|---|---|---|
| `absent` | "Files arrive when you open this workspace" | Outside the prefetch set and not opened here |
| `fetching` | "Getting files · 34%" | First download, clone, or peer clone running |
| `preparing` | "Preparing aeven…" | Installing dependencies after the clone |
| `current` | (no indicator) | Every file other devices have is here |
| `catching-up` | "Catching up…" | Receiving changes after the first download |
| `waiting` | "Waiting for your MacBook Pro" | No online device and no cloud copy holds the files (cloud copy off or over quota) |
| `diverged` | "1 file has two versions" | Unresolved conflicting versions |
| `paused` | "File sync paused" | The user paused it, or bulk transfer waits for power or an unmetered network |
| `chats-only` | "Just the chats on this computer" | The user declined or removed the files here |
| `failed` | "Couldn't get files · Try again" | Disk full, permission denied, or no source reachable |

<a id="placement"></a>
### Placement

The device picks a local folder without asking, in this order:

1. **Mirror the source location.** Device A publishes a location hint: the folder's path relative to its home directory (`Projects/aeven`), or none when the folder lies outside the home directory. Device B uses `<home>/<hint>` with separators and reserved characters translated for its platform.
2. **Reuse an existing match.** If that path exists and is the same project — a Git work tree with the same normalized remote, or a folder whose `.aeven-workspace` marker names the same workspace id — the device binds it without downloading.
3. **Never merge into an unrelated folder.** If the path exists, is not empty, and is not a match, the device uses `<root>/<title>` instead (default root `~/Aeven`), appending ` 2`, ` 3` on name collisions.
4. **Fall back to the root.** Without a hint, the device uses `<root>/<title>`.

The location hint is never a binding: the binding stays device-local as the [local-binding Agent Note](../../implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.md) requires. On macOS, a mirrored path under `~/Documents`, `~/Desktop`, or `~/Downloads` triggers the system's one-time folder-access prompt, which is the operating system's and appears at most once per folder class.

<a id="checkout-discovery"></a>
### Checkout discovery

Before cloning, the device looks for an existing checkout with the same normalized remote URL (scheme, host, and path, with `.git` and credentials removed, so SSH and HTTPS forms match):

- The placed path from rule 1.
- The parents of folders already bound to other workspaces on this device.
- Up to `discoveryDepth` (default 2) levels under `discoveryRoots` (default `~/Projects`, `~/code`, `~/src`, `~/Developer`, `~/repos`, `~/git`, `~/workspace`, and the Windows equivalents under `%USERPROFILE%`).

Discovery reads only `.git/config` of each candidate, stops at the first match, gives up after 500 ms, and caches its candidate list per device. A match on a different branch is still bound; the work-state checkpoint step handles branch differences.

<a id="a-fresh-computer"></a>
### A fresh computer

A new computer often has no Git, no secrets, and no installed dependencies. Each is handled without the user:

- **Git.** The device uses the system Git when it is present and recent enough, and otherwise the Git that ships with the desktop app through [dugite](https://github.com/desktop/dugite), which bundles Git and Git LFS for macOS, Windows, and Linux. A fresh Mac therefore never shows the Xcode command-line tools prompt for a clone. The agent's own Git use resolves the same executable.
- **Environment files.** Files that Git ignores but a project needs to run — names matching `envFiles.patterns` (default `.env`, `.env.*`, `.dev.vars`, `.envrc`, excluding `*.example`, `*.sample`, `*.template`) under `envFiles.maxBytes` (default 64 KB) each — travel encrypted with the workspace's descriptor. A device restores one only where no file of that name exists, never overwriting a local value, and a change on one device updates the others the same way. Other ignored files never travel.
- **Dependencies.** After a clone, the device detects a lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `uv.lock`, `poetry.lock`, `Pipfile.lock`, `Cargo.lock`, `go.sum`, `Gemfile.lock`) and, when the matching toolchain is on `PATH`, runs that lockfile's frozen install command through the shell capability under the workspace's sandbox at low priority. A missing toolchain skips the step silently; the agent installs it when a task needs it. The step is recorded as a session event when a session is open in the workspace, so the model knows dependencies are being installed and does not start a second install.

<a id="on-demand-files"></a>
### On-demand files

While a folder workspace is `fetching`, the device already holds Syncthing's index of every file the other devices have. The Files sidebar and the agent's directory listings show that full tree. Reading a file that has not arrived moves it to the front of the download queue (Syncthing's `POST /rest/db/prio`) and waits for that one file, through a pre-read hook the file-sync Consumer registers on the [filesystem capability](../../../../packages/fs/README.md). Commands that read the whole tree — shell commands and content search — wait until the workspace is `current`, showing progress, bounded by `handoffWaitMs`; past the bound they run and the transcript notes that some files are still arriving. Model-visible notes are session events, so the log reconstructs them.

<a id="indexing-and-transfer-scheduling"></a>
### Indexing and transfer scheduling

- **Syncthing runs only when needed.** The provider starts Syncthing when the account has at least two devices and at least one folder workspace or local-only repository. A single-device account and an account whose workspaces are all repositories with remotes never start it.
- **Index early, transfer on demand.** Device A indexes its folder workspaces as soon as the account has a second device, on AC power and at low process priority, and then follows changes through the filesystem watcher. Hashing cost is paid once, before any device asks, so a request starts transferring immediately.
- **Offers are free.** Device A offers every folder workspace to every device of the account. A receiving device accepts an offer only for a workspace in its prefetch set or one the user opened; an unaccepted offer costs nothing on either side.
- **Prefetch order and budget.** The receiving device materializes its prefetch set most recently used first, stopping when the next workspace would push the workspaces' total past `prefetch.diskShare` (default 20%) of free disk or a single workspace past `prefetch.maxBytes` (default 5 GB); those wait for an explicit open.
- **Power and network.** On battery, initial indexing, prefetch, and first downloads above 100 MB pause; requested files and ongoing changes continue. Bulk transfer also pauses on a connection the operating system reports as metered (Windows network cost, macOS expensive paths), read through a small platform query the desktop app exposes.

<a id="continuing-work-across-devices"></a>
### Continuing work across devices

A repository workspace's uncommitted and unpushed work travels as a **work-state checkpoint**, owned by the repository Consumer:

- **Content**: base commit and branch; a `git bundle` of commits reachable from `HEAD` and absent from the remote-tracking branch; a binary diff of tracked changes against `HEAD`; and an archive of untracked files that `.gitignore` does not exclude. Environment files travel separately ([fresh computer](#a-fresh-computer)); other ignored files never travel.
- **When**: on request from a claiming device while the runner is online, after a turn that changed the work tree (debounced to at most one per 30 seconds and computed after the turn ends, never delaying it), before the system sleeps, and before the app quits. A checkpoint whose content address equals the previous one is not written.
- **Where**: between two online devices, directly through a transfer folder shared only between them. Otherwise, as an encrypted content-addressed blob in the attachment path session sync already uses, with a per-workspace entry in a `workspace-git/<workspace id>` document pointing at the newest checkpoint per session and per device. The relay sees neither content nor names.
- **Size**: a checkpoint larger than `checkpointMaxBytes` (default 50 MB) goes only through the direct path, or the cloud copy's transfer folder when the runner is offline.
- **Apply**: the claiming device fetches the base commit (from the remote, else from the bundle); if its work tree has local changes, it saves them first as a named stash (`aeven: before continuing from MacBook Pro`) and says so in a notice; then it checks out the branch, applies the bundle and the diff, and extracts untracked files. It never resets, force-checks-out, or deletes a branch. A failed apply leaves the stash and the work tree intact and reports the failure in the conversation.

<a id="peer-clone"></a>
### Peer clone

A repository whose remote this device cannot reach — a local-only repository, a private host this device cannot authenticate to, or an offline remote — is copied from a device or the cloud copy: the holder writes `git bundle create --all` (with LFS objects for checked-out revisions) into a transfer folder shared only with the requester, the requester clones from it and sets `origin` to the recorded remote URL when one exists, and the holder deletes the bundle. A local-only repository keeps an incrementally refreshed bundle in its cloud copy transfer folder, updated at most once per `peerBundleIntervalMs` after new commits, so it stays available while every other device sleeps. A repository is never synchronized by replicating its `.git` directory.

<a id="cloud-copy"></a>
### Cloud copy

Aeven's servers keep an encrypted copy of every folder workspace and local-only repository bundle, using Syncthing's untrusted-device mode: the servers store and serve encrypted blocks, names, and metadata and never receive the folder password.

- **Password.** Each folder's password is derived on the devices as `HKDF(vault key, "file-sync/folder" ‖ folder id)` and never shown or typed.
- **Assignment.** The server runs a pool of Syncthing instances and assigns each account one of them. A device reads the assigned instance's device id from an authenticated server endpoint and adds it as an untrusted peer for each folder. Because that peer receives only ciphertext, a wrong assignment exposes nothing.
- **Use.** A receiving device pulls blocks from the cloud copy in parallel with its online peers, so it also speeds up downloads, and alone serves them when no peer is online.
- **Quota.** The cloud copy counts against the account's sync storage quota. Past the quota, the largest folders stay peer-only and Settings says which.
- **Lifetime.** Deleting a workspace deletes its cloud copy; deleting the account purges every copy.
- **Key mode.** With the passkey-held key, the servers cannot derive the password. With the relay-held key, the relay holds the vault key and therefore could, the same exposure that mode has for every other account document; Settings states it as it states the rest.

### Folder sync details

- **Ignore rules.** The provider writes `.stignore` from a built-in default set (`node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `target`, `.next`, `.turbo`, `.cache`, `.DS_Store`, `Thumbs.db`, `*.tmp`) plus the folder's `.gitignore` translated into Syncthing's ignore syntax when one exists. `defaultIgnores` replaces the built-in set. The Settings list offers an advanced editor per workspace; ordinary users never see it.
- **Versioning.** Each folder uses Syncthing's staggered versioning with `versionRetentionDays`, so a deletion or overwrite from another device is recoverable.
- **Conflicts.** Syncthing's `*.sync-conflict-*` copies are detected by the provider, hidden from the agent's file listings and search, and surfaced through the `diverged` state; resolution renames or deletes them through the provider.
- **Platform limits.** Syncthing reports files it cannot create on the receiving platform (case-only name collisions, reserved Windows names, over-long paths, symlinks on Windows); the provider surfaces them as a `failed` entry naming the files, not as a workspace-wide failure.
- **Chats workspace.** Files the agent writes from the virtual Chats workspace travel as attachments, which session sync already publishes encrypted and fetches on demand, rather than as a folder.

### Performance

Mechanisms:

- **Fast propagation.** Workspace folders use a filesystem-watcher delay of `watcherDelayS` (default 1 s). The file-sync Consumer also requests a scan of each path the agent's file tools write as the tool completes, so a change reaches an online peer without waiting for the watcher.
- **Block-level transfer from many sources.** Syncthing transfers only changed blocks, detects renames and moves without retransfer, and pulls blocks from every device and the cloud copy that has them, preferring the local network.
- **Low priority.** Syncthing runs with its low-priority setting and a limited number of hashers (one on battery), so it never competes with the agent, the model stream, or the UI.
- **Full clones.** Repositories clone with full history, which the agent's Git use reads; shallow and partial clones would trade a faster first clone for network round-trips during later work.
- **Cheap checkpoints.** Checkpoints use Git's index (`git diff`, `git ls-files --others --exclude-standard`), run after the turn ends, debounce, and skip unchanged content by address.

Budgets, set in phase 0 and verified in the last phase on macOS, Windows, and Linux:

| Measure | Target |
|---|---|
| Change in a file under 10 MB visible on an online peer, same local network | under 3 s |
| Same, across the internet | under 10 s |
| Handoff with the runner online and changes under 50 MB | under 5 s before the next turn starts |
| First byte of a requested file during `fetching` | under 2 s |
| Syncthing idle CPU, 100,000 indexed files | under 1% average |
| Syncthing resident memory, 100,000 indexed files | under 200 MB |
| Added latency to a turn from checkpointing | none: it runs after the turn ends |

### Architecture

The feature is one [capability seam](../../../../docs/glossary.md#capability-seam) for file transport plus two Consumers:

| Package | Role |
|---|---|
| `packages/sync/file-sync` (`@aeven/file-sync`) | Service Definition `ctx.fileSync`: this device's transport peer id, share and unshare a folder with peers and the cloud copy, folder status and its change events, the global file index, file prioritization, targeted scans, conflicts and their resolution, and `awaitCurrent(owner, folder, deadline)` for handoff |
| `packages/sync/file-sync-syncthing` (`@aeven/file-sync-syncthing`) | Service Provider: supervises the bundled Syncthing process through the subprocess capability, configures it through its loopback REST API, follows `/rest/events`, maps folders to workspaces, writes ignore, versioning, watcher, and priority settings, and applies the power and network policy |
| `packages/workspace/workspace` | Consumer: publishes each workspace's file descriptor, location hint, wants, and holders in the existing `workspaces` document; runs placement, prefetch, and the status projection; registers the pre-read hook and the shell and search gate |
| `packages/workspace/workspace-git-sync` (`@aeven/workspace-git-sync`) | Consumer: Git resolution (system or bundled), repository detection, remote normalization, checkout discovery, clone with submodules and LFS, peer clone, environment files, dependency preparation, work-state checkpoints, and the apply step registered on session handoff's claim |
| `packages/api/file-sync-controller` | Remote: status, materialize, remove, conflicts, and settings for the Client |
| `packages/client/ui-workspace`, `ui-sidebar-files`, `ui-settings-sync` | Row status and progress, the full tree during `fetching`, Settings → Sync → Files, the two-versions comparison |

The `workspaces` document grows these fields per record, all inside the account's end-to-end encryption:

```ts
interface SyncedWorkspaceFiles {
  /** How a device materializes the workspace's files. */
  source:
    | { kind: 'repository'; remote?: string; branch?: string }
    | { kind: 'folder'; folder: FileSyncFolderId; bytes: number; files: number }
  /** Path relative to the publishing device's home directory; a placement hint, never a binding. */
  hint?: string
  /** Devices that asked for the files, and devices that hold them. */
  wants: Record<DeviceId, true>
  holders: Record<DeviceId, true>
  /** Last time any device used the workspace, which orders prefetch. */
  usedAt: string
}
```

Environment files live in a separate `workspace-env/<workspace id>` document so their contents load only on devices that hold the workspace. `FileSyncFolderId` and `DeviceId` are branded ([`avn-brand`](../../../../packages/util/brand/README.md)); folder ids are random and never derived from titles or paths.

#### Device pairing without the user

Each device's Syncthing device id is published in the account's existing `devices` document, which today holds each device's name ([`sync-yjs`](../../../../packages/sync/sync-yjs/README.md)). The provider adds exactly the Syncthing peers that document lists for the account as trusted peers, adds the assigned cloud instance as an untrusted peer, removes peers whose devices leave the document, auto-accepts a folder offer only when the account's `workspaces` document names that folder id, and rejects everything else. The Syncthing GUI is bound to loopback with a random API key, usage reporting and crash reporting are off, automatic upgrades are off, and no Syncthing screen is ever shown.

Trust follows the account key mode. With the passkey-held key, only the account's devices can write the `devices` document, so no one else can add a trusted peer. With the relay-held key, the relay could write that document and add a peer of its own, the same exposure that mode already has for every other account document.

#### Network

Syncthing connects devices directly over TLS when they share a network or can traverse NAT. For discovery and relaying, Aeven runs its own `stdiscosrv` and `strelaysrv` on aeven.io and configures every device to use them, so availability and metadata do not depend on the public Syncthing pool; local discovery stays on for LAN peers. A relay forwards TLS streams between devices and cannot read them. Discovery and relay servers see device ids, IP addresses, and traffic volume, as the account relay already sees for its own frames.

#### Process and packaging

- The desktop build downloads pinned Syncthing and dugite releases per platform and architecture, verifies their checksums, and ships them as nested executables, the same path [`prepare-runtime.ts`](../../../../apps/desktop/scripts/prepare-runtime.ts) uses for the Cua Driver, so they are signed and notarized with the app.
- The provider runs one Syncthing process per Host with its home under `$AVN_HOME/file-sync/syncthing/`, restarts it with backoff after a crash, and stops it with the Host. Folders are tagged with their owning account; a folder is shared only with that account's peers and cloud instance.
- The desktop profile patch mounts the plugins; the base and Web bundles mount them disabled. A browser cannot run Syncthing, so Web access to files goes through one of the user's devices, consistent with the [hosted Web surface note](2026-09-30-hosted-web-surface-and-sync.md).
- Syncthing is MPL-2.0 and Git is GPL-2.0. Shipping their unmodified binaries requires their license notices and links to the corresponding source; a local patch would be published.

<a id="configuration"></a>
#### Configuration

Every deployment-varying value is a validated `Config` field changeable from `cordis.yml`:

| Field | Default | Purpose |
|---|---|---|
| `root` | `~/Aeven` | Fallback placement root |
| `prefetch.mode` | `recent` | `recent`, `all`, or `on-open`; Settings writes it |
| `prefetch.recentDays` | 30 | Workspaces used within this window are prefetched |
| `prefetch.maxBytes` | 5 GB | Largest single workspace prefetched without being opened |
| `prefetch.diskShare` | 0.2 | Share of free disk prefetch may use |
| `minFreeDiskRatio` | 0.1 | A download leaving less free disk asks once |
| `cloudCopy` | `true` | Keep the encrypted cloud copy |
| `versionRetentionDays` | 30 | Retention of replaced and deleted files |
| `watcherDelayS` | 1 | Filesystem-watcher delay for workspace folders |
| `checkpointMaxBytes` | 50 MB | Largest work-state checkpoint uploaded through the relay |
| `peerBundleIntervalMs` | 600000 | Shortest interval between local-only repository bundle refreshes |
| `handoffWaitMs` | 120000 | Longest a claim or a whole-tree command waits for files |
| `envFiles.patterns`, `envFiles.maxBytes` | see [fresh computer](#a-fresh-computer) | Ignored files that travel |
| `prepareDependencies` | `true` | Install dependencies after a clone |
| `git` | `auto` | `auto` (system when recent enough, else bundled), `system`, or `bundled` |
| `discoveryRoots`, `discoveryDepth` | see [checkout discovery](#checkout-discovery) | Where existing checkouts are found |
| `defaultIgnores` | built-in set | Folder-mode ignore patterns |
| `discoveryServers`, `relayServers` | aeven.io | Syncthing discovery and relay endpoints |
| `binary` | bundled path | Syncthing executable |

### Server changes

- Deploy `stdiscosrv` and `strelaysrv` on aeven.io with TLS, monitoring, and per-IP rate limits; they keep no account data.
- Run the cloud copy pool: Syncthing instances in untrusted-device mode on object-storage-backed volumes, an assignment endpoint, quota accounting against the account's sync quota, and purge on workspace and account deletion.
- Store larger attachment blobs for work-state checkpoints, counted against the same quota.

### Phases and effort

| Phase | Scope | Engineer-weeks |
|---|---|---|
| 0. Spike | Bundle, sign, and notarize Syncthing and dugite on macOS, Windows, and Linux; supervise Syncthing; measure the performance budgets on a 100,000-file folder and a 5 GB folder; measure accounts per cloud instance in untrusted-device mode | 1.5 |
| 1. Seam and folder mode | `ctx.fileSync`, Syncthing provider, pairing through the `devices` document, early indexing, offers, placement, disk budget, versioning, status projection, sidebar progress | 2.5 |
| 2. Repository mode | Git resolution, detection, remote normalization, checkout discovery, clone with submodules and LFS, peer clone, environment files | 2 |
| 3. Continuing work and on-demand files | Work-state checkpoints with fresh-on-claim, targeted scans of written files, pre-read prioritization, the shell and search gate, apply with stash protection | 2 |
| 4. Cloud copy | Server pool, assignment, folder passwords, quota, purge, local-only repository bundles | 2.5 |
| 5. Prefetch and preparation | Prefetch scheduler, power and metered-network policy, dependency preparation | 1.5 |
| 6. Polish | Two-versions comparison, Settings → Files, ignore editor, platform-limit reporting, discovery and relay deployment | 1.5 |
| 7. Verification | Convergence, crash, offline, sleep, and large-repository runs on macOS, Windows, and Linux; budgets; documentation | 2 |
| **Total** | | **15.5** |

Phases 1–3 deliver files between online devices with no setup; phase 4 removes "Waiting for your MacBook Pro"; phase 5 removes the remaining first-open wait.

### Open questions

1. **Cloud instance density.** How many accounts' folders one Syncthing instance in untrusted-device mode serves within its memory and connection limits decides the pool's size and cost. Phase 0 measures it; if the density is too low, the cloud copy stores the same encrypted blocks through the account relay's object storage instead, behind the same `ctx.fileSync` provider.
2. **Untrusted-device mode maturity.** Syncthing documents untrusted-device mode as newer than the rest of the protocol. Phase 0 runs it against crash, rename, and large-folder cases before the cloud copy becomes the default.

## Alternatives considered

**Syncthing for every workspace, including `.git`.** One transport would be simpler to build. Rejected because two devices running Git and an agent against one replicated `.git` race on lock files, refs, and packs, and replicated dependency and build directories cost bandwidth for files each machine regenerates. Git already replicates repositories correctly.

**Git only, requiring a remote.** Simplest for developers. Rejected because many workspaces are document folders with no repository, and requiring users to create a remote is exactly the kind of question this proposal removes.

**Asking the user to choose a mode and a location.** Explicit and easy to implement. Rejected for the UX goal: the device can determine both more accurately than a regular user, and the only remaining question protects the disk.

**Downloading only when a workspace is opened.** Saves disk on the second device. Rejected as the default because the first open then waits for the whole transfer; prefetching recently used workspaces within a disk budget keeps the disk protected and makes the common case instant. Settings keeps it as **Only when I open them**.

**Downloading every workspace at sign-in.** Files would always be ready. Rejected as the default because a developer account can hold tens of gigabytes the second device never uses. Settings keeps it as **All workspaces**.

**Indexing only after another device asks.** Spends nothing on folders no one requests. Rejected because the first request then waits for a full hash of the folder on device A, and fails entirely while device A sleeps; indexing early on AC power pays the cost once, off the critical path.

**Peers only, without a cloud copy.** Keeps every byte off Aeven's servers. Rejected as the default because the most common second-device moment — the laptop is closed and the user is at the desktop — would show "Waiting for your MacBook Pro". The cloud copy is encrypted with a password the servers never receive in passkey mode, and Settings can turn it off.

**A cloud copy the server can read.** Simpler to operate and searchable. Rejected because the server must not be able to read the data.

**Making the agent wait for the whole folder.** Simple and consistent. Rejected because file tools can fetch the one file they need in seconds; only whole-tree commands, whose output would be incomplete, wait.

**Leaving `.env` files to the user.** Keeps secrets off the wire. Rejected because the first turn on a new computer would then fail in most web and backend repositories, which is the opposite of working out of the box; the files are small, encrypted end to end, and never overwrite local values.

**Requiring a system Git.** Smaller app. Rejected because a fresh Mac has no Git and running it shows the command-line tools installer; dugite adds tens of megabytes and removes that prompt.

**Shallow or partial clones.** Faster first clone. Rejected because the agent reads history and blame, and a partial clone fetches missing objects over the network at the moment the agent needs them, which is slower and fails offline.

**Live-mirroring a repository's work tree through Syncthing while excluding `.git`.** Gives instant file updates across devices. Rejected because each device's index and `HEAD` diverge from the mirrored files, so `git status` on one device reports the other's edits as its own changes. Fresh-on-claim checkpoints carry the same work at the moment it is needed without that ambiguity.

**Building file transport on the account relay.** Chunked, encrypted, content-addressed transfer through the existing relay would reuse the vault and give one network identity. Rejected because it rebuilds block hashing, rename detection, partial transfer, file watching, NAT traversal, multi-source download, and direct LAN transfer that Syncthing has hardened over a decade. It remains the fallback storage for the cloud copy if instance density is too low.

**Mutagen.** Strong for code and fast, but it synchronizes pairs of endpoints over SSH or its own agent, not a group of devices, and has no discovery or relaying.

**Unison and rclone bisync.** Two-way synchronization between pairs, run on demand or on a schedule rather than continuously; neither discovers peers or traverses NAT.

**Resilio Sync.** Peer to peer and capable, but proprietary, which rules out bundling and auditing it.

**iroh.** A modern peer-to-peer library with content-addressed blobs and NAT traversal, but it is a Rust library that would need a native Node addon on every platform, and folder synchronization semantics (watching, ignores, conflicts, versioning) would still be owned code.

**iCloud Drive, OneDrive, Dropbox, or Google Drive.** Users could place workspaces in a consumer cloud folder. Rejected because the provider reads the files, the placeholders such services create for files kept online break tools and builds, and those services corrupt `.git` directories the same way a raw replica does.

## Acceptance criteria

- A user signs in on a second computer and, without answering any question, finds recently used folder workspaces already present and any other folder workspace present after opening it, when it fits the disk budget.
- The same holds while every other device of the account is asleep, served by the cloud copy.
- Opening a repository workspace on a second computer binds an existing checkout of the same remote when one exists in a discovery root, clones otherwise with submodules and LFS, and falls back to a peer clone when the clone fails, without a question and without a system Git installed.
- After the clone, the repository's environment files are present, never overwriting local ones, and dependencies install in the background when the toolchain is present.
- Continuing a conversation on another device brings the previous runner's uncommitted and unpushed changes in a repository workspace, and every file it wrote in a folder workspace, before the next turn acts; with the runner online and changes under 50 MB, within 5 seconds.
- During `fetching`, the full tree is listed and a file the agent reads arrives first; shell commands and search wait until the workspace is `current` or the bound elapses.
- Local changes on the claiming device are preserved in a named stash whenever a checkpoint is applied over them; conflicting edits keep both versions; deletions are recoverable for the retention period.
- A single-device account, and an account whose workspaces are all repositories with remotes, never start Syncthing.
- The performance budgets hold on macOS, Windows, and Linux.
- No user-visible string names Syncthing, device ids, folder ids, bundles, stashes, checkpoints, or relays; `verify-client-ui-i18n` passes.
- Model-visible effects (checkpoint notes, files still arriving, dependency preparation) appear as session events, so the session log reconstructs them.
- Recorded-session snapshots and unit, e2e, and SDK expected outputs cover materialization, handoff with a checkpoint, on-demand reads, and the status vocabulary.

## Risks

- **A second network identity.** Syncthing device ids exist beside account sync's device keys. Pairing derives them from the `devices` document, so a compromise of that document's writers (the relay, in relay-held key mode) extends to file peers. This matches the trust each key mode already states.
- **Secrets on the wire.** Environment files now travel. They are encrypted end to end and readable only by the account's devices in passkey mode; in relay-held key mode the relay could read them, as it could read the conversations that often quote them.
- **Running repository code after a clone.** Dependency preparation runs install scripts from the user's own repository without an explicit click. It runs in the workspace's sandbox and only for repositories the account already uses; `prepareDependencies` turns it off.
- **Cloud cost.** The cloud copy adds per-account storage and an instance pool. The quota bounds it per account; phase 0 measures density before it is the default.
- **Bundled native executables.** Signing, notarization, antivirus false positives on Windows, GPL source obligations for Git, and keeping pinned releases patched are ongoing costs, shared with the Cua Driver's path.
- **Resource use.** Early indexing spends CPU and disk on folders that may never be requested. It runs on AC power at low priority, and the budgets bound the steady state.
- **Applying work over a user's own edits.** Applying a checkpoint changes files the user may have open in an editor. The stash, the notice, and never resetting keep the change reversible; the user still sees files change under their editor.
- **Placement surprises.** A mirrored path can land somewhere the user did not expect on the second machine. The location is shown after the fact and **Use a different folder…** moves the binding.
- **Knowingly given up.** Web-only and hosted users get no files; live per-keystroke mirroring of repository work trees is not offered; ignored files other than environment files do not travel; a workspace larger than the disk budget still asks once.
