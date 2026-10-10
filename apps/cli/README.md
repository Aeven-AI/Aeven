# `@aeven/cli`

English | [中文](README.zh.md)

The `avn` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command; the SDK defaults to `sdk`, and the minimal example selects `sdk-minimal`. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

A profile that mounts the HTTP server claims the shared GUI Host before plugin boot. When a Host already serves the same Aeven home, the invocation prints its authenticated URL and exits without booting a second tree. The running Host retains its configuration; a second launch does not apply new flags or patches. Headless and stdio profiles keep their independent execution lifecycle. GUI ownership releases after application teardown or process death.

## Entry modes

| Command | Purpose |
|---|---|
| `avn --profile <name>` | Boot the named profile under `$AVN_HOME/profiles/<name>`. |
| `avn --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `avn --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `avn --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `avn --profile sdk-minimal` | Serve SDK clients with the standalone minimal agent tree. |
| `avn web` | Alias of `--profile web`. |
| `avn plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles auto-initialize on first use from shipped templates; any other profile must be created through `avn plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`avn-cmdline`](../../packages/boot/cmdline/README.md)). The first token the launcher does not recognize starts the app's arguments:

```sh
avn --profile web --port 8080       # --port belongs to the web app
avn --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
avn --profile headless "run the tests"
avn --profile web --help            # the web app's flags, not the launcher's
avn --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `avn.profile` with its ordered `bundles` list and `patchReload` lifecycle) and a `cordis.patch.yml` (the user's own patch layer). `patchReload: live` watches the profile and home-level patch files; `startup` applies them once.

The tree composes over an empty root:
- each bundle's patch in `avn.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$AVN_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `avn.profile.bundles` resolve from the avn installation first (`@aeven/base`, `@aeven/web-app`, `@aeven/headless`, `@aeven/sdk-app`, `@aeven/sdk-minimal`, `@aeven/acp-app`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Optional overlays

`config/examples/` ships opt-in overlays for GitHub review webhooks, session-local Schedule, memory MCP servers, and runtime Cordis tools. They are never part of a default profile; the [user guides](../../docs/user/guide/index.md) and [developer practice guides](../../docs/user/develop/practice/index.md) own setup and safety instructions.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm avn <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
