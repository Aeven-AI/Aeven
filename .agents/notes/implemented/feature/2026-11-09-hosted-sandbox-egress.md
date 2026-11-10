# Agent Note: Network egress for the hosted jail

Status: implemented

English | [中文](2026-11-09-hosted-sandbox-egress.zh.md)

## Problem

Hosted Aeven Web ran every command without network, so a session could not clone a repository, install a package, or cut a release ([#555](https://github.com/Aeven-AI/Aeven/issues/555)). The hosted chat products it is compared with give sandboxed processes network access through a proxy with a host list: ChatGPT through an internal package mirror, Claude through an allowlist of GitHub and the package registries. Opening the network on a Host that also runs MongoDB, the Aeven API, and mail on loopback must not let a command reach those services, use the machine's bandwidth without bound, or cost every command a process.

## Decision

A jail keeps its empty network namespace. `avn-sandbox-jail` gains `egress`: the provider runs one proxy outside every jail, in its own cgroup `<root>/jail/egress`, and starts each command behind a static relay that listens on a loopback port inside the jail and copies connections to the proxy's Unix socket. The relay opens each proxy connection with the account and an HMAC token the provider derives from a key it holds for its lifetime, so the proxy knows the account without trusting the command. The proxy serves `CONNECT` to listed hosts and ports only, and Git's smart HTTP requests for the hosts in `gitHosts`; it resolves names itself, refuses internal addresses, connects to the address it checked, and bounds connections, bytes per second, and bytes per UTC day per account, plus connections and bytes per second for all accounts together.

For a host in `gitHosts`, `git` inside a jail is pointed at the proxy's Git route by a URL rewrite in its environment. The proxy asks the provider for the account's credential over its standard streams and sends it upstream, so the token never enters a jail. `avn-sandbox-jail` publishes `ctx.sandboxGitCredentials`, a registry of credential sources, and `avn-host-account-integrations` registers the account's connected GitHub account. The proxy reads a push's ref updates before forwarding it: branch creations and updates pass, and anything else, such as a tag or a branch deletion, waits for `ctx.approval` in the conversation whose command pushed. The release in #555 then needs one approval, for the tag.

Every account gets the same access. Free accounts hold only a few cents of model credit, so their sessions are few and a plan check on each command would buy nothing.

The hosted patch allows `github.com`, `codeload.github.com`, `raw.githubusercontent.com`, `objects.githubusercontent.com`, `registry.npmjs.org`, `pypi.org`, and `files.pythonhosted.org` on port 443, with 32 connections, 8 MiB/s, and 2 GiB a day per account and 50 MiB/s in all. Installs take prebuilt packages only (`PIP_ONLY_BINARY`, `npm_config_ignore_scripts`), because compiling and install scripts are the CPU-heavy part. `host/install-egress.sh` adds pip to the image and `aeven_user_site.py`, which sends installs to the caller's `~/.local` after the image's packages on the import path.

The same change prepares the machine for about two thousand simultaneous users: an account's CPU limit drops from four cores to two, `memoryHigh` slows an account at 1.5 GiB before `memoryMax` ends it at 2 GiB, account groups set `memory.oom.group`, the combined process limit rises to 16384, and background commands may run 30 minutes.

A request beyond a connection bound waits up to `connectTimeoutMs` for a slot instead of being refused at once. On pink, a release rehearsal's `pnpm install` held all 32 of its account's connections, and a `fetch` from another command in the same account failed immediately with 429.

A full `pnpm install` of this repository in a hosted account ran past twelve minutes at its 1.5 GiB `memoryHigh`, so `memoryHigh` equals `memoryMax` at 2 GiB, and `unlimitedAccounts`, set from `AVN_HOSTED_UNLIMITED_ACCOUNTS`, gives named accounts such as the operator's the jail-wide limits and only the proxy's combined bounds.

The jail sets `pnpm_config_verify_deps_before_run=false`: pnpm 11 otherwise runs a full install before `pnpm run` when dependencies are missing, which in a fresh clone of this repository builds native modules from `nodejs.org` and GitHub release assets, hosts the proxy refuses. With it, `pnpm release:avn` on a fresh clone took 24 seconds at 613 MB on pink.

## Alternatives considered

A relay-free design, in which the launch step passes a listening socket to the proxy over the Unix socket, would cost no process per command, but Node.js cannot receive a descriptor from a socket's ancillary data, and a Python or C proxy would mean writing the HTTP and DNS handling by hand. The relay costs 0.3 MB and one fork per command.

Identifying the caller by the socket's peer process, as the Python zygote does, was rejected for the same reason: Node.js exposes no peer credentials. A token in the command's own environment identifies only that command's account.

Registering the GitHub token source through a typed event was weighed against the registry. A registry's `register()` returns a disposer and needs no event catalog entry for a question only one process asks.

Returning a Git `report-status` that names the declined ref, instead of HTTP 403, would show the model the reason. It requires speaking the push protocol's side-band reply; the hosted model note states what 403 on a push means.

Pointing pip and npm at a caching mirror inside the proxy, as ChatGPT does, would add a shared download cache and request-level rules. It needs index rewriting per registry; opaque tunnels to the registries serve the same installs with a tenth of the code. The byte bounds cover the bandwidth a cache would save.

Setting `include-system-site-packages` in the image so that `pip install --user` works was rejected: it puts the Host's 235 system Python packages on every command's import path. A `sitecustomize.py` was rejected because Ubuntu ships its own in the standard library directory, which shadows one in site-packages; a `.pth` line imports the module instead.

## Consequences

An allowed host receives whatever a command sends it, and the Git route pushes branches to any repository the account's GitHub connection may write, without a prompt; a prompt-injected session can therefore copy what it can read to a repository on GitHub. Only tag pushes, other non-branch refs, and deletions ask. A user who puts a token of their own in a URL bypasses the route and its approval.

Nothing yet limits an account's CPU time over a day, and nothing refuses new commands when the machine is saturated; the two-core limit and equal weights bound the rate only.

## Verification

In an Ubuntu 24.04 arm64 VM, under bubblewrap with the jail's namespaces and system-call filter: `git clone` of a public repository took 0.8 s, `npm install lodash express` 5 s, and `pip install requests` into `~/.local` 1.5 s while reusing the image's `idna`; a host outside the list, a plain HTTP request, a name resolving to loopback, a forged account, the 33rd connection, a 1 MiB/s limit, and a spent daily limit were each refused or throttled as configured; a clone through the Git route succeeded without a credential, a raw push of a branch was forwarded without a question, and a raw push of a tag with a branch deletion was refused with 403 after the approval question was answered no; the command's exit status and pipes were unchanged, and no relay outlived its jail. Typecheck and build pass. An approved tag push was forwarded and reached GitHub. The Landlock launcher, the sandbox user, and a push authenticated with a real GitHub connection were not part of that VM run.
