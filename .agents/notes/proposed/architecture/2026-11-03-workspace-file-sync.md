# Agent Note: Workspace files follow the account

Status: proposed

English | [中文](2026-11-03-workspace-file-sync.zh.md)

## Problem

[Account sync](2026-10-27-account-sync-network.md) makes conversations, memory, settings, and the workspace list the same on every device of an account, but not the files a workspace points at. `@aeven/workspace` publishes a workspace's title, order, and owner through the account's `workspaces` document and never its directory ([`sync.ts`](../../../../packages/workspace/workspace/src/sync.ts)). A device that receives the workspace stores it as `kind: 'remote'` ([`index.ts`](../../../../packages/workspace/workspace/src/index.ts)), and a session imported into it resolves no directory until this device binds one ([local-binding Agent Note](../../implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.md)).

The only way to bind it today is the sidebar's **Link workspace** action, which opens a folder picker ([`ui-workspace` `bindWorkspace`](../../../../packages/client/ui-workspace/src/client/index.ts)); until then the New Session hero shows its generic **Choose workspace** chip. That assumes the user already copied the files to the second machine and can find them, and nothing checks that the chosen folder is the same project. A user who signs in on a new laptop sees their conversations and memory but cannot continue any task that touches files, which is most of them.

Workspaces range from a folder of documents to a full repository with a `.git` directory, gigabytes of dependencies, build output, and files that only make sense on one machine. A single byte-copy mechanism serves the first well and the second badly: two machines that both run Git, an editor, and an agent against one replicated `.git` directory race on `index.lock`, packed refs, and the object store, and replicating `node_modules` or `target/` costs bandwidth for files each machine regenerates.

Regular users must not have to understand any of this. The product promise is that opening a workspace on any signed-in computer shows its files, with no questions about transports, modes, folders, or keys in the normal case.

## Proposal

Every workspace carries a synchronized description of where its files come from, and every device of the account can materialize them locally without the user choosing how. Two transports cover the two kinds of workspace, and the device picks one by inspecting the folder, never by asking:

| Workspace | Detected by | Transport | What crosses devices |
|---|---|---|---|
| **Repository** | The bound folder is a Git work tree | Git: clone from the remote, or from another device when there is no reachable remote; a work-state checkpoint carries uncommitted and unpushed work | Remote URL without credentials, branch, home-relative location hint, encrypted work-state checkpoints |
| **Folder** | Anything else | [Syncthing](https://github.com/syncthing/syncthing), peer to peer between the account's own devices | Folder id, size and file count, home-relative location hint, the folder contents end to end encrypted in transit |
| **Chats only** | The user removed the files from this device, or declined a large download | None | Nothing beyond what account sync already carries |

Materialization starts when the user shows intent — opening the workspace, opening one of its conversations, or starting a session in it — and never at sign-in, so a new device does not fill its disk with workspaces nobody opened there.

### UX principles

1. **No mode choice.** The device classifies a workspace by inspecting its folder. Neither "repository" nor "folder" appears in the UI as a choice.
2. **No location question.** The device derives the local folder from the location hint and the placement rules below, shows it as editable text after the fact, and offers **Use a different folder…** from the workspace menu for the rare user who cares.
3. **One question, only when it protects the user.** The only confirmation in the normal flow is a download that is large or would leave too little disk space. Credential failures, conflicts, and offline peers are resolved automatically or reported as status, never as a modal.
4. **Nothing is lost silently.** Files deleted by another device go to a versioning folder for a configurable retention period, a work-state checkpoint never overwrites local changes without first stashing them, and conflicting edits keep both versions.
5. **No transport vocabulary.** User-visible copy never says Syncthing, device id, folder id, bundle, stash, relay, or conflict. It says *files*, *your MacBook Pro*, *getting files*, *two versions*. All copy goes through the locale dictionaries ([locale-owned UI copy](../../implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
6. **Chat never waits for files.** The composer works while files arrive. Only a turn that would act on the folder waits, and it says so with progress and a **Start anyway** action.

### What the user sees

#### Device A: creating a workspace

Nothing changes. Binding a folder publishes the file descriptor in the background: the device detects whether the folder is a Git work tree, records the remote URL (credentials stripped) and branch for a repository, and records size and file count for a folder. No Syncthing scan runs on device A until another device asks for the folder (see [lazy sharing](#lazy-sharing)).

#### Device B: first sign-in

Account sync's existing progress runs. Workspaces from other devices appear in the sidebar with their normal titles, in account order, with a small download glyph instead of the current "remote" treatment. Hovering the glyph says "Files are on MacBook Pro. Open to get them." A workspace whose files exist on no online device and that has no remote says "Files are on MacBook Pro, which is offline."

#### Device B: opening a folder workspace

1. The user clicks the workspace or one of its conversations.
2. The device picks the local folder ([placement](#placement)) and starts receiving. The workspace row and the conversation header show "Getting files from MacBook Pro · 34%". The Files sidebar lists files as they arrive.
3. If the folder is larger than `fileSync.confirmAboveBytes` (default 5 GB) or would leave less than `fileSync.minFreeDiskRatio` free (default 10%), one inline card asks first: "Notes is 14 GB. Download it to this computer?" with **Download** and **Just the chats**. "Just the chats" marks the workspace chats-only on this device; the workspace menu offers **Get files** later.
4. When complete, the glyph disappears. The workspace is now an ordinary bound folder, and both devices keep it in sync while they are online.

#### Device B: opening a repository workspace

1. The user clicks the workspace.
2. If a checkout of the same remote already exists in a likely place ([checkout discovery](#checkout-discovery)), the device binds it and shows a toast: "Using ~/code/aeven". No download happens.
3. Otherwise the device clones the remote into the placed folder: "Getting aeven from github.com · 60%". The clone uses this computer's own Git credentials (SSH agent, credential helper, Git Credential Manager), so a system sign-in prompt may appear, which is Git's own, not Aeven's.
4. If cloning fails for authentication or network reasons and a device holding the repository is online, the device copies the repository from that device instead ([peer clone](#peer-clone)) and sets `origin` to the remote URL. The notice says "Copied from MacBook Pro. To push from this computer, sign in to github.com with Git." If no device is online, the row says "Couldn't get aeven from github.com" with **Try again**.
5. If the conversation the user opened has a work-state checkpoint ([continuing work](#continuing-work-across-devices)), the device applies it after the clone, so uncommitted changes from device A are present: "Brought 3 changed files from MacBook Pro".

#### Continuing a conversation on another device

Session handoff already moves the runner lease between devices ([`@aeven/session-handoff`](../../../../packages/session/session-handoff/README.md)). File sync adds one step before the claiming device starts a turn:

- **Folder workspace**: the claim waits until this device holds every file the previous runner wrote ("Catching up 12 files…"), bounded by `fileSync.handoffWaitMs`; past the bound the turn starts with a transcript note that some files are still arriving.
- **Repository workspace**: the claim applies the newest work-state checkpoint for the workspace ("Brought 3 changed files from MacBook Pro").

#### Two versions of a file

When two devices change one file before they exchange it, both versions survive. The device resolves automatically when the versions are byte-identical or one side changed only metadata. Otherwise the workspace row shows "1 file has two versions"; clicking it opens a comparison with **Keep this one**, **Keep the other**, and **Keep both**. Text files show a diff; other files show size, time, and device. Nothing blocks work while the badge is shown.

#### Removing and deleting

- **Remove from this computer** (workspace menu) stops file sync on this device and keeps the local files; the workspace becomes chats-only here and stays intact on other devices. A separate **Remove and delete local files** deletes the local copy after one confirmation.
- Deleting the workspace from the account (the existing delete) stops file sync on every device and deletes no files anywhere.
- Deleting a file inside a synchronized folder is an ordinary change and propagates; the other devices keep the old version in the versioning folder for `fileSync.versionRetentionDays` (default 30).

#### Settings → Sync → Files

One section beside the existing account sync controls ([`ui-settings-sync`](../../../../packages/client/ui-settings-sync/README.md)):

- Storage used by synchronized workspaces on this computer.
- **Get files for every workspace automatically** (off by default): materializes every workspace in the background, within the size guard.
- **Pause file sync** on this computer.
- A list of workspaces with their status and local folder, each with **Show in Finder/Explorer** and **Remove from this computer**.

### Status vocabulary

Each workspace has one file status per device, shown on its sidebar row, its conversation header, and the Files sidebar:

| State | Copy (English) | Meaning |
|---|---|---|
| `absent` | "Files are on MacBook Pro" | Not materialized here; opening starts it |
| `waiting` | "Waiting for MacBook Pro" | Requested, but no device holding the files is online |
| `fetching` | "Getting files · 34%" | First download, clone, or peer clone running |
| `current` | (no indicator) | Every file other devices have is here |
| `catching-up` | "Catching up 12 files" | Ongoing sync after the first download |
| `diverged` | "1 file has two versions" | Unresolved conflicting versions |
| `paused` | "File sync paused" | The user paused it or the device is offline |
| `chats-only` | "Just the chats on this computer" | The user declined or removed the files here |
| `failed` | "Couldn't get files · Try again" | Clone failure with no peer, disk full, or permission denied |

<a id="placement"></a>
### Placement

The device picks a local folder without asking, in this order:

1. **Mirror the source location.** Device A publishes a location hint: the folder's path relative to its home directory (`Projects/aeven`), or none when the folder lies outside the home directory. Device B uses `<home>/<hint>` with separators and reserved characters translated for its platform.
2. **Reuse an existing match.** If that path exists and is the same project — a Git work tree with the same normalized remote, or a folder whose `.aeven-workspace` marker names the same workspace id — the device binds it without downloading.
3. **Never merge into an unrelated folder.** If the path exists, is not empty, and is not a match, the device uses `<fileSync.root>/<title>` instead (default root `~/Aeven`), appending ` 2`, ` 3` on name collisions.
4. **Fall back to the root.** Without a hint, the device uses `<fileSync.root>/<title>`.

The location hint is never a binding: the binding stays device-local as the [local-binding Agent Note](../../implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.md) requires. On macOS, a path under `~/Documents`, `~/Desktop`, or `~/Downloads` triggers the system's one-time folder-access prompt; the root default lies outside those folders for that reason.

<a id="checkout-discovery"></a>
### Checkout discovery

Before cloning, the device looks for an existing checkout with the same normalized remote URL (scheme, host, and path, with `.git` and credentials removed, so SSH and HTTPS forms match):

- The placed path from rule 1.
- Folders already bound to other workspaces' parents on this device.
- Up to `fileSync.discoveryDepth` (default 2) levels under the configured `fileSync.discoveryRoots` (default `~/Projects`, `~/code`, `~/src`, `~/Developer`, `~/repos`, `~/git`, `~/workspace`, and the Windows equivalents under `%USERPROFILE%`).

Discovery reads only `.git/config` of each candidate and stops at the first match. A match on a different branch is still bound; the work-state checkpoint step handles branch differences.

<a id="lazy-sharing"></a>
### Lazy sharing

Device A does not index any folder until another device wants it. Device B records its request in the account's `workspaces` document (`wants: { <device>: true }`); device A, seeing a want for a folder it holds, adds the folder to Syncthing, scans it, and shares it with the wanting device. Once a folder has been shared, device A keeps sharing it with every device of the account that wants it. A device that holds the files but never received a want spends no CPU or disk on them.

<a id="continuing-work-across-devices"></a>
### Continuing work across devices

A repository workspace's uncommitted and unpushed work travels as a **work-state checkpoint**, owned by the repository Consumer:

- **Content**: base commit and branch; a `git bundle` of commits reachable from `HEAD` and absent from the remote-tracking branch; a binary diff of tracked changes against `HEAD`; and an archive of untracked files that `.gitignore` does not exclude. Ignored files never travel.
- **When**: the runner writes a checkpoint after every turn that changed the work tree, and when it releases the runner lease. A checkpoint whose content equals the previous one is not written.
- **Where**: the payload is an encrypted content-addressed blob in the attachment path that session sync already uses; a per-workspace entry in a `workspace-git/<workspace id>` document points at the newest checkpoint per session and per device. The relay sees neither content nor names, as with every other account document.
- **Size**: a checkpoint larger than `fileSync.checkpointMaxBytes` (default 50 MB) is not uploaded; the claiming device then fetches it from the runner directly when the runner is online, and otherwise starts the turn with a transcript note that the other device's changes could not be brought.
- **Apply**: the claiming device fetches the base commit (from the remote, else from the bundle); if its work tree has local changes, it saves them first as a named stash (`aeven: before continuing from MacBook Pro`) and says so in a notice; then it checks out the branch, applies the bundle and the diff, and extracts untracked files. It never resets, force-checks-out, or deletes a branch. A failed apply leaves the stash and the work tree intact and reports the failure in the conversation.

<a id="peer-clone"></a>
### Peer clone

A repository with no reachable remote — a local-only repository, a private host this device cannot authenticate to, or an offline remote — is copied from a device that holds it: the holder writes `git bundle create --all` into a dedicated Syncthing folder shared only with the requesting device, the requester clones from the bundle, sets `origin` to the recorded remote URL when one exists, and the holder deletes the bundle. Later updates of a local-only repository use incremental bundles through the same path. A repository is never synchronized by replicating its `.git` directory.

### Folder sync details

- **Ignore rules.** The provider writes `.stignore` from a built-in default set (`node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `target`, `.next`, `.turbo`, `.cache`, `.DS_Store`, `Thumbs.db`, `*.tmp`) plus the folder's `.gitignore` translated into Syncthing's ignore syntax when one exists. `fileSync.defaultIgnores` replaces the built-in set. The Settings list offers an advanced editor per workspace; ordinary users never see it.
- **Versioning.** Each folder uses Syncthing's staggered or trash-can versioning with `fileSync.versionRetentionDays`, so a deletion or overwrite from another device is recoverable.
- **Conflicts.** Syncthing's `*.sync-conflict-*` copies are detected by the provider, hidden from the agent's file listings and search, and surfaced through the `diverged` state; resolution renames or deletes them through the provider.
- **Agent writes during a sync.** A turn in a folder workspace whose status is `fetching` waits for `current` or the user's **Start anyway**; a turn in a `catching-up` workspace starts at once, since the runner lease keeps one agent writing at a time.
- **Platform limits.** Syncthing reports files it cannot create on the receiving platform (case-only name collisions, reserved Windows names, over-long paths, symlinks on Windows); the provider surfaces them as a `failed` entry naming the files, not as a workspace-wide failure.

### Architecture

The feature is one [capability seam](../../../../docs/glossary.md#capability-seam) for file transport plus a repository Consumer:

| Package | Role |
|---|---|
| `packages/sync/file-sync` (`@aeven/file-sync`) | Service Definition `ctx.fileSync`: this device's transport peer id, share and unshare a folder with peers, folder status and its change events, conflicts and their resolution, and `awaitCurrent(owner, folder, deadline)` for handoff |
| `packages/sync/file-sync-syncthing` (`@aeven/file-sync-syncthing`) | Service Provider: supervises the bundled Syncthing process through the subprocess capability, configures it through its loopback REST API, follows `/rest/events`, maps folders to workspaces, writes ignore and versioning settings |
| `packages/workspace/workspace` | Consumer: publishes each workspace's file descriptor, location hint, and per-device wants in the existing `workspaces` document; materializes on intent; owns placement and the status projection |
| `packages/workspace/workspace-git-sync` (`@aeven/workspace-git-sync`) | Consumer: repository detection, remote normalization, checkout discovery, clone, peer clone, work-state checkpoints, and the apply step registered on session handoff's claim |
| `packages/api/file-sync-controller` | Remote: status, materialize, remove, conflicts, and settings for the Client |
| `packages/client/ui-workspace`, `ui-sidebar-files`, `ui-settings-sync` | Row glyph and status, Files sidebar progress, Settings → Sync → Files, the two-versions comparison |

The `workspaces` document grows three fields per record, all inside the account's end-to-end encryption:

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
}
```

`FileSyncFolderId` and `DeviceId` are branded ([`avn-brand`](../../../../packages/util/brand/README.md)); folder ids are random and never derived from titles or paths.

#### Device pairing without the user

Each device's Syncthing device id is published in the account's existing `devices` document, which today holds each device's name ([`sync-yjs`](../../../../packages/sync/sync-yjs/README.md)). The provider adds exactly the Syncthing peers that document lists for the account, removes peers whose devices leave it, auto-accepts a folder offer only when the account's `workspaces` document names that folder id and this device wants it, and rejects everything else. The Syncthing GUI is bound to loopback with a random API key, usage reporting and crash reporting are off, automatic upgrades are off, and no Syncthing screen is ever shown.

Trust follows the account key mode. With the passkey-held key, only the account's devices can write the `devices` document, so no one else can add a peer. With the relay-held key, the relay could write that document and add a peer of its own, the same exposure that mode already has for every other account document; Settings states it as it states the rest.

#### Network

Syncthing connects devices directly over TLS when they share a network or can traverse NAT. For discovery and relaying, Aeven runs its own `stdiscosrv` and `strelaysrv` on aeven.io and configures every device to use them, so availability and metadata do not depend on the public Syncthing pool; local discovery stays on for LAN peers. A relay forwards TLS streams between devices and cannot read them. Discovery and relay servers see device ids, IP addresses, and traffic volume, as the account relay already sees for its own frames.

#### Process and packaging

- The desktop build downloads a pinned Syncthing release per platform and architecture, verifies its checksum, and ships it as a nested executable, the same path [`prepare-runtime.ts`](../../../../apps/desktop/scripts/prepare-runtime.ts) uses for the Cua Driver, so it is signed and notarized with the app.
- The provider runs one Syncthing process per Host with its home under `$AVN_HOME/file-sync/syncthing/`, starts it when the first account with file sync becomes ready, restarts it with backoff after a crash, and stops it with the Host. Folders are tagged with their owning account; a folder is shared only with that account's peers.
- The desktop profile patch mounts the plugins; the base and Web bundles mount them disabled. A browser cannot run Syncthing, so Web access to files goes through one of the user's devices, consistent with the [hosted Web surface note](2026-09-30-hosted-web-surface-and-sync.md).
- Syncthing is MPL-2.0. Shipping the unmodified binary requires its license notice and a link to the corresponding source; a local patch would be published.

#### Configuration

Every deployment-varying value is a validated `Config` field changeable from `cordis.yml`:

| Field | Default | Purpose |
|---|---|---|
| `root` | `~/Aeven` | Fallback placement root |
| `confirmAboveBytes` | 5 GB | Downloads above this ask once |
| `minFreeDiskRatio` | 0.1 | Downloads leaving less free disk ask once |
| `versionRetentionDays` | 30 | Retention of replaced and deleted files |
| `checkpointMaxBytes` | 50 MB | Largest work-state checkpoint uploaded through the relay |
| `handoffWaitMs` | 120000 | Longest a claim waits for folder files |
| `discoveryRoots`, `discoveryDepth` | see [checkout discovery](#checkout-discovery) | Where existing checkouts are found |
| `defaultIgnores` | built-in set | Folder-mode ignore patterns |
| `discoveryServers`, `relayServers` | aeven.io | Syncthing discovery and relay endpoints |
| `binary` | bundled path | Syncthing executable |

### Server changes

- Deploy `stdiscosrv` and `strelaysrv` on aeven.io with TLS, monitoring, and per-IP rate limits; they keep no account data.
- No change to the account relay beyond storing larger attachment blobs for work-state checkpoints, counted against the account's sync quota.

### Phases and effort

| Phase | Scope | Engineer-weeks |
|---|---|---|
| 0. Spike | Bundle, sign, and notarize Syncthing on macOS, Windows, and Linux; supervise it; measure RSS, CPU, and battery on a 50,000-file folder and a 5 GB folder | 1 |
| 1. Seam and folder mode | `ctx.fileSync`, Syncthing provider, device pairing through the `devices` document, lazy sharing, placement, size guard, versioning, status projection, sidebar glyph and progress | 2–2.5 |
| 2. Repository mode | Detection, remote normalization, checkout discovery, clone with progress, peer clone | 1.5 |
| 3. Continuing work | Work-state checkpoints, apply with stash protection, handoff waits for folder completion | 1.5–2 |
| 4. Polish | Two-versions comparison, Settings → Files, ignore editor, platform-limit reporting, discovery and relay deployment | 1.5 |
| 5. Verification | Convergence, crash, offline, and large-repository runs on macOS, Windows, and Linux; resource budgets; documentation | 1.5 |
| **Total** | | **9–10** |

### Open questions

1. **Ignored secrets.** A repository's `.env` is ignored, so the first turn on a new device may fail for lack of it. Carrying a small allowlist of ignored files (such as `.env*` under 64 KB) in the work-state checkpoint would remove that step, at the cost of moving secrets between devices; the default stays off until decided.
2. **Always-available files.** Syncthing's untrusted (encrypted) device mode would let an Aeven server act as an always-online peer that stores folder contents it cannot read, so device B can get files while device A sleeps. It costs server storage per account and the mode is newer than the rest of Syncthing; it is a candidate phase 6 after the spike measures it.
3. **Metered networks and battery.** Electron exposes no metered-network signal on every platform; whether to pause folder sync on battery below a threshold needs measurement from phase 0.
4. **Git LFS and submodules.** A clone fetches LFS objects and submodules only when the device has Git LFS installed and access to the submodule remotes; peer clone bundles neither. The first release reports missing LFS objects and submodules as status.
5. **Chats workspace files.** Files the agent writes from the virtual Chats workspace are outside any folder workspace; whether they sync through attachments or a dedicated folder is undecided.

## Alternatives considered

**Syncthing for every workspace, including `.git`.** One transport would be simpler to build. Rejected because two devices running Git and an agent against one replicated `.git` race on lock files, refs, and packs, and replicated dependency and build directories cost bandwidth for files each machine regenerates. Git already replicates repositories correctly.

**Git only, requiring a remote.** Simplest for developers. Rejected because many workspaces are document folders with no repository, and requiring users to create a remote is exactly the kind of question this proposal removes.

**Asking the user to choose a mode and a location.** Explicit and easy to implement. Rejected for the UX goal: the device can determine both with higher accuracy than a regular user, and the two remaining decisions (large download, two versions) are asked only when they protect the user.

**Live-mirroring a repository's work tree through Syncthing while excluding `.git`.** Gives instant file updates across devices. Rejected for the first release because each device's index and `HEAD` diverge from the mirrored files, so `git status` on one device reports the other's edits as its own changes. Work-state checkpoints carry the same work at turn boundaries without that ambiguity. It can return as an opt-in once checkpoints ship.

**Downloading every workspace at sign-in.** Files would be ready before the user asks. Rejected as the default because a developer account can hold tens of gigabytes the second device never uses; the Settings toggle offers it.

**Building file transport on the account relay.** Chunked, encrypted, content-addressed transfer through the existing relay would reuse the vault and give one network identity. Rejected because it rebuilds block hashing, rename detection, partial transfer, file watching, NAT traversal, and direct LAN transfer that Syncthing has hardened over a decade, and routes every byte through Aeven's storage.

**Mutagen.** Strong for code and fast, but it synchronizes pairs of endpoints over SSH or its own agent, not a group of devices, and has no discovery or relaying.

**Unison and rclone bisync.** Two-way synchronization between pairs, run on demand or on a schedule rather than continuously; neither discovers peers or traverses NAT.

**Resilio Sync.** Peer to peer and capable, but proprietary, which rules out bundling and auditing it.

**iroh.** A modern peer-to-peer library with content-addressed blobs and NAT traversal, but it is a Rust library that would need a native Node addon on every platform, and folder synchronization semantics (watching, ignores, conflicts, versioning) would still be owned code.

**iCloud Drive, OneDrive, Dropbox, or Google Drive.** Users could place workspaces in a consumer cloud folder. Rejected because the provider reads the files, the placeholders such services create for files kept online break tools and builds, and those services corrupt `.git` directories the same way a raw replica does.

## Acceptance criteria

- A user signs in on a second computer, opens a folder workspace created on the first, and sees its files without answering any question when the folder is under the size guard.
- Opening a repository workspace on a second computer binds an existing checkout of the same remote when one exists in a discovery root, clones otherwise, and falls back to a peer clone when the clone fails and a holding device is online, without a question.
- Continuing a conversation on another device brings the previous runner's uncommitted and unpushed changes in a repository workspace, and every file it wrote in a folder workspace, before the next turn acts.
- Local changes on the claiming device are preserved in a named stash whenever a work-state checkpoint is applied over them.
- Conflicting edits keep both versions, and deletions from another device are recoverable for the configured retention period.
- No user-visible string names Syncthing, device ids, folder ids, bundles, stashes, or relays; `verify-client-ui-i18n` passes.
- A device that never opens a workspace spends no disk or CPU on its files, and the device holding them indexes them only after another device wants them.
- Discovery and relay traffic goes only to the configured servers; Syncthing's GUI is reachable only on loopback with the provider's key.
- Model-visible effects (checkpoint notes, files still arriving, missing changes) appear as session events, so the session log reconstructs them.
- Recorded-session snapshots and unit, e2e, and SDK expected outputs cover materialization, handoff with a checkpoint, and the status vocabulary.

## Risks

- **A second network identity.** Syncthing device ids exist beside account sync's device keys. Pairing derives them from the `devices` document, so a compromise of that document's writers (the relay, in relay-held key mode) extends to file peers. This matches the trust each key mode already states.
- **Bundled native executable.** Signing, notarization, antivirus false positives on Windows, and keeping the pinned release patched are ongoing costs. Syncthing's release cadence is regular, and the version is pinned like the Cua Driver.
- **Resource use.** Initial hashing of a large folder costs CPU and battery, and Syncthing's database grows with file count. Lazy sharing limits it to folders someone wants; phase 0 sets budgets.
- **Applying work over a user's own edits.** Applying a checkpoint changes files the user may have open in an editor. The stash, the notice, and never resetting keep the change reversible; the user still sees files change under their editor.
- **Placement surprises.** A mirrored path can land somewhere the user did not expect on the second machine. The location is shown after the fact and **Use a different folder…** moves the binding.
- **Knowingly given up.** Web-only and hosted users get no files; live per-keystroke mirroring of repository work trees is not offered; ignored files, including secrets, do not travel; very large folders still require one confirmation.
