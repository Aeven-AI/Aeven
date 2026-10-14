<!-- 英文源文件由 scripts/gen-config-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-config-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/config-catalog.md` 重新记录配对。 -->

# 插件配置目录

[English](config-catalog.md) | 中文

每个 `config:` 块均可由 `cordis.yml` 条目设置：针对每个可加载的 harness 包，原样列出其 `apply` 函数或服务构造函数接收的配置声明（包括 JSDoc），并附上所有引用类型——包内类型直接粘贴，其他类型则提供链接。粘贴的内容是插件声明的完整配置类型——运行时 schema 有意排除的字段是仅供运行时使用的 seam（其自身的 JSDoc 会如此说明），不能通过 `cordis.yml` 设置。这是以**部署**为轴的参考文档——插件作者所依据的连接方式请参阅各[子系统页面](subsystems/core.zh.md)中的生成 `cordis-surface` 区域，面向模型的工具 schema 请参阅[工具目录](tool-catalog.zh.md)，而 [subsystems/](subsystems/core.zh.md) 则记录了这些声明所引用的类型。

英文源文件由源代码（`scripts/gen-config-catalog.ts`）生成，并通过 `pnpm run verify-config-catalog`（`doc-sync` 的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。声明块使用 `ts config-catalog` 围栏（doc-typecheck 会跳过它，因为单独引用导入项的声明无法独立编译）。英文生成器还会将运行时 schemastery schema 与粘贴的声明进行交叉核对——每个经 schema 验证的键（包括嵌套键）都必须能在声明的配置类型中找到——因此，粘贴内容无法隐藏加载器接受的字段。

`Requires:` 行列出插件通过 `inject` 注入的服务键：其 `cordis.yml` 树还必须加载这些服务的提供者。范围限定为 harness 层级（`packages/`）；配置树还可能加载的 vendored cordis 插件（`hmr`、控制台日志记录器等）固定为上游源代码（参见 [vendoring policy](../vendor/README.md)），未收录于此目录。

<a id="aevenacp"></a>
## `@aeven/acp`

需要：`agents` · `llm` · `sessionPersistence` · `sessions`

```ts config-catalog
/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Maximum summaries returned by one session/list page. */
  sessionListPageSize?: number
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}
```


依赖：`Stream`（`@agentclientprotocol/sdk`）

来源：[`packages/acp/acp/src/index.ts:75`](../packages/acp/acp/src/index.ts)

<a id="aevenagent-default-model"></a>
## `@aeven/agent-default-model`

```ts config-catalog
/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}
```


来源：[`packages/core/agent-default-model/src/index.ts:41`](../packages/core/agent-default-model/src/index.ts)

<a id="aevenagent-instructions"></a>
## `@aeven/agent-instructions`

需要：`sessionProjections`

```ts config-catalog
/** User-facing workspace instruction loader configuration. */
export interface Config {
  /** Aeven home containing the fixed user-global `AGENTS.md`; defaults to `$AVN_HOME` or `~/.aeven`. */
  avnHome?: string
  /** Directory entries that identify the project root while walking upward from the session cwd. */
  projectRootMarkers?: string[]
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  maxSourceBytes?: number
  /**
   * Ordered same-directory project candidates; every existing file loads, with
   * per-directory trimmed-content duplicates collapsed to the earliest candidate.
   */
  instructionFileCandidates?: string[]
  /**
   * Ordered same-directory local-overlay candidates loaded after the base files
   * under the same per-directory trimmed-content dedup; empty disables the overlay.
   */
  localInstructionFileCandidates?: string[]
}
```


来源：[`packages/context/agent-instructions/src/config.ts:18`](../packages/context/agent-instructions/src/config.ts)

<a id="aevenagent-loop"></a>
## `@aeven/agent-loop`

需要：`agents` · `sessions` · `llm` · `tools` · `systemPrompt` · `sessionProjections`

```ts config-catalog
/** Agent-loop plugin configuration. */
export interface Config {
  /**
   * Maximum parallel-safe calls in flight per agent step. `1` is serial;
   * omission defaults to {@link DEFAULT_MAX_PARALLEL_TOOL_CALLS}.
   */
  maxParallelToolCalls?: number
  /** Agents created or resumed at plugin startup. */
  agents: (AgentOptions & {
    /** Stable config label used in logs and as the fresh combined-id prefix. */
    id: string
    /** Optional stable identity; remounts resume its materialized history, while first use creates it fresh. */
    sessionId?: SessionId
    /** Optional workspace for a fresh session. */
    cwd?: string
    /** Persisted session to resume instead of creating a fresh session. */
    resumeSessionId?: SessionId
  })[]
}
```


依赖：[`AgentOptions`](subsystems/core.zh.md) · [`SessionId`](subsystems/core.zh.md)

来源：[`packages/core/agent-loop/src/index.ts:330`](../packages/core/agent-loop/src/index.ts)

<a id="aevenagent-presets"></a>
## `@aeven/agent-presets`

需要：`loader` · `sessionProjections`

```ts config-catalog
/** Plugin config: which preset is the default, and where presets live. */
export interface Config {
  /** Preset id mounted when a caller names none. Missing at mount time fails loud. */
  default: string
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: PresetRoot[]
  /**
   * Prepend this package's bundled shipped presets as a `system` root, before
   * every configured root, so the shipped set always mounts and wins a
   * duplicate id. The default survives a whole-`config` patch replacement;
   * only an explicit `false` — a deployment supplying purely its own presets,
   * or an embedder using the roster as bare machinery — drops the set.
   */
  includeShippedRoot: boolean
  /**
   * Append the harness home's `USER_PRESET_DIR` as a `user` root, after every
   * configured root. False mounts a roster without the derived writable root.
   */
  includeUserRoot: boolean
}

/** One directory scanned for preset subdirectories. */
export interface PresetRoot {
  /** Directory holding one subdirectory per preset; a leading `~` expands. */
  path: string
  /** Trust recorded on every preset discovered under this root. */
  trust: PresetTrust
}

/**
 * Where a preset's composition came from. A `system` preset ships with the
 * deployment; a `user` preset was authored locally, by a person or by an
 * agent, and therefore carries the same trust as shell access.
 */
export type PresetTrust = 'system' | 'user'
```


来源：[`packages/preset/agent-presets/src/preset.ts:52`](../packages/preset/agent-presets/src/preset.ts)

<a id="aevenagent-tool-presentation"></a>
## `@aeven/agent-tool-presentation`

需要：`tools`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The form this agent's model sees. `native` sends every visible schema,
   * `ptc` sends only `run_code` plus a generated SDK, `both` sends both.
   * Required rather than defaulted: the deployment default is what a preset
   * without this row already gets, so an omitted value would mean the row was
   * composed for nothing.
   */
  mode: ToolPresentationMode
}
```


依赖：[`ToolPresentationMode`](subsystems/tools.zh.md)

来源：[`packages/core/agent-tool-presentation/src/index.ts:38`](../packages/core/agent-tool-presentation/src/index.ts)

<a id="aevenapi-gateway"></a>
## `@aeven/api-gateway`

需要：`typert`

```ts config-catalog
/** Gateway transport configuration. */
export interface Config {
  /** WebSocket Ping interval from 1 through 2,147,483,647 milliseconds. @default 2000 */
  readonly websocketHeartbeatIntervalMs?: number
}
```


来源：[`packages/api/gateway/src/index.ts:119`](../packages/api/gateway/src/index.ts)

<a id="aevenapi-session-controller"></a>
## `@aeven/api-session-controller`

需要：`agentDefaultModel` · `agents` · `attachments` · `llm` · `sessions` · `sessionProjections` · `sessionQuery` · `typert` · `workspaceRegistry`

```ts config-catalog
/** Session Controller deployment policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}
```


来源：[`packages/api/session-controller/src/index.ts:69`](../packages/api/session-controller/src/index.ts)

<a id="aevenapi-settings-controller"></a>
## `@aeven/api-settings-controller`

```ts config-catalog
/** Native document-opening policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}
```


来源：[`packages/api/settings-controller/src/index.ts:36`](../packages/api/settings-controller/src/index.ts)

<a id="aevenattachment-local"></a>
## `@aeven/attachment-local`

```ts config-catalog
/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `AVN_HOME`, then `~/.aeven`. */
  avnHome?: string
  /** Maximum encoded bytes accepted for one submitted image. Default: 20 MiB. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. Default: 20. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. Default: 200 MiB. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one submitted image. Default: 64,000,000. */
  maxImagePixels?: number
  /** Maximum intrinsic width and maximum intrinsic height accepted for one submitted image. Default: 8192px. */
  maxImageDimension?: number
  /** Total-pixel budget of the stored provider-independent normalized image. */
  normalizedImageMaxPixels?: number
  /** Long-edge pixel cap of the stored provider-independent normalized image, applied after the total-pixel budget. */
  normalizedImageMaxDimension?: number
  /**
   * Encoded-byte target of the stored provider-independent normalized image;
   * the smallest quality-ladder output is kept when no quality fits.
   */
  normalizedImageMaxBytes?: number
  /** Maximum simultaneous normalization or request-image transformations in this service instance. */
  imageCompressionConcurrency?: number
}
```


来源：[`packages/attachment/attachment-local/src/index.ts:55`](../packages/attachment/attachment-local/src/index.ts)

<a id="aevenbash-local"></a>
## `@aeven/bash-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
}
```


来源：[`packages/shell/bash-local/src/index.ts:41`](../packages/shell/bash-local/src/index.ts)

<a id="aevenbash-sandbox"></a>
## `@aeven/bash-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@aeven/sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The runner
 * choice is likewise the `ctx.sandbox` provider's config, not this executor's.
 */
export type Config = LocalConfig
```


依赖：[`LocalConfig`](#aevenbash-local)

来源：[`packages/shell/bash-sandbox/src/index.ts:35`](../packages/shell/bash-sandbox/src/index.ts)

<a id="aevenclient-connection"></a>
## `@aeven/client-connection`

需要：`credentials`

```ts config-catalog
/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}
```


来源：[`packages/client/connection/src/index.ts:70`](../packages/client/connection/src/index.ts)

<a id="aevenclient-hmr"></a>
## `@aeven/client-hmr`

需要：`clientModules` · `webServer`

```ts config-catalog
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Bundle stat-poll interval in milliseconds (default 500, the build-side watcher's polling default). */
  pollIntervalMs?: number
}
```


来源：[`packages/client/hmr/src/index.ts:31`](../packages/client/hmr/src/index.ts)

<a id="aevenclient-modules"></a>
## `@aeven/client-modules`

需要：`loader`

```ts config-catalog
/** Startup combo partitioning policy. */
export interface Config {
  /**
   * Maximum generated JavaScript bytes per initial combo when one bundle fits;
   * oversized bundles stand alone. @default 786432
   */
  readonly maxInitialBatchBytes?: number
}
```


来源：[`packages/client/modules/src/index.ts:320`](../packages/client/modules/src/index.ts)

<a id="aevencode-runtime-worker-thread"></a>
## `@aeven/code-runtime-worker-thread`

```ts config-catalog
/** Plugin config: every execution cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * Busy-time budget in milliseconds: the run fails with kind `'timeout'`
   * once the worker's MEASURED event-loop active time
   * (`worker.performance.eventLoopUtilization()`) exceeds this. Metering
   * measured busy time — not wall time, not host-side pending-call
   * bookkeeping — is what makes the budget both fair (a program awaiting a
   * slow tool accrues nothing) and ungameable (a hot loop accrues whether
   * or not a decoy dispatch is in flight).
   */
  computeMs?: number
  /**
   * Wall-clock ceiling in milliseconds; never pauses for anything. The
   * backstop for what busy-time cannot see (a program awaiting a promise
   * nobody will resolve). At most `2_147_483_647` (Node's maximum
   * `setTimeout` delay, about 24.9 days): a longer value is rejected at load
   * because `setTimeout` would clamp it to 1 ms.
   */
  maxWallMs?: number
  /**
   * Hard cap for serialized log-array, completion-value, and failure-message payloads;
   * fixed result-envelope syntax is excluded.
   */
  maxOutputBytes?: number
  /** The worker's max old-generation heap in MiB (`resourceLimits`); overflow kills the worker, surfacing as kind `'worker-exit'`. */
  maxOldGenerationSizeMb?: number
}
```


来源：[`packages/code-runtime/code-runtime-worker-thread/src/index.ts:25`](../packages/code-runtime/code-runtime-worker-thread/src/index.ts)

<a id="aevencompaction-basic"></a>
## `@aeven/compaction-basic`

需要：`llm` · `tokenMeter` · `sessions`

```ts config-catalog
/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactionPolicyConfig {
  /** Compact at this fraction of the model's context window. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to `8192`. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /**
   * Maximum retries after a provider rejection compaction can resolve — an
   * outgrown context window or more message entries than the endpoint accepts;
   * `0` disables recovery. Defaults to `1`.
   */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}
```


来源：[`packages/compaction/compaction-basic/src/types.ts:42`](../packages/compaction/compaction-basic/src/types.ts)

<a id="aevencompaction-tool-result-pruner"></a>
## `@aeven/compaction-tool-result-pruner`

需要：`tokenMeter`

```ts config-catalog
/** Character-budget policy for deterministic tool-result pruning. */
export interface ToolResultPruneConfig {
  /** Prune when total text exceeds this many Unicode code points. Defaults to `8192`. */
  thresholdChars?: number
  /** Maximum leading Unicode code points retained. Defaults to `4096`. */
  headChars?: number
  /** Maximum trailing Unicode code points retained. Defaults to `1024`. */
  tailChars?: number
}
```


来源：[`packages/compaction/compaction-tool-result-pruner/src/types.ts:5`](../packages/compaction/compaction-tool-result-pruner/src/types.ts)

<a id="aevencomputer-use-macos-provider"></a>

## `@aeven/computer-use-macos-provider`

需要：`computerUse`

```ts config-catalog
/** Configuration a composition may supply. */
export interface Config {
  /**
   * Bundle ids whose Automation permission the readiness report should probe.
   *
   * Empty by default: probing sends an Apple Event, and on macOS the first event to an
   * application raises a consent prompt. Prompting for applications the user has not
   * asked for is exactly the behaviour this stack set out to remove, so a deployment
   * names its applications deliberately.
   */
  automationTargets?: string[]
  /**
   * Extra recipes merged over the starter book, so a deployment can add its own
   * without this package knowing about them.
   */
  recipes?: RecipeBook
  /**
   * Whether to claim the exclusive slot. Present so a deployment can load this row for
   * its readiness reporting while another provider drives, which is how a migration off
   * the MCP wrapper is staged rather than cut over.
   */
  register?: boolean
}
```

Depends on: [`RecipeBook`](../packages/computer-use/computer-use-router/src/index.ts)

Source: [`packages/computer-use/computer-use-macos-provider/src/index.ts:54`](../packages/computer-use/computer-use-macos-provider/src/index.ts)

<a id="aevencordis-host-runner"></a>
## `@aeven/cordis-host-runner`

需要：`tools`

```ts config-catalog
/** Runner configuration. */
export interface Config {
  /** Maximum synchronous VM evaluation time in milliseconds. */
  vmTimeoutMs?: number
}
```


来源：[`packages/extensions/cordis-host-runner/src/index.ts:88`](../packages/extensions/cordis-host-runner/src/index.ts)

<a id="aevencredentials-local"></a>
## `@aeven/credentials-local`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Credentials document path; defaults to `.credentials.yaml` under the harness home. */
  path?: string
  /** Aeven home used when `path` is omitted; defaults to `$AVN_HOME` or `~/.aeven`. */
  avnHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```


来源：[`packages/credentials/credentials-local/src/index.ts:71`](../packages/credentials/credentials-local/src/index.ts)

<a id="aevene2b"></a>
## `@aeven/e2b`

```ts config-catalog
/** Configuration for the shared E2B sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}
```


来源：[`packages/e2b/e2b/src/index.ts:45`](../packages/e2b/e2b/src/index.ts)

<a id="aevenexperimental-agent-team"></a>
## `@aeven/experimental-agent-team`

需要：`agents` · `sessions` · `sessionPersistence` · `sessionProjections` · `subagents`

```ts config-catalog
/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum queued-minus-delivered messages for one target member. */
  readonly maxPendingMessagesPerMember?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds allowed for Team-owned runtime disposal. */
  readonly disposalTimeoutMs?: number
}
```


来源：[`packages/experimental/agent-team/src/types.ts:131`](../packages/experimental/agent-team/src/types.ts)

<a id="aevenexperimental-code-runtime-python"></a>
## `@aeven/experimental-code-runtime-python`

```ts config-catalog
/** Plugin config: every cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * RLIMIT_CPU in whole seconds (a positive integer — `setrlimit` in the child
   * rejects a float). The child sets the soft limit to `cpuSeconds` and the
   * hard limit to `cpuSeconds + 1`: the kernel delivers SIGXCPU at the soft
   * limit, which the host classifies as a `timeout`; the +1s hard limit is a
   * SIGKILL backstop for a program that traps SIGXCPU. Granularity is seconds —
   * a coarser counterpart to the worker backend's millisecond `computeMs`.
   */
  cpuSeconds?: number
  /** Wall-clock ceiling in milliseconds; backstops CPU time for programs awaiting a promise nobody resolves. */
  maxWallMs?: number
  /**
   * RLIMIT_AS in mebibytes; caps address space so a runaway allocation fails
   * cleanly. Not applied on Darwin, where the dyld shared cache mapped into
   * every process at exec exceeds any practical cap and the kernel rejects
   * the call; `cpuSeconds` and `maxWallMs` still bound the run there. Bounds
   * `maxLogBytes`/`maxValueBytes` at load on EVERY platform (this static check
   * runs on Darwin too, where only the runtime `setrlimit` is skipped): each
   * budget times a worst-case Unicode expansion must fit this byte count minus a
   * fixed interpreter baseline, so a near-budget output cannot breach the address
   * space during the child's build-and-encode.
   */
  addressSpaceMb?: number
  /**
   * Shared byte budget for captured log text (host-side ledger). Bounded at load
   * against `addressSpaceMb`: the child builds and encodes a near-budget entry
   * under RLIMIT_AS with several copies live at once, so this cap times the
   * worst-case Unicode expansion must fit the address space left after the
   * interpreter baseline (see `addressSpaceMb`) — a load-time rejection, not a
   * runtime clamp. Also bounded at load by the host's configured heap like
   * `maxValueBytes` (see its JSDoc): the effective frame cap minus the frame
   * envelope.
   */
  maxLogBytes?: number
  /**
   * Byte cap for the completion value. Bounded at load against `addressSpaceMb`
   * the same way `maxLogBytes` is: the child builds and encodes a near-budget
   * value under RLIMIT_AS with several copies live at once, so this cap times the
   * worst-case Unicode expansion must fit the address space left after the
   * interpreter baseline. Both budgets are ALSO bounded at load by the host's
   * configured heap: the effective frame cap (the protocol cap, or a lower
   * heap-derived ceiling when the host heap cannot safely parse a near-cap
   * frame — see `hostFrameParseCeiling`) minus the frame envelope, so a budget
   * whose honest frame could OOM the host's own JSON.parse is rejected up
   * front.
   */
  maxValueBytes?: number
  /** SIGTERM→SIGKILL grace period on kill, matching bash-local's default. */
  graceMs?: number
  /**
   * Absolute path, relative path, or basename of a CPython 3.10+ interpreter.
   * Resolved and validated once at plugin load under a five-second force-kill
   * deadline; a basename searches `PATH`.
   */
  pythonBin?: string
}
```


来源：[`packages/experimental/code-runtime-python/src/index.ts:47`](../packages/experimental/code-runtime-python/src/index.ts)

<a id="aevencomputer-use-cua-driver-mcp"></a>
## `@aeven/computer-use-cua-driver-mcp`

需要：`computerUse` · `tools`

```ts config-catalog
/** Installed executable and MCP connection overrides. */
export interface Config {
  /** Executable path or PATH command; defaults to `cua-driver`. */
  command: string
  /** Arguments passed without a shell; defaults to `['mcp']`. */
  args: string[]
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
}
```

依赖：[`McpClient`](../packages/mcp/mcp-client/src/index.ts)

来源：[`packages/computer-use/computer-use-cua-driver-mcp/src/index.ts:20`](../packages/computer-use/computer-use-cua-driver-mcp/src/index.ts)

<a id="aevenexperimental-inspector"></a>
## `@aeven/experimental-inspector`

需要：`webServer`

```ts config-catalog
/** Host plugin configuration. Fetch capture is enabled by default. */
export interface Config extends Omit<InspectorOptions, 'clientOrigins'> {
  /** Browser origins allowed to open the Client ingest WebSocket. */
  clientOrigins?: string[]
}

/** User-facing Host options; every memory and lifecycle bound is configurable. */
export interface InspectorOptions {
  /** Loopback address used by the Worker HTTP and WebSocket endpoint. */
  readonly host?: '127.0.0.1'
  /** First port to bind; occupied ports advance until one is available. */
  readonly port?: number
  /** Additional exact browser origins admitted to the Client ingest socket. */
  readonly clientOrigins?: readonly string[]
  /** Whether to observe calls made through the current global fetch function. */
  readonly captureFetch?: boolean
  /** Maximum request-body prefix retained for one fetch. */
  readonly maxRequestBodyBytes?: number
  /** Maximum response-body prefix retained for one fetch. */
  readonly maxResponseBodyBytes?: number
  /** Maximum raw bytes encoded into one body observation. */
  readonly maxBodyChunkBytes?: number
  /** Maximum total request and response body bytes retained by the Worker. */
  readonly maxJournalBytes?: number
  /** Maximum active and completed fetch requests retained by the Worker. */
  readonly maxRetainedRequests?: number
  /** Maximum encoded bytes accepted in one source transport frame. */
  readonly maxSourceFrameBytes?: number
  /** Maximum observation records accepted in one source batch. */
  readonly maxSourceRecordsPerFrame?: number
  /** Maximum records waiting in one producer queue. */
  readonly maxQueuedRecords?: number
  /** Maximum encoded bytes waiting in one producer queue. */
  readonly maxQueuedBytes?: number
  /** Maximum time allowed for the Worker to become ready. */
  readonly startupTimeoutMs?: number
  /** Grace period before a stopping Worker is terminated. */
  readonly stopTimeoutMs?: number
  /** Initial upper bound for randomized Client reconnect delay. */
  readonly clientReconnectBaseMs?: number
  /** Maximum upper bound for randomized Client reconnect delay. */
  readonly clientReconnectMaxMs?: number
  /** Deadline for one Worker-to-Client Runtime or Sources request. */
  readonly clientRuntimeTimeoutMs?: number
  /** Deadline for one non-CDP semantic query. */
  readonly queryTimeoutMs?: number
  /** Maximum live object handles retained per Client Runtime session. */
  readonly maxClientRuntimeObjects?: number
  /** Maximum descriptors returned by one Client property request. */
  readonly maxClientRuntimeProperties?: number
  /** Maximum encoded bytes read for one Client script or source map. */
  readonly maxClientSourceBytes?: number
  /** Maximum Context and Fiber nodes retained in one realm snapshot. */
  readonly maxCordisNodes?: number
  /** Disconnected Cordis snapshots retained after their live realm closes. */
  readonly maxDisconnectedCordisTrees?: number
}
```


来源：[`packages/experimental/inspector/src/index.ts:66`](../packages/experimental/inspector/src/index.ts)

<a id="aevensubscription-auth"></a>
## `@aeven/subscription-auth`

需要：`webServer`

```ts config-catalog
/** Plugin configuration; every field is optional. */
export interface Config {
  /** HTTP(S) proxy URL for the audited coding-subscription host allowlist. */
  proxy?: string
  /**
	 * Optional provider retry policy override for the four OAuth routes. When
	 * omitted, the plugin retries transient failures (rate limit, server,
	 * timeout, transport, empty response) plus AUTH — the latter is safe because
	 * the stored credential is invalidated on every AUTH finish, so the retried
	 * step refreshes before reuse. Quota exhaustion is never retried.
	 */
  retryPolicy?: RetryPolicyConfig
  /** Secret-free composition/YAML defaults below live user settings. */
  capabilities?: CapabilitySettingsPatch
  /**
	 * Which upstream Imagine calls authorize against. `auto` (the default) uses
	 * `XAI_API_KEY` against the developer API when that credential is configured
	 * and otherwise takes the Grok Build chat proxy with the subscription's OAuth
	 * access token, which is the route the official Grok CLI takes and requires a
	 * SuperGrok tier. `xai-api` and `grok-build` pin one route and fail loudly
	 * when its credential is missing.
	 */
  imagineTransport?: 'auto' | 'xai-api' | 'grok-build'
  /**
   * Imagine API request timeout. The subscription route proxies generation
   * through the Grok Build chat proxy, which is slower than the direct xAI API,
   * so the ceiling is deployment-varying rather than fixed.
   */
  imagineApiTimeoutMs?: number
  /** Owner-only request authorization for loopback, SSH tunnels, and trusted HTTPS proxies. */
  ownerRequest?: {
    /** Whether a loopback caller is the operator directly, or arrives over an SSH tunnel. */
    loopbackAccessMode?: 'loopback' | 'ssh-tunnel'
    /** Accept owner requests forwarded by a proxy that proves itself with the fields below. */
    trustedProxy?: {
      /** Peer addresses whose forwarded requests may be considered at all. */
      peers?: string[]
      /** Origins the forwarded request may declare. */
      origins?: string[]
      /** Shared secret the proxy sends to prove it speaks for the operator. */
      ownerProof?: string
      /** Token the proxy echoes on state-changing requests, defeating cross-site forgery. */
      csrfToken?: string
    }
  }
}

/** Sparse overlay used for YAML/composition `base` and the user section. */
export type CapabilitySettingsPatch = Partial<CapabilitySettings>

/** Resolved, secret-free capability section. */
export interface CapabilitySettings {
  /** Publish Codex-backed web search, which spends the Codex subscription's quota. */
  readonly codexSearch: boolean
  /** Publish the Codex image generation tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly codexImages: boolean
  /** Publish the Codex image edit tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly codexImageEdits: boolean
  /** Allow non-Codex-route models to use the Codex image generate/edit tools. Fixed on. */
  readonly codexImagesAnyModel: boolean
  /** Publish the Codex Fast route when the live catalogue confirms priority eligibility. */
  readonly codexFast: boolean
  /** Publish the Grok Imagine image tool. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly grokImagineImage: boolean
  /** Publish the Grok Imagine video tools. Fixed on; see {@link FIXED_CAPABILITIES}. */
  readonly grokImagineVideo: boolean
  /** Upper bound on results returned by Codex-backed search. */
  readonly searchResults: number
  /** Images one generate call may return. Pinned to the provider maximum. */
  readonly imageCount: number
  /** How long a generated video artifact is retained. Pinned to the provider maximum. */
  readonly videoArtifactTtlMs: number
}
```


Depends on: [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

Source: [`packages/llm/subscription-auth/src/index.ts:252`](../packages/llm/subscription-auth/src/index.ts)

<a id="aevenexperimental-tool-agent-team"></a>
## `@aeven/experimental-tool-agent-team`

需要：`agents` · `agentTeams` · `tools` · `systemPrompt`

```ts config-catalog
/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
}
```


来源：[`packages/experimental/tool-agent-team/src/index.ts:17`](../packages/experimental/tool-agent-team/src/index.ts)

<a id="aevenfile-reference-local"></a>
## `@aeven/file-reference-local`

需要：`agents` · `sessionProjections`

```ts config-catalog
/** Local file-reference discovery configuration. */
export interface Config {
  /** Maximum ranked candidates returned for one query. */
  maxResults?: number
  /** Maximum indexed files and directories per agent workspace. */
  maxEntries?: number
  /** Directory basenames never traversed or offered. */
  excludedDirectories?: string[]
}
```


来源：[`packages/context/file-reference-local/src/index.ts:34`](../packages/context/file-reference-local/src/index.ts)

<a id="aevenfs-local"></a>
## `@aeven/fs-local`

```ts config-catalog
/** Configuration for the local filesystem backend. */
export interface Config {
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Exclusive UTF-8 byte limit on each overwrite-diff side, capped by the
   * runtime's safe allocation/decode maximum. Defaults to 10 MiB.
   */
  diffBasisMaxBytes?: number
}
```


来源：[`packages/fs/fs-local/src/index.ts:41`](../packages/fs/fs-local/src/index.ts)

<a id="aevenfs-sandbox"></a>
## `@aeven/fs-sandbox`

需要：`sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local backend's knobs verbatim (`cwd` resolution default
 * and `diffBasisMaxBytes` overwrite-presentation bound). The sandbox default
 * (mode + `workspace-write` fallback root) is NOT here — `ctx.sandboxPolicy`
 * resolves each calling session for every enforcing capability.
 */
export type Config = LocalConfig
```


依赖：[`LocalConfig`](#aevenfs-local)

来源：[`packages/fs/fs-sandbox/src/index.ts:45`](../packages/fs/fs-sandbox/src/index.ts)

<a id="aevengoal"></a>
## `@aeven/goal`

需要：`agents` · `sessionProjections`

```ts config-catalog
/** Deployment defaults for goal creation. */
export interface Config {
  /** Total rounds used when a create request omits its own cap. */
  defaultMaxGoalRounds?: number
}
```


来源：[`packages/goal/goal/src/index.ts:172`](../packages/goal/goal/src/index.ts)

<a id="aevenheadless"></a>
## `@aeven/headless`

需要：`agentDefaultModel` · `agents` · `sessions`

```ts config-catalog
/** Plugin config: the task resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
}
```


来源：[`packages/bundle/headless/src/index.ts:34`](../packages/bundle/headless/src/index.ts)

<a id="aevenhooks-claude-code"></a>
## `@aeven/hooks-claude-code`

需要：`shell` · `sessionProjections`

```ts config-catalog
/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```


来源：[`packages/hooks/hooks-claude-code/src/index.ts:46`](../packages/hooks/hooks-claude-code/src/index.ts)

<a id="aevenhooks-codex"></a>
## `@aeven/hooks-codex`

需要：`shell` · `sessionProjections`

```ts config-catalog
/** Plugin config: where the Codex hooks.json lives + the model name for payloads. */
export interface Config {
  /**
   * Path to a Codex `hooks.json`. Process-level: read once at load, a relative
   * path resolves against the process launch cwd.
   * TODO(per-session-hook-config): per-session project-local discovery from each
   * `session/new.cwd`.
   */
  configPath: string
  /** The model name stamped on every payload (Codex includes `model` on each event). */
  model?: string
  /** Default per-hook timeout in ms when a hook sets none (Codex default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```


来源：[`packages/hooks/hooks-codex/src/index.ts:45`](../packages/hooks/hooks-codex/src/index.ts)

<a id="aevenhost-directory-picker-browse"></a>
## `@aeven/host-directory-picker-browse`

```ts config-catalog
/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}
```


来源：[`packages/host/directory-picker-browse/src/index.ts:181`](../packages/host/directory-picker-browse/src/index.ts)

<a id="aevenhost-frontend-static"></a>
## `@aeven/host-frontend-static`

需要：`webServer` · `connection`

```ts config-catalog
/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}
```


来源：[`packages/host/frontend-static/src/index.ts:32`](../packages/host/frontend-static/src/index.ts)

<a id="aevenhost-webserver"></a>
## `@aeven/host-webserver`

```ts config-catalog
/** Web server listen and response-compression config. */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
  /** Response compression for socket-backed HTTP requests. @default 'none' */
  compression?: 'none' | 'gzip'
  /** Gzip DEFLATE level from 0 through 9. @default 1 */
  compressionLevel?: number
  /** Minimum known response length eligible for gzip; unknown-length streams are eligible. @default 1024 */
  compressionThresholdBytes?: number
}
```


来源：[`packages/host/webserver/src/index.ts:62`](../packages/host/webserver/src/index.ts)

<a id="aevenhost-workspace-files"></a>
## `@aeven/host-workspace-files`

需要：`webServer` · `connection` · `workspaceRegistry`

```ts config-catalog
/** Plugin config: where the read-only workspace tree is mounted. */
export interface Config {
  /** Absolute route prefix, no trailing slash. */
  mount: string
}
```


来源：[`packages/host/workspace-files/src/index.ts:36`](../packages/host/workspace-files/src/index.ts)

<a id="aevenidentity-user-aeven"></a>
## `@aeven/identity-user-aeven`

需要：`identityUsers`

```ts config-catalog
/** Config for the Aeven authority. */
export interface Config {
  /** Registry key under the seam. Defaults to `aeven`. */
  id?: string
  /** Environment variable holding the access-token secret; the API's `JWT_SECRET`. */
  accessSecretEnv?: string
  /** Environment variable holding the refresh-token secret; the API's `REFRESH_SECRET`. */
  refreshSecretEnv?: string
  /** Cookie carrying the refresh token for a request that presents no bearer. */
  refreshCookieName?: string
  /**
   * Origin of the Aeven API the browser signs in against, such as
   * `http://localhost:9000`. Absent leaves the web client with no
   * authentication surface, which is how a harness without Aeven behaves.
   */
  apiUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  xOAuthUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  appleOAuthUrl?: string
  /** Provider sign-in URL; absent hides that provider's button. */
  googleOAuthUrl?: string
  /**
   * How a provider sign-in reaches the provider, once any `*OAuthUrl` is set.
   *
   * Required with an oauth URL and meaningless without one, so a deployment
   * that offers a provider states which shape it serves rather than inheriting
   * one that suits a different deployment. A public site states `redirect`; an
   * installed application serving its own page states `window`.
   */
  oauthFlow?: OAuthFlow
  /**
   * Origin of the Aeven web client, such as `http://localhost:3030`. The
   * account menu links there; absent leaves the menu with no account rows,
   * because a harness that cannot name the account page must not invent one.
   */
  webUrl?: string
  /**
   * Origin serving Aeven's uploaded media, such as `http://localhost:9020`.
   * Profile-image paths are relative to it; absent leaves every reader on the
   * generated gradient.
   */
  mediaUrl?: string
  /**
   * Credential reference the access token this authority verifies answers to.
   *
   * The token is the caller's Aeven session, and `llm-aeven` presents one to
   * Aeven's own `/v1` on the caller's behalf, so the two must name the same
   * reference. Stated here as well as there because this authority is what
   * proves the token, and a name only one side knows publishes nothing. An
   * operator pointing a custom endpoint at Aeven sets both to the same value.
   */
  credentialRef?: string
}

/**
 * How a provider sign-in reaches the provider's consent screen.
 *
 * `redirect` navigates the page's own document: the reader leaves this origin,
 * the provider returns them to `<this origin>/oauth-result/<session>/<challenge>`,
 * and the kernel boots again on that document. A public deployment wants this —
 * it is the shape provider registrations and popup blockers both expect.
 *
 * `window` reaches the provider from a separate window and never moves the
 * application's document, so a reader who signs in keeps the page they were on.
 * An installed application serves its own page from a scheme or a loopback
 * origin, where a redirected document would be a second shell to boot and, on
 * the desktop, a new window to open. The landing document reports its result
 * back to the window that opened it and closes.
 */
export type OAuthFlow = 'redirect' | 'window'
```


来源：[`packages/identity/user-aeven/src/index.ts:64`](../packages/identity/user-aeven/src/index.ts)

<a id="aeveninvariants"></a>
## `@aeven/invariants`

```ts config-catalog
/** Runtime invariant selection configured on the service plugin. */
export interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```


来源：[`packages/runtime-diagnostics/invariants/src/index.ts:15`](../packages/runtime-diagnostics/invariants/src/index.ts)

<a id="aevenjobs-local"></a>
## `@aeven/jobs-local`

```ts config-catalog
/** Configuration for the process-local job registry. */
export interface Config {
  /**
   * Maximum `running` plus `stopping` jobs per exact owner or in the shared unowned bucket;
   * omission defaults to 10.
   */
  maxConcurrentJobsPerOwner?: number
}
```


来源：[`packages/jobs/jobs-local/src/index.ts:31`](../packages/jobs/jobs-local/src/index.ts)

<a id="aevenllm-aeven"></a>

## `@aeven/llm-aeven`

需要：`llm`

```ts config-catalog
/**
 * Entry and user-settings configuration.
 *
 * Declared rather than inferred, because schemastery's `z` is a callable generic
 * rather than a namespace — the same shape `@aeven/llm-deepseek` uses.
 */
export interface Config {
  /** Aeven API origin; `/v1` is appended. Defaults to the development gateway. */
  apiUrl?: string
  /** Credential holding the signed-in session; defaults to `AEVEN_TOKEN`. */
  apiKeyEnv?: string
  /** Advisory catalog shown to the picker; defaults to the shipped Aeven models. */
  models?: DeepSeekCatalogModel[]
  /** Forwarded to the gateway, which accepts both values. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort; `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap; a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * The image and Files knobs below are inert on this route: the gateway accepts
   * images inline as `image_url` parts and has no files API to upload them to,
   * so nothing here ever offloads, uploads, or expires. They are declared
   * because {@link DeepSeekConnectionOptions} requires a complete set, and they
   * are pinned to the adapter's own defaults so an upstream change is inherited
   * rather than silently overridden here. Each is documented for what it does on
   * the route that uses it, not for what it does on this one.
   */
  /** High watermark for retained request-image bytes before oldest-first offload. */
  maxRequestFilesBytes?: number
  /** Independent base64 fallback high watermark, applied when Files mode is unavailable. */
  maxInlineRequestImageBytes?: number
  /** High watermark for retained request-image count. */
  maxImagesPerRequest?: number
  /** Files-mode oldest-prefix removal quantum, in bytes. */
  imageOffloadByteQuantum?: number
  /** Inline-mode oldest-prefix removal quantum, in bytes. */
  inlineImageOffloadByteQuantum?: number
  /** Count-overflow removal quantum, in images. */
  imageOffloadCountQuantum?: number
  /** Per-image Files resolution deadline. */
  filesApiTimeoutMs?: number
  /** Requested uploaded-image lifetime; the provider clamps values outside its own range. */
  fileExpiresAfterSeconds?: number
  /** Remaining lifetime below which a cached upload id is replaced rather than reused. */
  fileRefreshMarginSeconds?: number
  /** Oldest harness-owned files removed before one upload retry after a quota refusal. */
  fileQuotaCleanupBatch?: number
  /** Transport retry policy, resolved once at registration. */
  retryPolicy?: RetryPolicyConfig
}
```

依赖： [`DeepSeekCatalogModel`](../packages/llm/llm-deepseek/src/index.ts) · [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/llm/llm-aeven/src/index.ts:178`](../packages/llm/llm-aeven/src/index.ts)

<a id="aevenllm-deepseek"></a>
## `@aeven/llm-deepseek`

需要：`llm`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-deepseek` settings-section shape. Every field is optional in
 * yml: a missing API key resolves through {@link Config.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp. */
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Maximum accumulated file-referenced image bytes per chat request (default 128 MiB). */
  maxRequestFilesBytes?: number
  /** Maximum accumulated base64 image payload after Files API fallback (default 20 MiB). */
  maxInlineRequestImageBytes?: number
  /** Maximum number of represented images per chat request (default 600). */
  maxImagesPerRequest?: number
  /** Raw-byte removal step after the request exceeds its file bound (default 64 MiB). */
  imageOffloadByteQuantum?: number
  /** Base64-byte removal step after inline fallback exceeds its bound (default 10 MiB). */
  inlineImageOffloadByteQuantum?: number
  /** Image-count removal step after the request exceeds its count bound (default 20). */
  imageOffloadCountQuantum?: number
  /** Maximum duration of one request-image Files API resolution (default one minute). */
  filesApiTimeoutMs?: number
  /** Explicit lifetime assigned to each uploaded image (default seven days). */
  fileExpiresAfterSeconds?: number
  /** Remaining lifetime below which an indexed file is replaced (default one hour). */
  fileRefreshMarginSeconds?: number
  /** Oldest harness-owned files deleted before one quota-recovery upload retry (default 100). */
  fileQuotaCleanupBatch?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

/** One optional model entry advertised by the direct-fetch adapter. */
export interface DeepSeekCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link DeepSeekConnectionOptions.maxTokens}. */
  maxTokens?: number
  /** Accepted request modalities; omission is text-only. */
  inputModalities?: ModelModality[]
  /** Total-pixel budget for one deterministic request preview, or the 512-by-512 `low` preset. */
  imagePixelBudget?: number | 'low'
  /** Encoded-byte target for one deterministic request preview; the smallest quality-ladder output is used when no quality fits. */
  imageMaxBytes?: number
}
```


依赖：[`ModelModality`](../packages/llm/llm/src/index.ts) · [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/llm/llm-deepseek/src/index.ts:125`](../packages/llm/llm-deepseek/src/index.ts)

<a id="aevenllm-pi-ai"></a>
## `@aeven/llm-pi-ai`

需要：`llm`

```ts config-catalog
/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /**
   * pi-ai provider routes, keyed by provider. An empty (or omitted) dict is
   * the dormant settings-driven posture: the adapter mounts with no routes
   * and registers them the moment a settings section supplies profiles.
   */
  providers?: Record<string, PiAiProviderProfile>
}

/** Configuration for one pi-ai provider route; the `providers` dict key IS the route. */
export interface PiAiProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName?: string
  /**
   * Wire protocol every model on this route speaks. Omission keeps each
   * installed catalog model's own protocol, which is why a catalog route needs
   * no protocol at all; a route the catalog does not ship must name one.
   */
  api?: string
  /** Endpoint for this route's models; defaults to the installed catalog's endpoint. */
  baseURL?: string
  /**
   * This route's model catalog. Omission serves the installed catalog for the
   * route unchanged; an explicit list replaces it, each entry defaulting its
   * unset fields from the installed model of the same id.
   */
  models?: PiAiModelProfile[]
  /**
   * Installed-catalog customizations by model id: each entry reshapes that
   * one model with the same fields a {@link models} entry takes, while the
   * rest of the catalog keeps serving untouched. Only meaningful on a catalog
   * route with no `models` list — `models` already replaces the catalog, so
   * an override beside it, on a route the catalog does not ship, or naming a
   * model the catalog does not describe is refused rather than skipped.
   */
  modelOverrides?: Record<string, PiAiModelOverride>
  /**
   * Live model-list refresh for a route whose provider publishes an
   * OpenRouter-style `GET /models` document. Absent, the route serves the
   * installed pi-ai snapshot alone, which lags whatever the provider
   * currently lists.
   *
   * The refresh is additive: it adds the published models the snapshot does
   * not describe and never rewrites one it does, because the snapshot carries
   * tuned reasoning and compatibility values the document does not express.
   * A failed or slow refresh leaves the route serving the snapshot.
   */
  catalogRefresh?: PiAiCatalogRefresh
  /**
   * pi-ai wire-compatibility switches defaulting every model on this route
   * whose protocol declares them; each model's own `compat` overrides per
   * field. What neither sets keeps the installed catalog entry's value, then
   * pi-ai's own detection. A switch no model on the route could read is
   * refused rather than left looking applied.
   */
  compat?: PiAiCompatProfile
  /**
   * Context capacity for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 262,144). A guess by construction, so
   * a deployment whose gateway serves smaller models corrects it here.
   */
  defaultContextWindow?: number
  /**
   * Output capability for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 32,768). This sizes the model; it
   * never becomes a per-request cap on its own.
   */
  defaultMaxTokens?: number
  /**
   * Request modalities for a model this route lists that neither its entry's
   * {@link PiAiModelProfile.input} nor the installed catalog declares (default
   * `[text]`). A fallback like the capacities above, not an override: a
   * catalog model keeps the modalities the catalog records for it, and this
   * value never narrows one. A gateway serving vision models the catalog does
   * not describe declares `[text, image]` once here instead of on every entry.
   * Unlike an entry's list, this one may not be empty — nothing sits below it
   * to answer instead.
   */
  defaultInput?: PiAiModality[]
  /** Provider request headers, validated against Fetch when the profile resolves; Aeven attribution wins reserved names. */
  headers?: Record<string, string>
  /** Provider-neutral pi-ai reasoning level. */
  reasoning?: ModelThinkingLevel
  /** Token budgets used by reasoning providers that support them. */
  thinkingBudgets?: ThinkingBudgets
  /** Prompt-cache retention preference. */
  cacheRetention?: CacheRetention
  /** Streaming transport preference. */
  transport?: Transport
  /** HTTP/provider SDK timeout in milliseconds. */
  timeoutMs?: number
  /** WebSocket connection timeout in milliseconds. */
  websocketConnectTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /**
   * Maximum base64-encoded image payload per request. When a request's
   * accumulated images exceed it, the oldest images are replaced by text
   * placeholders until the request fits, so a long session keeps completing
   * requests instead of being rejected by a request-size cap.
   */
  maxRequestImageBytes?: number
  /** Total-pixel budget for each deterministic inline request version. */
  requestImagePixelBudget?: number
  /**
   * Raw encoded-byte target for each deterministic inline request version;
   * the smallest quality-ladder output is used when no quality fits.
   */
  requestImageMaxBytes?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

/** One configured model entry: an id plus the catalog fields it overrides. */
export interface PiAiModelProfile {
  /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
  id: string
  /** Display name for selectors; defaults to the catalog name, then the id. */
  name?: string
  /** Maximum combined request and response context in tokens. */
  contextWindow?: number
  /**
   * Maximum output tokens. Configuring one also makes it this model's
   * per-request default; a value inherited from the installed catalog, or the
   * route's fallback, is the model's capability and never becomes a request
   * default on its own.
   */
  maxTokens?: number
  /**
   * Request modalities this model accepts. Absent — or empty, which describes
   * a model that accepts nothing and so states no answer either — keeps the
   * installed catalog entry's modalities, then the route's `defaultInput`.
   * Declaring images is what makes a hand-declared vision model usable, and
   * declaring text alone corrects a catalog model whose gateway does not serve
   * what the catalog records. This is a claim about the endpoint, not a check
   * of it: nothing interrogates a gateway for what it accepts, so a model
   * claiming images its endpoint refuses is refused by the provider instead,
   * mid-turn.
   */
  input?: PiAiModality[]
  /**
   * Selectable reasoning efforts. Absent inherits the installed catalog
   * entry's capability (a hand-declared model has none and does not reason);
   * `false` declares a non-reasoning model, which is how a profile strips
   * reasoning from a catalog model its gateway cannot serve; a non-empty dict
   * declares the offered levels and their wire spellings.
   */
  reasoningEfforts?: false | PiAiReasoningEfforts
  /** pi-ai wire-compatibility switches for this model, winning over the route's per field; one its protocol does not declare is refused. */
  compat?: PiAiCompatProfile
}

/**
 * Customization of one installed catalog model, keyed by its id in the
 * route's `modelOverrides` dict — the same fields a `models` entry may set,
 * with the id living in the key. Unlike a `models` list, overrides leave the
 * rest of the catalog serving untouched, which is what makes "correct one
 * model, keep the other thirty-seven" a three-line edit.
 */
export type PiAiModelOverride = Omit<PiAiModelProfile, 'id'>

/**
 * Live model-list refresh for one route: where to fetch the provider's
 * published model document, and how long to wait for it.
 */
export interface PiAiCatalogRefresh {
  /** Absolute URL of the provider's model document. */
  url?: string
  /** Published layout of that document; resolution defaults it to `openrouter`. */
  format?: LiveCatalogFormat
  /**
   * Capability tags an entry must carry to be added. Absent or empty accepts
   * every entry; `[chat]` is what keeps a provider's image, audio, and
   * embedding models out of a text route.
   */
  requireTags?: string[]
  /** Abort the request after this many milliseconds; resolution defaults it. */
  timeoutMs?: number
}

/**
 * pi-ai wire-compatibility switches, set on the route (its models' default) or
 * per model (winning over the route, field by field).
 *
 * pi-ai decides each of these from the provider id and baseURL when no layer
 * sets it, and a private gateway's URL says nothing: for an endpoint it does
 * not recognize the detection answers as though it were OpenAI itself, which
 * is wrong for most OpenAI-compatible gateways. So every field here is one a
 * deployment must be able to state because nothing can infer it, while the
 * fields pi-ai's catalog sets for a named vendor stay withheld.
 *
 * A field belongs to the protocols whose upstream compat type declares it: a
 * model-level switch its protocol does not take fails resolution, and a
 * route-level one skips past models it cannot fit. "The three Responses
 * protocols" below means `openai-responses`, `azure-openai-responses`, and
 * `openai-codex-responses`, which pi-ai gives one shared compat type, so a
 * switch settable on one is settable on all three.
 */
export interface PiAiCompatProfile {
  /** Whether the endpoint accepts `store`; `openai-completions`. */
  supportsStore?: boolean
  /**
   * Whether the endpoint accepts the `developer` role for the system prompt,
   * which pi-ai sends only to a reasoning model; `false` keeps `system`.
   * `openai-completions` and the three Responses protocols.
   */
  supportsDeveloperRole?: boolean
  /** Whether the endpoint accepts `reasoning_effort`; `openai-completions`. */
  supportsReasoningEffort?: boolean
  /** Whether the endpoint accepts `stream_options: {include_usage: true}`; `openai-completions`. */
  supportsUsageInStreaming?: boolean
  /**
   * Whether streams include `finish_reason`; `false` lets pi-ai infer the
   * terminal reason when the stream ends; `openai-completions`.
   */
  supportsFinishReason?: boolean
  /** Which output-cap field the endpoint reads; `openai-completions`. */
  maxTokensField?: NonNullable<OpenAICompletionsCompat['maxTokensField']>
  /** Whether tool results must carry `name`; `openai-completions`. */
  requiresToolResultName?: boolean
  /** Whether a user message after tool results needs an assistant message between; `openai-completions`. */
  requiresAssistantAfterToolResult?: boolean
  /** Whether thinking blocks must travel as text in `<thinking>` delimiters; `openai-completions`. */
  requiresThinkingAsText?: boolean
  /** Whether replayed assistant messages need an empty `reasoning_content` while reasoning is on; `openai-completions`. */
  requiresReasoningContentOnAssistantMessages?: boolean
  /** Reasoning parameter format the endpoint expects; `openai-completions`. */
  thinkingFormat?: PiAiThinkingFormat
  /**
   * Kwargs sent as `chat_template_kwargs`, which pi-ai reads only under the
   * two `chat-template` thinking formats; `openai-completions`. Nothing checks
   * that pairing: the format in force may come from the installed catalog
   * entry or from pi-ai's own baseURL detection, neither of which resolution
   * can read, so kwargs set beside another format are sent nowhere.
   */
  chatTemplateKwargs?: NonNullable<OpenAICompletionsCompat['chatTemplateKwargs']>
  /** Arguments sent as `chat_template_args` under the `baseten` thinking format; `openai-completions`. */
  chatTemplateArgs?: NonNullable<OpenAICompletionsCompat['chatTemplateArgs']>
  /** Whether the endpoint accepts `thinking_token_budget` to cap vLLM reasoning; `openai-completions`. */
  supportsThinkingTokenBudget?: boolean
  /**
   * Whether the endpoint accepts `strict` in tool definitions;
   * `openai-completions`, the three Responses protocols, `bedrock-converse-stream`.
   */
  supportsStrictMode?: boolean
  /** Prompt-cache marker convention; `openai-completions`. */
  cacheControlFormat?: NonNullable<OpenAICompletionsCompat['cacheControlFormat']>
  /**
   * Whether the endpoint accepts long prompt-cache retention;
   * `openai-completions`, the three Responses protocols, `anthropic-messages`.
   */
  supportsLongCacheRetention?: boolean
  /** Whether the endpoint accepts per-tool `eager_input_streaming`; `anthropic-messages`. */
  supportsEagerToolInputStreaming?: boolean
  /** Whether the endpoint accepts `cache_control` on tool definitions; `anthropic-messages`. */
  supportsCacheControlOnTools?: boolean
  /** Whether the endpoint accepts the `temperature` request field; `anthropic-messages`. */
  supportsTemperature?: boolean
  /** Whether to force adaptive thinking regardless of model id; `anthropic-messages`. */
  forceAdaptiveThinking?: boolean
  /** Whether to replay an empty thinking signature instead of converting thinking to text; `anthropic-messages`. */
  allowEmptySignature?: boolean
  /** Whether the endpoint accepts Anthropic strict tool schemas; `anthropic-messages`. */
  supportsStrictTools?: boolean
}

/** One request modality a pi-ai model may accept. */
export type PiAiModality = Model<Api>['input'][number]

/**
 * Selectable reasoning efforts for one model: each key is a level the model
 * offers (and selectors show), and its value is the wire spelling dispatch
 * sends for it. `off` alone may leave its value empty — "supported, send
 * nothing" — because for most providers not thinking is the parameter's
 * absence; every other declared level must name a wire value. A level absent
 * from the dict is not offered.
 */
export type PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>

/**
 * Which published layout a provider's document uses.
 *
 * `openrouter` states capacities, modalities, and accepted parameters at the
 * top of each entry. `openai-models` is the plain OpenAI `GET /models` listing
 * — an id and little else — which providers extend under `metadata`; DeepInfra
 * puts capacities, per-token prices, and capability tags there.
 */
export type LiveCatalogFormat = 'openrouter' | 'openai-models'

/** One reasoning-dispatch wire format a profile may name. */
export type PiAiThinkingFormat = NonNullable<OpenAICompletionsCompat['thinkingFormat']>
```


依赖：`Api`（`@earendil-works/pi-ai`）· `CacheRetention`（`@earendil-works/pi-ai`）· `Model`（`@earendil-works/pi-ai`）· `ModelThinkingLevel`（`@earendil-works/pi-ai`）· `OpenAICompletionsCompat`（`@earendil-works/pi-ai`）· [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts) · `ThinkingBudgets`（`@earendil-works/pi-ai`）· `Transport`（`@earendil-works/pi-ai`)

来源：[`packages/llm/llm-pi-ai/src/config.ts:258`](../packages/llm/llm-pi-ai/src/config.ts)

<a id="aevenllm-replay"></a>
## `@aeven/llm-replay`

需要：`llm`

```ts config-catalog
/** Plugin config: the {@link ReplayConfig} inputs, each defaulting to its `AVN_SNAPSHOT_*` env var in `apply`. */
export interface Config {
  /** Override the fixture path; defaults to `$AVN_SNAPSHOT_FILE`. */
  file?: string
  /** Override the sidecar path; defaults to `$AVN_SNAPSHOT_OVERRIDE`. */
  overrideFile?: string
  /**
   * Override the child-log paths; defaults to `$AVN_SNAPSHOT_CHILD_FILES` (a
   * path-separator-delimited list). Each is a recorded subagent session log for
   * a nested-agent scenario; absent/empty for a single-session scenario.
   */
  childFiles?: string[]
  /** Optional replay-only provider catalog; absent or empty selects catch-all waterfall replay. */
  providers?: ReplayProviderConfig[]
  /** Optional per-chunk pacing delay in ms (see {@link ReplayConfig.paceMs}); absent keeps burst yield. */
  paceMs?: number
}

/** One provider route exposed by the replay adapter. */
export interface ReplayProviderConfig {
  /** Provider route used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Advisory models exposed to replay scenarios that exercise discovery. */
  models?: ReplayModelConfig[]
  /** Optional provider-owned retry policy used by assembled recovery snapshots. */
  retryPolicy?: RetryPolicyConfig
}

/** One model exposed by a replay-only provider catalog. */
export interface ReplayModelConfig {
  /** Model id used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector description. */
  description?: string
  /** Optional positive integer context capacity published by the replay adapter. */
  contextWindow?: number
  /** Optional declared input modalities, so a scenario can exercise capability gates (e.g. image-capable `read_image`). */
  inputModalities?: readonly ModelModality[]
  /**
   * Optional per-request output cap the replay route materializes when callers
   * omit one, so replay reconstructs the request header a live catalog produced.
   */
  defaultMaxTokens?: number
  /**
   * Optional flat visual-token price the replay route declares for every
   * retained request image, so keyless scenarios exercise route-priced
   * request pressure; each occurrence is priced at this value plus its
   * request-preview handle text. Requires {@link inputModalities} to include
   * `image` — a text-only route never sends visual tokens. Absent declares
   * no image pricing.
   */
  imageRequestTokens?: number
  /** Optional reasoning-effort ids the replay route accepts, in display order. */
  reasoningEfforts?: string[]
  /**
   * Optional effort materialized when callers omit one; must appear in
   * {@link reasoningEfforts} or call resolution rejects the route.
   */
  defaultReasoningEffort?: string
}
```


依赖：[`ModelModality`](../packages/llm/llm/src/index.ts) · [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/test-support/llm-replay/src/index.ts:924`](../packages/test-support/llm-replay/src/index.ts)

<a id="aevenllm-retry"></a>
## `@aeven/llm-retry`

需要：`agents` · `sessionProjections`

```ts config-catalog
/** This policy executor has no config; providers own `retryPolicy`. */
export type Config = Readonly<Record<string, never>>
```


来源：[`packages/llm/llm-retry/src/index.ts:25`](../packages/llm/llm-retry/src/index.ts)

<a id="aevenlsp-stdio"></a>
## `@aeven/lsp-stdio`

需要：`fs` · `lsp` · `subprocess`

```ts config-catalog
/** Plugin configuration: provider id → local language-server configuration. */
export interface Config {
  /** Non-empty table of stable provider ids to independent local server configurations. */
  servers: Record<string, LspLocalServerConfig>
}

/** One configured local language server and its host bounds. */
export interface LspLocalServerConfig {
  /** Executable to spawn (absolute, or resolved on PATH at load). */
  command: string
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  extensionToLanguage: Record<string, string>
  /** Arguments passed to the executable (no shell). Default `[]`. */
  args?: string[]
  /** Extra env vars merged on top of the scrubbed ambient env. Default `{}`. */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. Default `null`. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. Default `null`. */
  configuration?: unknown
  /** Largest single framed message accepted from the server (bytes). Default 16000000. */
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). Default 1000000. */
  maxStderrBytes?: number
  /** Largest source file this host will open (bytes). Default 4000000. */
  maxDocumentBytes?: number
  /** Graceful `shutdown`/`exit` budget before escalation (ms). Default 5000. */
  shutdownTimeoutMs?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). Default 2000. */
  killGraceMs?: number
}
```


来源：[`packages/lsp/lsp-stdio/src/index.ts:82`](../packages/lsp/lsp-stdio/src/index.ts)

<a id="aevenmcp-client"></a>
## `@aeven/mcp-client`

需要：`tools`

```ts config-catalog
/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect automatically after a lost connection (default true). */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt (default 500). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets (default 30000). */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good (default 10). */
  maxAttempts?: number
}
```


来源：[`packages/mcp/mcp-client/src/index.ts:98`](../packages/mcp/mcp-client/src/index.ts)

<a id="aevenmedia"></a>
## `@aeven/media`

```ts config-catalog
/**
 * Config for the media seam. Each field pins which provider wins for one kind;
 * both are optional, and a single registered usable provider auto-selects. A
 * request may also name its provider, which outranks both.
 */
export interface MediaRuntimeConfig {
  /** Explicit image provider id. Omitted = auto-select when exactly one usable. */
  readonly imageProvider?: string
  /** Explicit video provider id. Omitted = auto-select when exactly one usable. */
  readonly videoProvider?: string
}
```


来源：[`packages/media/media/src/index.ts:57`](../packages/media/media/src/index.ts)

<a id="aevenmedia-deepinfra"></a>
## `@aeven/media-deepinfra`

需要：`media`

```ts config-catalog
/** Config for the DeepInfra media provider. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `deepinfra`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Ceiling on one retrieved clip, in bytes. */
  maxVideoBytes?: number
}
```


来源：[`packages/media/media-deepinfra/src/index.ts:51`](../packages/media/media-deepinfra/src/index.ts)

<a id="aevenmedia-openrouter"></a>
## `@aeven/media-openrouter`

需要：`media`

```ts config-catalog
/** Config for the OpenRouter media provider. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `openrouter`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Ceiling on one retrieved clip, in bytes. */
  maxVideoBytes?: number
}
```


来源：[`packages/media/media-openrouter/src/index.ts:47`](../packages/media/media-openrouter/src/index.ts)

<a id="aevenmedia-pi-ai"></a>
## `@aeven/media-pi-ai`

需要：`media`

```ts config-catalog
/**
 * Config for the pi-ai images provider. `id` is the registry key a request or
 * the seam's config names; it defaults to the upstream provider's own id so a
 * single-provider deployment needs no configuration at all.
 */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `openrouter`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
}
```


来源：[`packages/media/media-pi-ai/src/index.ts:33`](../packages/media/media-pi-ai/src/index.ts)

<a id="aevenmessage-feedback"></a>
## `@aeven/message-feedback`

需要：`storageDomain` · `sessionPersistence` · `sessions`

```ts config-catalog
/** Required deployment policy for optional notes. */
export interface Config {
  /** Maximum UTF-8 byte length accepted for one note. */
  readonly maxNoteBytes: number
}
```


来源：[`packages/feedback/message-feedback/src/index.ts:50`](../packages/feedback/message-feedback/src/index.ts)

<a id="aevenpermission-presets"></a>
## `@aeven/permission-presets`

需要：`shell` · `approval` · `sessions` · `sessionProjections`

```ts config-catalog
/** The {@link PermissionPresetService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```


依赖：[`ApprovalPolicy`](subsystems/approval.zh.md) · [`SandboxMode`](subsystems/sandbox.zh.md)

来源：[`packages/interaction/permission-presets/src/index.ts:143`](../packages/interaction/permission-presets/src/index.ts)

<a id="aevenpersona"></a>
## `@aeven/persona`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}
```


来源：[`packages/preset/persona/src/index.ts:30`](../packages/preset/persona/src/index.ts)

<a id="aevenplan-mode"></a>
## `@aeven/plan-mode`

需要：`tools` · `systemPrompt` · `sessionProjections`

```ts config-catalog
/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```


来源：[`packages/plan/plan-mode/src/index.ts:63`](../packages/plan/plan-mode/src/index.ts)

<a id="aevenplugin-package-inventory-deepseek"></a>
## `@aeven/plugin-package-inventory-deepseek`

需要：`agents` · `deepseekLlmApiExtensions` · `loader`

```ts config-catalog
/** Plugin-package request contribution configuration. */
export interface Config {
  /** Contribute `avn_plugin_packages` to official DeepSeek requests. Defaults to `true`. */
  enabled?: boolean
}
```


来源：[`packages/llm/plugin-package-inventory-deepseek/src/index.ts:31`](../packages/llm/plugin-package-inventory-deepseek/src/index.ts)

<a id="aevenpwsh-local"></a>
## `@aeven/pwsh-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Explicit pwsh executable. When omitted, well-known Windows install
   * locations and PATH entries are probed in order (PowerShell 7 install,
   * PATH entries such as the Microsoft Store install, then Windows
   * PowerShell 5.1), falling back to a bare `pwsh` resolved through PATH.
   */
  pwshPath?: string
}
```


来源：[`packages/shell/pwsh-local/src/index.ts:58`](../packages/shell/pwsh-local/src/index.ts)

<a id="aevenpwsh-sandbox"></a>
## `@aeven/pwsh-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@aeven/sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The
 * runner choice is likewise the `ctx.sandbox` provider's config, not this
 * executor's.
 */
export type Config = LocalConfig
```


依赖：[`LocalConfig`](#aevenpwsh-local)

来源：[`packages/shell/pwsh-sandbox/src/index.ts:40`](../packages/shell/pwsh-sandbox/src/index.ts)

<a id="aevenrepeat-tool-reminder"></a>
## `@aeven/repeat-tool-reminder`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
}
```


来源：[`packages/guard/repeat-tool-reminder/src/index.ts:28`](../packages/guard/repeat-tool-reminder/src/index.ts)

<a id="aevensandbox-local"></a>
## `@aeven/sandbox-local`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * Override the runner argv; bwrap-compatible profile arguments are appended. A
   * non-empty override asserts full enforcement and skips built-in selection and
   * probing. A runner that starts but refuses its profile must be identifiable by
   * {@link runnerFailureSignatures}. Consumers classify a spawn rejection only after
   * confirming the workdir is usable. `ENOENT` or `EACCES` identifies the runner when
   * `error.path` equals argv[0] and `error.syscall` is `spawn` or `spawn <runner>`, or
   * when `error.path` is absent and `error.syscall` is exactly `spawn <runner>`.
   */
  runnerCommand?: string[]
  /**
   * Case-insensitive stderr substrings emitted when a configured
   * {@link runnerCommand} refuses its profile before executing the wrapped
   * command. Required and non-empty with `runnerCommand`; rejected without
   * it. Each entry is a non-empty, single-line, case-insensitive substring
   * covering the executable runner's own failure dialect.
   */
  runnerFailureSignatures?: string[]
  /** Positive timeout for each functional probe; zero would mean unbounded to Node. */
  probeTimeoutMs?: number
}
```


来源：[`packages/sandbox/sandbox-local/src/index.ts:44`](../packages/sandbox/sandbox-local/src/index.ts)

<a id="aevensandbox-policy"></a>
## `@aeven/sandbox-policy`

需要：`sessionProjections`

```ts config-catalog
/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}
```


依赖：[`SandboxMode`](subsystems/sandbox.zh.md)

来源：[`packages/sandbox/sandbox-policy/src/index.ts:70`](../packages/sandbox/sandbox-policy/src/index.ts)

<a id="aevensdk-app"></a>
## `@aeven/sdk-app`

需要：`cmdlineArgs`

```ts config-catalog
/** SDK stdio startup configuration. */
export interface Config {
  /** Profile name rendered in help and diagnostics (default `sdk`). */
  profile?: string
}
```


来源：[`packages/bundle/sdk-app/src/index.ts:23`](../packages/bundle/sdk-app/src/index.ts)

<a id="aevensdk-jsonrpc-server"></a>
## `@aeven/sdk-jsonrpc-server`

需要：`agents`

```ts config-catalog
/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Report max-token turn/subagent termination as a successful SDK result. */
  maxTokensAsSuccess?: boolean
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}
```


依赖：`Readable`（`node:stream`）· `Writable`（`node:stream`）

来源：[`packages/sdk/server/src/index.ts:25`](../packages/sdk/server/src/index.ts)

<a id="aevensession-log-deepseek"></a>
## `@aeven/session-log-deepseek`

需要：`deepseekLlmApiExtensions` · `sessions`

```ts config-catalog
/** Session-log request contribution configuration. */
export interface Config {
  /** Contribute `avn_session_log` to official DeepSeek requests. Defaults to `false`. */
  enabled?: boolean
}
```


来源：[`packages/session/session-log-deepseek/src/index.ts:36`](../packages/session/session-log-deepseek/src/index.ts)

<a id="aevensession-log-export"></a>
## `@aeven/session-log-export`

需要：`commands` · `connection`

```ts config-catalog
/** Session-log archive policy. */
export interface Config {
  /** DEFLATE level for each ZIP entry. @default 6 */
  readonly compressionLevel?: SessionLogCompressionLevel
}

/** Valid fflate DEFLATE levels accepted by session-log export. */
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
```


来源：[`packages/session-query/session-log-export/src/index.ts:42`](../packages/session-query/session-log-export/src/index.ts)

<a id="aevensession-persistence-jsonl"></a>
## `@aeven/session-persistence-jsonl`

需要：`sessions` · `sessionProjections`

```ts config-catalog
/** Plugin config: where the JSONL backend keeps its session logs, and the packed-row write switch. */
export interface Config {
  /**
   * Root directory for all session files. Required (no default): a default of
   * `process.cwd()` would scatter session files as the process's cwd changes
   * (bash calls, subprocesses). Sessions group under human-readable project
   * directories, then per-session directories. An existing root must be a
   * readable directory; an absent root is created on first materialization.
   */
  root: string
  /**
   * Write runs of consecutive `assistant/chunk` delta events as packed
   * `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows (lossless,
   * ~60% smaller logs measured on a real session). Defaults to true; false
   * keeps one `SessionEvent` per line for diagnostics. Reading packed rows is
   * unconditional: a log's layout never depends on this switch.
   */
  packChunks?: boolean
  /** Physical encoding; defaults to checksummed Zstandard frames. */
  compression?: JsonlCompression
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'
```


来源：[`packages/session/session-persistence-jsonl/src/index.ts:111`](../packages/session/session-persistence-jsonl/src/index.ts)

<a id="aevensession-projection-cache"></a>
## `@aeven/session-projection-cache`

需要：`storageDomain` · `sessionProjections` · `sessions`

```ts config-catalog
/**
 * Plugin config. Both throttle triggers are deployment choices with no
 * universally correct value, so the composition states them explicitly
 * (cordis.yml); the three mandatory write points (session creation,
 * `turn/end`, and session disposal) are policy, not tunables, and always
 * fire.
 */
export interface Config {
  /** Committed events per session that force a durable checkpoint write between mandatory points. */
  writeEveryEvents: number
  /** Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points. */
  writeIntervalMs: number
}
```


来源：[`packages/session/session-projection-cache/src/index.ts:55`](../packages/session/session-projection-cache/src/index.ts)

<a id="aevensession-query-sqlite"></a>
## `@aeven/session-query-sqlite`

需要：`sessions`

```ts config-catalog
/** Combined session-query configuration backed by SQLite full-text search. */
export interface Config extends SessionQueryConfig {
  /**
   * Dedicated derived-index path; `:memory:` is supported for ephemeral
   * indexes. Missing directories and database files are created owner-only on
   * POSIX filesystems; existing modes are preserved.
   */
  path: string
  /**
   * Open the SQLite module and handle at service activation or the first
   * search, or `never` to disable full-text search: the inherited exact
   * reads, filters, and traces stay available, while `searchSessions` and
   * `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED` and SQLite is
   * never imported or opened. Defaults to `startup`.
   */
  openAt?: OpenAt
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Maximum concurrent persisted-log inspections in one inherited batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

/** SQLite module/handle opening phase; `never` disables full-text search entirely. */
export type OpenAt = 'startup' | 'first-search' | 'never'

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```


依赖：[`SessionQueryConfig`](../packages/session-query/session-query/src/index.ts)

来源：[`packages/session-query/session-query-sqlite/src/index.ts:111`](../packages/session-query/session-query-sqlite/src/index.ts)

<a id="aevensession-reference"></a>
## `@aeven/session-reference`

需要：`sessionQuery`

```ts config-catalog
/** Session-reference service configuration. */
export interface Config {
  /** Maximum distinct source sessions referenced by one message, from one to three. */
  maxReferences?: number
  /** Default host candidate-list limit. */
  candidateLimit?: number
  /** Maximum rendered UTF-8 bytes for one source snapshot. */
  maxReferenceBytes?: number
}
```


来源：[`packages/context/session-reference/src/config.ts:11`](../packages/context/session-reference/src/config.ts)

<a id="aevensession-telemetry-otel"></a>
## `@aeven/session-telemetry-otel`

需要：`sessions`

```ts config-catalog
/**
 * Plugin configuration: one sharing policy, two verbatim SDK option objects,
 * and one AVN-owned shutdown bound. Uploading modes validate their endpoint
 * and shutdown deadline at plugin load; `DISABLED` reads neither.
 */
export interface Config {
  /** Sharing policy; defaults to local-only `DISABLED` behavior. */
  mode?: SessionTelemetryMode
  /**
   * Passed verbatim to the SDK's OTLP/HTTP log exporter — the complete
   * `OTLPExporterNodeConfigBase` shape (`headers`, `timeoutMillis`,
   * `compression`, `keepAlive`, …), owned and documented by the SDK. `url`
   * is the one field this package requires and validates itself.
   */
  exporter?: OTLPExporterNodeConfigBase & {
    /** Full logs endpoint (e.g. `https://collector.example.com/v1/logs`). Required outside `DISABLED`; validated at load. */
    url?: string
  }
  /**
   * Passed verbatim to `BatchLogRecordProcessor` (minus the exporter slot,
   * which this plugin fills); the SDK owns and documents these knobs.
   */
  processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum time spent awaiting the SDK provider's complete shutdown path. */
  shutdownTimeoutMillis?: number
}

/** Session-sharing policy selected by {@link Config.mode}. */
export enum SessionTelemetryMode {
  FULL = 'FULL',
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}
```


依赖：`BatchLogRecordProcessorOptions`（`@opentelemetry/sdk-logs`）· `OTLPExporterNodeConfigBase`（`@opentelemetry/otlp-exporter-base`）

来源：[`packages/session/session-telemetry-otel/src/index.ts:91`](../packages/session/session-telemetry-otel/src/index.ts)

<a id="aevensession-title"></a>
## `@aeven/session-title`

需要：`sessions`

```ts config-catalog
/** Required deterministic fallback and accepted-title limits. */
export interface Config {
  /** Maximum whitespace-delimited words in the built-in fallback. */
  readonly fallbackMaxWords: number
  /** Maximum UTF-8 bytes in the built-in fallback. */
  readonly fallbackMaxBytes: number
  /** Maximum UTF-8 bytes in any accepted title. */
  readonly maxTitleBytes: number
}
```


来源：[`packages/session/session-title/src/index.ts:56`](../packages/session/session-title/src/index.ts)

<a id="aevensession-title-all-prompts-llm"></a>
## `@aeven/session-title-all-prompts-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```


依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-all-prompts-llm/src/index.ts:15`](../packages/session/session-title-all-prompts-llm/src/index.ts)

<a id="aevensession-title-first-prompt-llm"></a>
## `@aeven/session-title-first-prompt-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```


依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-first-prompt-llm/src/index.ts:15`](../packages/session/session-title-first-prompt-llm/src/index.ts)

<a id="aevensettings-file"></a>
## `@aeven/settings-file`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Settings document path; defaults to `settings.yaml` under the harness home. */
  path?: string
  /** Aeven home used when `path` is omitted; defaults to `$AVN_HOME` or `~/.aeven`. */
  avnHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```


来源：[`packages/settings/settings-file/src/index.ts:22`](../packages/settings/settings-file/src/index.ts)

<a id="aevenshell-env"></a>
## `@aeven/shell-env`

```ts config-catalog
/** Plugin config (all optional — the built-in facts resolve without defaults). */
export interface Config {
  /** Aeven home directory exposed as `AVN_HOME`; defaults to `$AVN_HOME` or `~/.aeven`. */
  avnHome?: string
}
```


来源：[`packages/shell/shell-env/src/index.ts:29`](../packages/shell/shell-env/src/index.ts)

<a id="aevenskill"></a>
## `@aeven/skill`

```ts config-catalog
/** Skill registry configuration. */
export interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```


来源：[`packages/skill/skill/src/index.ts:280`](../packages/skill/skill/src/index.ts)

<a id="aevenskill-filesystem"></a>
## `@aeven/skill-filesystem`

需要：`skills`

```ts config-catalog
/** Local filesystem skill provider configuration. */
export interface Config {
  /** Unique provider name. Defaults to `filesystem`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** Aeven config root. Defaults to `$AVN_HOME` or `~/.aeven`. */
  avnHome?: string
  /** Shared agent config root. Defaults to `$AVN_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed skill entry must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose skill directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
  /** Bundled skill root; defaults to `$AVN_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  bundledSkillDir?: string
}
```


来源：[`packages/skill/skill-filesystem/src/index.ts:49`](../packages/skill/skill-filesystem/src/index.ts)

<a id="aevenspill-local"></a>
## `@aeven/spill-local`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /**
   * Root directory for spill files. Omitted uses a lazily-created private
   * (0700) per-process directory under the OS temp dir — the safe default for
   * a local deployment. Set it to keep spill files under a known location.
   */
  root?: string
  /**
   * Age in days after which a spill file is eligible for the one-shot startup
   * cleanup sweep. Defaults to `30`; `0` disables cleanup entirely. Files whose
   * `mtime` is strictly older than the cutoff are deleted and emptied
   * directories are pruned; fresh files, symlinks, and unrelated entries are
   * left untouched. On POSIX, cleanup skips roots and session directories that
   * another local user could modify or replace. Retention is deliberate — a
   * resumed or forked session may still reference an older locator until it
   * ages out.
   */
  cleanupPeriodDays?: number
}
```


来源：[`packages/spill/spill-local/src/index.ts:31`](../packages/spill/spill-local/src/index.ts)

<a id="aevenspill-policy"></a>
## `@aeven/spill-policy`

需要：`tools` · `sessionProjections`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The model-facing context cap for a plain-text tool result, in UTF-8 bytes.
   * Omitted disables the policy entirely (no-op). When set, a result larger than
   * this is spilled and replaced with a preview derived from this same budget.
   */
  maxInlineBytes?: number
}
```


来源：[`packages/spill/spill-policy/src/index.ts:61`](../packages/spill/spill-policy/src/index.ts)

<a id="aevenstorage-domain"></a>
## `@aeven/storage-domain`

需要：`storage`

```ts config-catalog
/**
 * Plugin config. Which backend serves which domain is decided here, not
 * globally on the hub: `backend` is the default route and `routes` overrides
 * it per domain name. A route naming an unregistered backend fails loud at
 * `open` with `backend-not-found`.
 */
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  routes?: Record<string, string>
}
```


来源：[`packages/storage/storage-domain/src/index.ts:52`](../packages/storage/storage-domain/src/index.ts)

<a id="aevenstorage-json"></a>
## `@aeven/storage-json`

需要：`storage`

```ts config-catalog
/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file (or `<unit>/` tree) per unit. */
  root: string
}
```


来源：[`packages/storage/storage-json/src/index.ts:28`](../packages/storage/storage-json/src/index.ts)

<a id="aevenstorage-sqlite"></a>
## `@aeven/storage-sqlite`

需要：`storage`

```ts config-catalog
/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
}

/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```


来源：[`packages/storage/storage-sqlite/src/index.ts:24`](../packages/storage/storage-sqlite/src/index.ts)

<a id="aevensubagent-acp"></a>
## `@aeven/subagent-acp`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * Must be non-empty; a relative path resolves against the harness launch
   * directory at load, and the result must be an existing directory. When
   * omitted, each child inherits its delegating parent session's cwd — and
   * starting one from a parent session that has no cwd fails.
   */
  cwd?: string
  /**
   * How to auto-answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt) or `allow` (approve via the first
   * `allow_once` or `allow_always` option). No prompt is surfaced to a human.
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Failure-observation and termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

/** Fixed response to child permission requests: reject by default, or select the first allow option. */
export type PermissionPolicy = 'allow' | 'reject'
```


来源：[`packages/subagent/subagent-acp/src/index.ts:27`](../packages/subagent/subagent-acp/src/index.ts)

<a id="aevensubagent-avn-sdk"></a>
## `@aeven/subagent-avn-sdk`

需要：`subagents`

```ts config-catalog
/** Config: how to spawn and drive the child SDK runtime process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `avn-sdk`). */
  providerName: string
  /** Explicit avn CLI module, resolved and checked at plugin load; omission uses the SDK dependency. */
  avnBin?: string
  /** Named child profile (default `sdk`). */
  profile: string
  /** Ordered per-launch profile patch files, resolved and checked at plugin load. */
  patches: string[]
  /** Absolute isolated Aeven home for every nested child process. */
  avnHome: string
  /**
   * Working directory override for the child process and its SDK session
   * workspace. Must be non-empty; a relative path resolves against the
   * harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child inherits its delegating parent
   * session's cwd — and starting one from a parent session that has no cwd
   * fails.
   */
  cwd?: string
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}
```


来源：[`packages/subagent/subagent-avn-sdk/src/index.ts:34`](../packages/subagent/subagent-avn-sdk/src/index.ts)

<a id="aevensubagent-claude-code"></a>
## `@aeven/subagent-claude-code`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `claude-code`). */
  providerName?: string
  /** Native Claude model fixed for this instance; omitted to inherit Claude settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /**
   * Native non-interactive mode fixed for this Provider instance. Defaults to
   * `dontAsk`; `acceptEdits` accepts edits, `auto` uses the native classifier,
   * `plan` returns a plan without approving execution, and
   * `bypassPermissions` explicitly skips permission checks.
   */
  permissionMode?: ClaudeCodePermissionMode
  /** Grace in milliseconds for Claude Code process-tree termination. */
  disposeGraceMs?: number
}

/** Profile-selectable non-interactive Claude Code permission mode. */
export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]
```


来源：[`packages/subagent/subagent-claude-code/src/index.ts:38`](../packages/subagent/subagent-claude-code/src/index.ts)

<a id="aevensubagent-codex"></a>
## `@aeven/subagent-codex`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned model, permission, environment, and process-release settings. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `codex`). */
  providerName?: string
  /** Native Codex model fixed for this instance; omitted to inherit Codex settings. */
  model?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Native non-interactive permission mode fixed for this Provider instance. */
  permissionMode?: CodexPermissionMode
  /** Grace in milliseconds for app-server process-tree termination. */
  disposeGraceMs?: number
}

/** Profile-selectable non-interactive Codex permission mode. */
export type CodexPermissionMode =
  | 'never'
  | 'approve-for-me'
  | 'dangerously-bypass-approvals-and-sandbox'
```


来源：[`packages/subagent/subagent-codex/src/index.ts:36`](../packages/subagent/subagent-codex/src/index.ts)

<a id="aevensubagent-fork-in-process"></a>
## `@aeven/subagent-fork-in-process`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `fork`). */
  providerName: string
}
```


来源：[`packages/subagent/subagent-fork-in-process/src/index.ts:31`](../packages/subagent/subagent-fork-in-process/src/index.ts)

<a id="aevensubagent-spawn-in-process"></a>
## `@aeven/subagent-spawn-in-process`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
}
```


来源：[`packages/subagent/subagent-spawn-in-process/src/index.ts:25`](../packages/subagent/subagent-spawn-in-process/src/index.ts)

<a id="aevensubprocess-e2b"></a>
## `@aeven/subprocess-e2b`

需要：`e2b`

```ts config-catalog
/** Configuration for the E2B subprocess adapter. */
export interface Config {
  /** Remote status/liveness poll cadence in milliseconds; each tick is one control-plane request. */
  pollMs?: number
}
```


来源：[`packages/e2b/subprocess-e2b/src/index.ts:25`](../packages/e2b/subprocess-e2b/src/index.ts)

<a id="aevensystem-prompt"></a>
## `@aeven/system-prompt`

```ts config-catalog
/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
export interface Config {
  /** Include the fixed Aeven identity before the deployment persona (default true). */
  includeHarnessIdentity?: boolean
  /** Include dynamic runtime-context snapshots in model history (default true). */
  includeRuntimeContext?: boolean
  /**
   * Deployment-wide order-0 persona template. A scoped section named
   * `deployment:persona` shadows it; `{{variable}}` references are strict.
   */
  persona?: string
  /**
   * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
   * Invalid fields fail at load and unknown names fail at assembly; known names
   * hidden in one scope may be absent there. Omitted means lexicographic order.
   */
  toolOrder?: string[]
}
```


来源：[`packages/core/system-prompt/src/index.ts:238`](../packages/core/system-prompt/src/index.ts)

<a id="aeventerminal-bash"></a>
## `@aeven/terminal-bash`

需要：`terminals` · `sandboxPolicy` · `sessionProjections` · `subprocess`

```ts config-catalog
/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `shell`). */
  backendType?: string
  /** Interactive shell dialect (default: `bash`); selects the argv/env/startup defaults. */
  shellDialect?: ShellDialect
  /** Interactive shell executable (default per dialect: `/bin/bash`, or the resolved pwsh). */
  shellPath?: string
  /** Shell arguments (default per dialect: bash `--noprofile --norc -i`, pwsh `-NoLogo -NoProfile`). */
  shellArgs?: string[]
  /** Terminal rows. */
  rows?: number
  /** Terminal columns. */
  cols?: number
  /** Maximum retained logical lines. */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read or settled viewport. */
  maxReadBytes?: number
  /** Readiness polling interval. */
  pollIntervalMs?: number
  /** Delay before Linux exact syscall probes. */
  exactProbeAfterMs?: number
  /** Silence duration that yields `inferred_idle`. */
  idleSilenceMs?: number
  /**
   * Extra wait beyond `idleSilenceMs`, once a prompt marker was seen, for the shell to
   * regain the foreground before `inferred_idle` settles; at least one `pollIntervalMs`.
   */
  handoffGraceMs?: number
  /** Absolute bound for one send and the complete pwsh startup sequence. */
  timeoutMs?: number
  /** Grace before teardown escalates to `SIGKILL`. */
  disposeGraceMs?: number
}

/** One supported interactive shell dialect. */
export type ShellDialect = 'bash' | 'pwsh'
```


来源：[`packages/terminal/terminal-bash/src/config.ts:10`](../packages/terminal/terminal-bash/src/config.ts)

<a id="aeventime-context"></a>
## `@aeven/time-context`

需要：`agents` · `sessionProjections`

```ts config-catalog
/** Request-preparation clock formatting and append scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Fallback display zone when the open turn has no unique browser zone. Omit to use the process zone. */
  timeZone?: string
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject at every eligible step. */
  refreshIntervalMs?: number
}
```


来源：[`packages/context/time-context/src/index.ts:49`](../packages/context/time-context/src/index.ts)

<a id="aeventmux-context"></a>
## `@aeven/tmux-context`

需要：`agents` · `sessionProjections`

```ts config-catalog
/** Per-turn tmux-location scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject on every eligible change. */
  refreshIntervalMs?: number
}
```


来源：[`packages/context/tmux-context/src/index.ts:36`](../packages/context/tmux-context/src/index.ts)

<a id="aeventoken-meter"></a>
## `@aeven/token-meter`

需要：`sessionProjections`

```ts config-catalog
/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>
```


来源：[`packages/llm/token-meter/src/types.ts:13`](../packages/llm/token-meter/src/types.ts)

<a id="aeventool-bash"></a>
## `@aeven/tool-bash`

需要：`tools` · `shell` · `systemPrompt` · `shellEnv`

```ts config-catalog
/** Configuration for the bash tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```


来源：[`packages/shell/tool-bash/src/index.ts:33`](../packages/shell/tool-bash/src/index.ts)

<a id="aeventool-bash-persistent"></a>
## `@aeven/tool-bash-persistent`

需要：`tools` · `terminals`

```ts config-catalog
/** Configuration for the persistent Bash tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}
```


来源：[`packages/shell/tool-bash-persistent/src/index.ts:432`](../packages/shell/tool-bash-persistent/src/index.ts)

<a id="aeventool-fs"></a>
## `@aeven/tool-fs`

需要：`tools` · `fs` · `systemPrompt`

```ts config-catalog
/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}
```


来源：[`packages/fs/tool-fs/src/index.ts:25`](../packages/fs/tool-fs/src/index.ts)

<a id="aeventool-fs-search"></a>
## `@aeven/tool-fs-search`

需要：`tools` · `systemPrompt` · `subprocess`

```ts config-catalog
/** Plugin config; over-cap glob sampling is an explicit deployment choice and the remaining fields have defaults. */
export interface Config {
  /** Whether an over-cap `glob` page is sampled across top-level entries instead of taking the modification-time head. */
  sampleOverCapGlobResults: boolean
  /** Max paths one `glob` call retains inline; later paths go to the formatted spill file. */
  globMaxResults?: number
  /** Max flat matches one `grep` call retains inline; later matches go to the formatted spill file. */
  grepMaxMatches?: number
  /** Max bytes retained for one matched-line preview (the cut preserves UTF-8 boundaries). */
  grepMaxLineBytes?: number
  /** Max bytes of one search's serialized `presentationMeta`; trailing groups/paths drop past it so the persisted card stays bounded. */
  searchMetaMaxBytes?: number
  /** Max complete raw `rg` stdout bytes a search will parse; larger raw output fails with `SEARCH_RAW_OUTPUT_OVERFLOW`. */
  rawOutputMaxBytes?: number
  /** Terminate-escalation grace (ms), handed to the subprocess seam and bounded by `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /** Max bytes retained for one search's stderr tail; the excerpt is embedded in `SEARCH_*` error messages, never shown on success. */
  stderrMaxBytes?: number
  /**
   * Cooperative tool-call timeout budget (ms) on both tools, enforced by
   * `@aeven/tool-call-timeout-policy` through `exec.signal`.
   */
  timeoutMs?: number
}
```


来源：[`packages/fs/tool-fs-search/src/index.ts:73`](../packages/fs/tool-fs-search/src/index.ts)

<a id="aeventool-goal"></a>
## `@aeven/tool-goal`

需要：`agents` · `goals` · `tools` · `systemPrompt` · `sessionProjections`

```ts config-catalog
/** Model policy and hard lower bounds for goal-state updates. */
export interface Config {
  /** Minimum admitted goal rounds before the model may self-report `blocked`. */
  blockedAfterConsecutiveRounds?: number
}
```


来源：[`packages/goal/tool-goal/src/index.ts:25`](../packages/goal/tool-goal/src/index.ts)

<a id="aeventool-jobs"></a>
## `@aeven/tool-jobs`

需要：`tools` · `jobs` · `systemPrompt`

```ts config-catalog
/** Configures bounded `job_output` waits and completion-notice delivery. */
export interface Config {
  /** Wait duration applied when `job_output` sets `wait` without `timeout_ms` (default 30s). */
  waitTimeoutMs?: number
  /** Hard cap on any single wait; a larger model-supplied `timeout_ms` is clamped down to it (default 10min). */
  maxWaitTimeoutMs?: number
  /** Whether a completion opens a turn on an idle owner (default `wakeup`). */
  completionDelivery?: CompletionDelivery
  /**
   * Turns one owner may have opened by completion wakes before the next
   * notice degrades to injection, reset by any user-authored input (default 3).
   * Bounds the self-exciting chain where a woken turn starts the job whose
   * completion wakes it again.
   */
  maxConsecutiveWakes?: number
}

/**
 * How an unreported completion reaches an owner that is already idle: `wakeup`
 * opens a turn for it, `quiet` leaves it pending until something else wakes the
 * owner. A busy owner is injected either way.
 */
export type CompletionDelivery = 'quiet' | 'wakeup'
```


来源：[`packages/jobs/tool-jobs/src/index.ts:31`](../packages/jobs/tool-jobs/src/index.ts)

<a id="aeventool-lsp"></a>
## `@aeven/tool-lsp`

需要：`tools` · `lsp` · `systemPrompt`

```ts config-catalog
/** Plugin configuration: result caps and the timeout budget. */
export interface Config {
  /** Largest number of rendered locations before an omission marker (default 100). */
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  timeoutMs?: number
}
```


来源：[`packages/lsp/tool-lsp/src/index.ts:57`](../packages/lsp/tool-lsp/src/index.ts)

<a id="aeventool-media"></a>
## `@aeven/tool-media`

依赖：`tools` · `media` · `attachments`

```ts config-catalog
/** Config for the image tool. */
export interface Config {
  /**
   * Model id used when a call names none and no choice is made. Provider-specific
   * and verbatim, e.g. `black-forest-labs/flux.2-pro`. Omitted means every call
   * must name a model or answer the picker.
   */
  model?: string
  /** Media provider id used when a call names none. Omitted defers to the seam's own selection. */
  provider?: string
  /**
   * Models offered before each generation. An empty list disables the picker
   * and generates with the resolved model directly.
   */
  choices?: ImageModelChoice[]
  /**
   * Ask which model to use until one has been chosen. The picker is skipped
   * regardless where no `userQuestions` UI can answer, or `choices` is empty.
   */
  confirmModel?: boolean
  /**
   * Whether a person has chosen a model through the picker. Written by the
   * tool when they answer, never authored by hand: it is what distinguishes a
   * deployment default from a choice, so the picker asks exactly once.
   */
  modelChosen?: boolean
}

/** One selectable image model offered before a generation runs. */
export interface ImageModelChoice {
  /** Media provider id that serves this model. */
  provider: string
  /** The provider's model id, verbatim. */
  model: string
  /** Menu label; the `provider/model` pair when omitted. */
  label?: string
  /** Optional one-line note the menu shows beside the label. */
  description?: string
}
```


来源：[`packages/media/tool-media/src/index.ts:62`](../packages/media/tool-media/src/index.ts)

<a id="aeventool-pwsh"></a>
## `@aeven/tool-pwsh`

需要：`tools` · `shell` · `systemPrompt` · `shellEnv`

```ts config-catalog
/** Configuration for the pwsh tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```


来源：[`packages/shell/tool-pwsh/src/index.ts:51`](../packages/shell/tool-pwsh/src/index.ts)

<a id="aeventool-pwsh-persistent"></a>
## `@aeven/tool-pwsh-persistent`

需要：`tools` · `terminals`

```ts config-catalog
/** Configuration for the persistent pwsh tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}
```


来源：[`packages/shell/tool-pwsh-persistent/src/index.ts:472`](../packages/shell/tool-pwsh-persistent/src/index.ts)

<a id="aeventool-ralph"></a>
## `@aeven/tool-ralph`

需要：`tools` · `workflowEngine` · `subagents` · `systemPrompt`

```ts config-catalog
/** Deployment policy for the fixed Ralph workflow. */
export interface Config {
  /** Fresh structured-output provider used for every round (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for one call's round count (default 256). */
  maxRounds?: number
  /** Maximum serialized characters in one structured handoff (default 16384). */
  maxHandoffChars?: number
  /** Maximum characters in a successful parent-facing terminal text (default 16384). */
  maxResultChars?: number
}
```


来源：[`packages/workflow/tool-ralph/src/index.ts:21`](../packages/workflow/tool-ralph/src/index.ts)

<a id="aeventool-session-query"></a>
## `@aeven/tool-session-query`

需要：`tools` · `systemPrompt` · `sessionQuery` · `sessionProjections`

```ts config-catalog
/** Deployment-owned search count and timeout bounds. */
export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
}
```


来源：[`packages/session-query/tool-session-query/src/index.ts:28`](../packages/session-query/tool-session-query/src/index.ts)

<a id="aeventool-skill"></a>
## `@aeven/tool-skill`

需要：`agents` · `tools` · `skills`

```ts config-catalog
/** Model-facing skill catalog configuration. */
export interface Config {
  /** Maximum normalized description length rendered in the session catalog; minimum 3. */
  catalogDescriptionMaxLength?: number
}
```


来源：[`packages/skill/tool-skill/src/index.ts:61`](../packages/skill/tool-skill/src/index.ts)

<a id="aeventool-str-replace-editor"></a>
## `@aeven/tool-str-replace-editor`

需要：`tools` · `fs`

```ts config-catalog
/** Configuration for the string-replacement editor tool. */
export interface Config {
  /** Maximum returned view characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description. */
  description?: string
}
```


来源：[`packages/fs/tool-str-replace-editor/src/index.ts:505`](../packages/fs/tool-str-replace-editor/src/index.ts)

<a id="aeventool-subagent"></a>
## `@aeven/tool-subagent`

需要：`tools` · `subagents` · `systemPrompt` · `sessionProjections`

```ts config-catalog
/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config {
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * Sample the Host `subagent-model-selection` user setting for each new
   * top-level session and inherit that decision in its child sessions.
   */
  modelSelectionSettings?: boolean
  /**
   * Expose `run_in_background` (default true). Disabled instances omit the
   * parameter and reject forced background calls.
   */
  enableRunInBackground?: boolean
  /**
   * Background execution policy (default `one-shot`). `one-shot` defaults calls
   * to foreground; `continuable` defaults them to background, requires a provider
   * with the `prepareContinuable` capability, and returns the durable child id.
   * Follow-up adapters remain independently optional.
   */
  backgroundMode?: 'one-shot' | 'continuable'
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Per-child persona that shadows `deployment:persona`. Requires the
   * provider's `persona` capability; omission preserves the deployment persona.
   */
  persona?: string
  /**
   * Tool filter applied to every child. Filtered tools disappear from its
   * prompt and reject execution. Requires the provider's `toolFilter`
   * capability; unknown names fail startup.
   */
  toolFilter?: {
    /** Global tool names the child keeps; everything else is removed. */
    allow?: string[]
    /** Global tool names removed from the child. */
    deny?: string[]
  }
  /**
   * Maximum child depth: a non-negative safe integer (default `3`; `0` forbids
   * delegation entirely), or `'provider-managed'` to send no cap. A numeric cap
   * requires the provider's `depthLimit` capability (mount fails loud
   * otherwise). The provider checks the calling agent's current depth at every
   * start; the tool remains model-visible so runtime policy owns rejection.
   * `'provider-managed'` is for an out-of-process provider whose recursion
   * budget belongs to the child runtime or its own deployment.
   */
  maxDepth?: number | 'provider-managed'
}
```


依赖：[`AgentOptions`](subsystems/core.zh.md)

来源：[`packages/subagent/tool-subagent/src/index.ts:47`](../packages/subagent/tool-subagent/src/index.ts)

<a id="aeventool-terminal"></a>
## `@aeven/tool-terminal`

需要：`terminals` · `tools` · `systemPrompt`

```ts config-catalog
/** Model-facing terminal tool configuration. */
export interface Config {
  /** Expose `run_in_background` and accept background sends (default true). */
  enableRunInBackground?: boolean
  /** Maximum UTF-8 bytes in one complete terminal or task-output result. */
  maxResultBytes?: number
}
```


来源：[`packages/terminal/tool-terminal/src/index.ts:35`](../packages/terminal/tool-terminal/src/index.ts)

<a id="aeventool-todo"></a>
## `@aeven/tool-todo`

需要：`tools`

```ts config-catalog
/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}
```


来源：[`packages/todo/tool-todo/src/index.ts:43`](../packages/todo/tool-todo/src/index.ts)

<a id="aeventool-web"></a>
## `@aeven/tool-web`

需要：`tools` · `web` · `systemPrompt`

```ts config-catalog
/** Plugin config: which web tools to register, search bounds, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Upper bound on queries accepted by one `web_search` call. */
  searchMaxQueries?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}
```


来源：[`packages/web/tool-web/src/index.ts:37`](../packages/web/tool-web/src/index.ts)

<a id="aeventool-workflow"></a>
## `@aeven/tool-workflow`

需要：`tools` · `workflowEngine` · `systemPrompt`

```ts config-catalog
/** Config: the model-facing tool name plus result rendering caps. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling, in characters: a longer JSON value is truncated with a notice (default 50000). */
  maxResultChars?: number
}
```


来源：[`packages/workflow/tool-workflow/src/index.ts:32`](../packages/workflow/tool-workflow/src/index.ts)

<a id="aeventools"></a>
## `@aeven/tools`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
  /**
   * Model presentation. `native` (default) sends every visible schema; `ptc`
   * sends only `run_code` plus a generated SDK prompt and collapses the
   * executor to the same surface (a model-direct call may only name
   * `run_code`; `run_code` SDK sub-dispatches keep every visible tool); `both`
   * sends both forms. PTC mode requires a `ctx.codeRuntime` whose `language`
   * has a registered SDK renderer (TypeScript or Python) and fail prompt
   * assembly when it is absent or has no renderer. Under `ptc`, native names
   * in `toolOrder` are invalid.
   */
  mode?: ToolPresentationMode
  /**
   * Concurrency cap for a `run_code` program's overlapping sub-calls
   * (default 10, the loop scheduler's own default). Sub-calls follow the
   * native scheduling contract — only calls whose tools classify
   * concurrency-safe overlap; exclusive calls form barriers — so `1`
   * restores strictly serial dispatch. Must be a positive integer.
   */
  maxParallelSubCalls?: number
}

/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'ptc' | 'both'
```


来源：[`packages/core/tools/src/index.ts:647`](../packages/core/tools/src/index.ts)

<a id="aeventypert-loader"></a>
## `@aeven/typert-loader`

需要：`typert` · `loader`

```ts config-catalog
/** Additional package artifacts whose owning plugins are nested behind another Loader entry. */
export interface Config {
  /** Exact npm package names that must resolve and export `./typert`. */
  packages?: string[]
}
```


来源：[`packages/typert/loader/src/index.ts:47`](../packages/typert/loader/src/index.ts)

<a id="aevenuser-approval"></a>
## `@aeven/user-approval`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'
```


来源：[`packages/interaction/user-approval/src/index.ts:127`](../packages/interaction/user-approval/src/index.ts)

<a id="aevenweb"></a>
## `@aeven/web`

```ts config-catalog
/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}
```


来源：[`packages/web/web/src/index.ts:55`](../packages/web/web/src/index.ts)

<a id="aevenweb-app"></a>
## `@aeven/web-app`

需要：`webServer`

```ts config-catalog
/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Permit default-browser handoff after the Loader tree settles; an SSH launch suppresses it. */
  openBrowser: boolean
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `AVN_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
}
```


来源：[`packages/bundle/web-app/src/index.ts:44`](../packages/bundle/web-app/src/index.ts)

<a id="aevenweb-fetch-http"></a>
## `@aeven/web-fetch-http`

需要：`web`

```ts config-catalog
/** Plugin config: the provider's transport and size limits plus its `User-Agent` (all defaulted). */
export interface Config {
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}
```


来源：[`packages/web/web-fetch-http/src/index.ts:32`](../packages/web/web-fetch-http/src/index.ts)

<a id="aevenweb-search-deepseek"></a>
## `@aeven/web-search-deepseek`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}
```


来源：[`packages/web/web-search-deepseek/src/index.ts:46`](../packages/web/web-search-deepseek/src/index.ts)

<a id="aevenweb-search-exa"></a>
## `@aeven/web-search-exa`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}
```


来源：[`packages/web/web-search-exa/src/index.ts:35`](../packages/web/web-search-exa/src/index.ts)

<a id="aevenweb-search-perplexity"></a>
## `@aeven/web-search-perplexity`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Perplexity API key. Falls back to `$PERPLEXITY_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}
```


来源：[`packages/web/web-search-perplexity/src/index.ts:30`](../packages/web/web-search-perplexity/src/index.ts)

<a id="aevenwebhook-github"></a>
## `@aeven/webhook-github`

需要：`webServer` · `webhookRuntime` · `credentials`

```ts config-catalog
/** Required GitHub ingress configuration. */
export interface Config {
  /** Adapter instance name carried to rules. */
  readonly source: string
  /** Exact absolute route path. */
  readonly path: string
  /** Credential reference containing the shared webhook secret. */
  readonly secretEnv: string
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}
```


来源：[`packages/webhook/webhook-github/src/index.ts:17`](../packages/webhook/webhook-github/src/index.ts)

<a id="aevenworkflow-worker-thread"></a>
## `@aeven/workflow-worker-thread`

需要：`subagents`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** vm timeout for the script's initial synchronous slice, inside the worker (default 5000 ms). */
  syncTimeoutMs?: number
  /**
   * How long after a cancellation an unsettled script may keep running before
   * the run force-settles `cancelled` and its worker is TERMINATED (default
   * 5000 ms); also bounds `dispose()`.
   */
  disposeGraceMs?: number
}
```


来源：[`packages/workflow/workflow-worker-thread/src/index.ts:32`](../packages/workflow/workflow-worker-thread/src/index.ts)

<a id="aevenworkspace"></a>

## `@aeven/workspace`

需要：`storageDomain` · `sessionPersistence`

```ts config-catalog
/** Plugin configuration for the registry. */
export interface Config {
  /** Whether a registry without a built-in workspace seeds one at startup (default: true). */
  seedDefaultWorkspace?: boolean
  /** Display title given to a newly seeded workspace (default: `Chats`). */
  defaultWorkspaceTitle?: string
}
```

来源：[`packages/workspace/workspace/src/index.ts:43`](../packages/workspace/workspace/src/index.ts)

## 无配置的可加载插件

这些插件通过 `cordis.yml` 中不含 `config:` 块的条目加载；它们未声明任何配置接口。

- `@aeven/acp-app` — 需要 `cmdlineArgs`（[`packages/bundle/acp-app/src/index.ts`](../packages/bundle/acp-app/src/index.ts)）
- `@aeven/agent`（[`packages/core/agent/src/index.ts`](../packages/core/agent/src/index.ts)）
- `@aeven/api-remotes` — 需要 `typertGateway`（[`packages/api/remotes/src/index.ts`](../packages/api/remotes/src/index.ts)）
- `@aeven/api-workspace-controller` — 需要 `typert` · `workspaceRegistry`（[`packages/api/workspace-controller/src/index.ts`](../packages/api/workspace-controller/src/index.ts)）
- `@aeven/authorization` — 需要 `credentials`（[`packages/credentials/authorization/src/index.ts`](../packages/credentials/authorization/src/index.ts)）
- `@aeven/client-locale`（[`packages/client/locale/src/index.ts`](../packages/client/locale/src/index.ts)）
- `@aeven/client-ui-account-aeven` ([`packages/client/ui-account-aeven/src/index.ts`](../packages/client/ui-account-aeven/src/index.ts))
- `@aeven/client-ui-agent-preset`（[`packages/client/ui-agent-preset/src/index.ts`](../packages/client/ui-agent-preset/src/index.ts)）
- `@aeven/client-ui-approval`（[`packages/client/ui-approval/src/index.ts`](../packages/client/ui-approval/src/index.ts)）
- `@aeven/client-ui-attachment`（[`packages/client/ui-attachment/src/index.ts`](../packages/client/ui-attachment/src/index.ts)）
- `@aeven/client-ui-brand-official`（[`packages/client/ui-brand-official/src/index.ts`](../packages/client/ui-brand-official/src/index.ts)）
- `@aeven/client-ui-chat`（[`packages/client/ui-chat/src/index.ts`](../packages/client/ui-chat/src/index.ts)）
- `@aeven/client-ui-commands`（[`packages/client/ui-commands/src/index.ts`](../packages/client/ui-commands/src/index.ts)）
- `@aeven/client-ui-conversation`（[`packages/client/ui-conversation/src/index.ts`](../packages/client/ui-conversation/src/index.ts)）
- `@aeven/client-ui-cordis`（[`packages/extensions/ui-cordis/src/index.ts`](../packages/extensions/ui-cordis/src/index.ts)）
- `@aeven/client-ui-deliverables` — 需要 `systemPrompt`（[`packages/client/ui-deliverables/src/index.ts`](../packages/client/ui-deliverables/src/index.ts)）
- `@aeven/client-ui-directory-picker-browse`（[`packages/client/ui-directory-picker-browse/src/index.ts`](../packages/client/ui-directory-picker-browse/src/index.ts)）
- `@aeven/client-ui-directory-picker-native`（[`packages/client/ui-directory-picker-native/src/index.ts`](../packages/client/ui-directory-picker-native/src/index.ts)）
- `@aeven/client-ui-goal`（[`packages/client/ui-goal/src/index.ts`](../packages/client/ui-goal/src/index.ts)）
- `@aeven/client-ui-input-trigger`（[`packages/client/ui-input-trigger/src/index.ts`](../packages/client/ui-input-trigger/src/index.ts)）
- `@aeven/client-ui-jobs`（[`packages/client/ui-jobs/src/index.ts`](../packages/client/ui-jobs/src/index.ts)）
- `@aeven/client-ui-layout`（[`packages/client/ui-layout/src/index.ts`](../packages/client/ui-layout/src/index.ts)）
- `@aeven/client-ui-message-feedback`（[`packages/client/ui-message-feedback/src/index.ts`](../packages/client/ui-message-feedback/src/index.ts)）
- `@aeven/client-ui-model-selection`（[`packages/client/ui-model-selection/src/index.ts`](../packages/client/ui-model-selection/src/index.ts)）
- `@aeven/client-ui-permission-presets`（[`packages/client/ui-permission-presets/src/index.ts`](../packages/client/ui-permission-presets/src/index.ts)）
- `@aeven/client-ui-plan`（[`packages/client/ui-plan/src/index.ts`](../packages/client/ui-plan/src/index.ts)）
- `@aeven/client-ui-reference`（[`packages/client/ui-reference/src/index.ts`](../packages/client/ui-reference/src/index.ts)）
- `@aeven/client-ui-renderer`（[`packages/client/ui-renderer/src/index.ts`](../packages/client/ui-renderer/src/index.ts)）
- `@aeven/client-ui-schedule`（[`packages/client/ui-schedule/src/index.ts`](../packages/client/ui-schedule/src/index.ts)）
- `@aeven/client-ui-session`（[`packages/client/ui-session/src/index.ts`](../packages/client/ui-session/src/index.ts)）
- `@aeven/client-ui-settings`（[`packages/client/ui-settings/src/index.ts`](../packages/client/ui-settings/src/index.ts)）
- `@aeven/client-ui-settings-general`（[`packages/client/ui-settings-general/src/index.ts`](../packages/client/ui-settings-general/src/index.ts)）
- `@aeven/client-ui-settings-models`（[`packages/client/ui-settings-models/src/index.ts`](../packages/client/ui-settings-models/src/index.ts)）
- `@aeven/client-ui-settings-plugin-inventory`（[`packages/client/ui-settings-plugin-inventory/src/index.ts`](../packages/client/ui-settings-plugin-inventory/src/index.ts)）
- `@aeven/client-ui-settings-plugins`（[`packages/client/ui-settings-plugins/src/index.ts`](../packages/client/ui-settings-plugins/src/index.ts)）
- `@aeven/client-ui-sidebar`（[`packages/client/ui-sidebar/src/index.ts`](../packages/client/ui-sidebar/src/index.ts)）
- `@aeven/client-ui-sidebar-right`（[`packages/client/ui-sidebar-right/src/index.ts`](../packages/client/ui-sidebar-right/src/index.ts)）
- `@aeven/client-ui-skill`（[`packages/client/ui-skill/src/index.ts`](../packages/client/ui-skill/src/index.ts)）
- `@aeven/client-ui-subagent`（[`packages/client/ui-subagent/src/index.ts`](../packages/client/ui-subagent/src/index.ts)）
- `@aeven/client-ui-theme`（[`packages/client/ui-theme/src/index.ts`](../packages/client/ui-theme/src/index.ts)）
- `@aeven/client-ui-tool`（[`packages/client/ui-tool/src/index.ts`](../packages/client/ui-tool/src/index.ts)）
- `@aeven/client-ui-trajectory`（[`packages/client/ui-trajectory/src/index.ts`](../packages/client/ui-trajectory/src/index.ts)）
- `@aeven/client-ui-user-questions`（[`packages/client/ui-user-questions/src/index.ts`](../packages/client/ui-user-questions/src/index.ts)）
- `@aeven/client-ui-workflow-run`（[`packages/client/ui-workflow-run/src/index.ts`](../packages/client/ui-workflow-run/src/index.ts)）
- `@aeven/client-ui-workspace`（[`packages/client/ui-workspace/src/index.ts`](../packages/client/ui-workspace/src/index.ts)）
- `@aeven/command-compact` — 需要 `commands` · `compact`（[`packages/compaction/command-compact/src/index.ts`](../packages/compaction/command-compact/src/index.ts)）
- `@aeven/command-feedback` — 需要 `commands`（[`packages/feedback/command-feedback/src/index.ts`](../packages/feedback/command-feedback/src/index.ts)）
- `@aeven/command-goal` — 需要 `commands` · `goals`（[`packages/goal/command-goal/src/index.ts`](../packages/goal/command-goal/src/index.ts)）
- `@aeven/commands`（[`packages/interaction/commands/src/index.ts`](../packages/interaction/commands/src/index.ts)）
- `@aeven/computer-use`（[`packages/computer-use/computer-use/src/index.ts`](../packages/computer-use/computer-use/src/index.ts)）
- `@aeven/cordis-client-runner`（[`packages/extensions/cordis-client-runner/src/index.ts`](../packages/extensions/cordis-client-runner/src/index.ts)）
- `@aeven/deepseek-llm-api-extensions`（[`packages/llm/deepseek-llm-api-extensions/src/index.ts`](../packages/llm/deepseek-llm-api-extensions/src/index.ts)）
- `@aeven/experimental-client-ui-agent-team`（[`packages/experimental/client-ui-agent-team/src/index.ts`](../packages/experimental/client-ui-agent-team/src/index.ts)）
- `@aeven/fs-e2b` — 需要 `e2b`（[`packages/e2b/fs-e2b/src/index.ts`](../packages/e2b/fs-e2b/src/index.ts)）
- `@aeven/fs-observation-policy`（[`packages/fs/fs-observation-policy/src/index.ts`](../packages/fs/fs-observation-policy/src/index.ts)）
- `@aeven/goal-round-driver` — 需要 `agents` · `goals` · `sessions`（[`packages/goal/goal-round-driver/src/index.ts`](../packages/goal/goal-round-driver/src/index.ts)）
- `@aeven/host-directory-picker-auto` — 需要 `webServer` · `loader`（[`packages/host/directory-picker-auto/src/index.ts`](../packages/host/directory-picker-auto/src/index.ts)）
- `@aeven/host-directory-picker-native`（[`packages/host/directory-picker-native/src/index.ts`](../packages/host/directory-picker-native/src/index.ts)）
- `@aeven/host-plugin-inventory` — 需要 `loader`（[`packages/host/plugin-inventory/src/index.ts`](../packages/host/plugin-inventory/src/index.ts)）
- `@aeven/identity-user` ([`packages/identity/user/src/index.ts`](../packages/identity/user/src/index.ts))
- `@aeven/llm`（[`packages/llm/llm/src/index.ts`](../packages/llm/llm/src/index.ts)）
- `@aeven/lsp`（[`packages/lsp/lsp/src/index.ts`](../packages/lsp/lsp/src/index.ts)）
- `@aeven/schedule` — 需要 `agents` · `sessions` · `tools` · `sessionPersistence`（[`packages/schedule/schedule/src/index.ts`](../packages/schedule/schedule/src/index.ts)）
- `@aeven/session`（[`packages/core/session/src/index.ts`](../packages/core/session/src/index.ts)）
- `@aeven/session-checkpoint-policy` — 需要 `llm` · `sessionPersistence` · `sessions` · `tools`（[`packages/session/session-checkpoint-policy/src/index.ts`](../packages/session/session-checkpoint-policy/src/index.ts)）
- `@aeven/session-projection`（[`packages/session/session-projection/src/index.ts`](../packages/session/session-projection/src/index.ts)）
- `@aeven/session-stats` — 需要 `sessionProjections`（[`packages/session/session-stats/src/index.ts`](../packages/session/session-stats/src/index.ts)）
- `@aeven/session-turn-outline` — 需要 `sessionProjections`（[`packages/session/session-turn-outline/src/index.ts`](../packages/session/session-turn-outline/src/index.ts)）
- `@aeven/skill-badge` — 需要 `skills`（[`packages/skill/skill-badge/src/index.ts`](../packages/skill/skill-badge/src/index.ts)）
- `@aeven/storage`（[`packages/storage/storage/src/index.ts`](../packages/storage/storage/src/index.ts)）
- `@aeven/subagent`（[`packages/subagent/subagent/src/index.ts`](../packages/subagent/subagent/src/index.ts)）
- `@aeven/subprocess-local`（[`packages/subprocess/subprocess-local/src/index.ts`](../packages/subprocess/subprocess-local/src/index.ts)）
- `@aeven/terminal`（[`packages/terminal/terminal/src/index.ts`](../packages/terminal/terminal/src/index.ts)）
- `@aeven/tool-ask-user` — 需要 `tools` · `userInteraction`（[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)）
- `@aeven/tool-call-timeout-policy` — 需要 `tools`（[`packages/guard/timeout-policy/src/index.ts`](../packages/guard/timeout-policy/src/index.ts)）
- `@aeven/tool-cordis` — 需要 `tools` · `systemPrompt` · `dynamicCordisRunner` · `cordisInspect`（[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)）
- `@aeven/tool-subagent-control` — 需要 `tools` · `subagents`（[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)）
- `@aeven/user-questions`（[`packages/interaction/user-questions/src/index.ts`](../packages/interaction/user-questions/src/index.ts)）
- `@aeven/webhook` — 需要 `agents` · `agentDefaultModel` · `agentPresets` · `permissionPresets` · `sessionTitle` · `workspaceRegistry`（[`packages/webhook/webhook/src/index.ts`](../packages/webhook/webhook/src/index.ts)）

## Seam 包（不可直接加载）

抽象服务类——部署时应改为加载具体的实现包（参见[能力 seam](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)）。

- `@aeven/attachment` — 抽象 `AttachmentStore`（[`packages/attachment/attachment/src/index.ts`](../packages/attachment/attachment/src/index.ts)）
- `@aeven/code-runtime` — 抽象 `CodeRuntime`（[`packages/code-runtime/code-runtime/src/index.ts`](../packages/code-runtime/code-runtime/src/index.ts)）
- `@aeven/compaction` — 抽象 `CompactionEngine`（[`packages/compaction/compaction/src/index.ts`](../packages/compaction/compaction/src/index.ts)）
- `@aeven/credentials` — 抽象 `Credentials`（[`packages/credentials/credentials/src/index.ts`](../packages/credentials/credentials/src/index.ts)）
- `@aeven/file-reference` — 抽象 `FileReferenceService`（[`packages/context/file-reference/src/index.ts`](../packages/context/file-reference/src/index.ts)）
- `@aeven/fs` — 抽象 `FileSystem`（[`packages/fs/fs/src/index.ts`](../packages/fs/fs/src/index.ts)）
- `@aeven/host-directory-picker` — 抽象 `DirectoryPicker`（[`packages/host/directory-picker/src/index.ts`](../packages/host/directory-picker/src/index.ts)）
- `@aeven/jobs` — 抽象 `JobRegistry`（[`packages/jobs/jobs/src/index.ts`](../packages/jobs/jobs/src/index.ts)）
- `@aeven/sandbox` — 抽象 `SandboxProvider`（[`packages/sandbox/sandbox/src/index.ts`](../packages/sandbox/sandbox/src/index.ts)）
- `@aeven/session-persistence` — 抽象 `SessionPersistence`（[`packages/session/session-persistence/src/index.ts`](../packages/session/session-persistence/src/index.ts)）
- `@aeven/session-query` — 抽象 `SessionQueryEngine`（[`packages/session-query/session-query/src/index.ts`](../packages/session-query/session-query/src/index.ts)）
- `@aeven/settings` — 抽象 `Settings`（[`packages/settings/settings/src/index.ts`](../packages/settings/settings/src/index.ts)）
- `@aeven/shell` — 抽象 `ShellExecutor`（[`packages/shell/shell/src/index.ts`](../packages/shell/shell/src/index.ts)）
- `@aeven/spill` — 抽象 `SpillStore`（[`packages/spill/spill/src/index.ts`](../packages/spill/spill/src/index.ts)）
- `@aeven/subprocess` — 抽象 `SubprocessRuntime`（[`packages/subprocess/subprocess/src/index.ts`](../packages/subprocess/subprocess/src/index.ts)）
- `@aeven/workflow` — 抽象 `WorkflowEngine`（[`packages/workflow/workflow/src/index.ts`](../packages/workflow/workflow/src/index.ts)）

## 库包（无插件入口）

由其他包作为库导入；`cordis.yml` 无法加载它们。

- `@aeven/agent-loop-testkit`（[`packages/test-support/agent-loop-testkit/src/index.ts`](../packages/test-support/agent-loop-testkit/src/index.ts)）
- `@aeven/anonymous-user-id`（[`packages/identity/anonymous-user-id/src/index.ts`](../packages/identity/anonymous-user-id/src/index.ts)）
- `@aeven/app-boot`（[`packages/boot/app-boot/src/index.ts`](../packages/boot/app-boot/src/index.ts)）
- `@aeven/atomic-write`（[`packages/util/atomic-write/src/index.ts`](../packages/util/atomic-write/src/index.ts)）
- `@aeven/base`（[`packages/bundle/base/src/index.ts`](../packages/bundle/base/src/index.ts)）
- `@aeven/brand`（[`packages/util/brand/src/index.ts`](../packages/util/brand/src/index.ts)）
- `@aeven/client-hypermarkdown`（[`packages/client/hypermarkdown/src/index.ts`](../packages/client/hypermarkdown/src/index.ts)）
- `@aeven/client-store`（[`packages/client/store/src/index.ts`](../packages/client/store/src/index.ts)）
- `@aeven/client-test-runtime`（[`packages/test-support/client-runtime/src/index.ts`](../packages/test-support/client-runtime/src/index.ts)）
- `@aeven/client-ui-auth-aeven` ([`packages/client/ui-auth-aeven/src/index.ts`](../packages/client/ui-auth-aeven/src/index.ts))
- `@aeven/client-ui-primitives`（[`packages/client/ui-primitives/src/index.ts`](../packages/client/ui-primitives/src/index.ts)）
- `@aeven/client-ui-slots`（[`packages/client/ui-slots/src/index.ts`](../packages/client/ui-slots/src/index.ts)）
- `@aeven/client-web`（[`packages/client/web/src/index.ts`](../packages/client/web/src/index.ts)）
- `@aeven/cmdline`（[`packages/boot/cmdline/src/index.ts`](../packages/boot/cmdline/src/index.ts)）
- `@aeven/computer-use-benchmark` ([`packages/computer-use/computer-use-benchmark/src/index.ts`](../packages/computer-use/computer-use-benchmark/src/index.ts))
- `@aeven/computer-use-desktop` ([`packages/computer-use/computer-use-desktop/src/index.ts`](../packages/computer-use/computer-use-desktop/src/index.ts))
- `@aeven/computer-use-executor` ([`packages/computer-use/computer-use-executor/src/index.ts`](../packages/computer-use/computer-use-executor/src/index.ts))
- `@aeven/computer-use-formats` ([`packages/computer-use/computer-use-formats/src/index.ts`](../packages/computer-use/computer-use-formats/src/index.ts))
- `@aeven/computer-use-layout` ([`packages/computer-use/computer-use-layout/src/index.ts`](../packages/computer-use/computer-use-layout/src/index.ts))
- `@aeven/computer-use-linux` ([`packages/computer-use/computer-use-linux/src/index.ts`](../packages/computer-use/computer-use-linux/src/index.ts))
- `@aeven/computer-use-macos` ([`packages/computer-use/computer-use-macos/src/index.ts`](../packages/computer-use/computer-use-macos/src/index.ts))
- `@aeven/computer-use-macos-apple-events` ([`packages/computer-use/computer-use-macos-apple-events/src/index.ts`](../packages/computer-use/computer-use-macos-apple-events/src/index.ts))
- `@aeven/computer-use-router` ([`packages/computer-use/computer-use-router/src/index.ts`](../packages/computer-use/computer-use-router/src/index.ts))
- `@aeven/computer-use-session` ([`packages/computer-use/computer-use-session/src/index.ts`](../packages/computer-use/computer-use-session/src/index.ts))
- `@aeven/computer-use-tasks` ([`packages/computer-use/computer-use-tasks/src/index.ts`](../packages/computer-use/computer-use-tasks/src/index.ts))
- `@aeven/computer-use-windows` ([`packages/computer-use/computer-use-windows/src/index.ts`](../packages/computer-use/computer-use-windows/src/index.ts))
- `@aeven/deque`（[`packages/util/deque/src/index.ts`](../packages/util/deque/src/index.ts)）
- `@aeven/experimental-agent-team-profile`（[`packages/experimental/agent-team-profile/src/index.ts`](../packages/experimental/agent-team-profile/src/index.ts)）
- `@aeven/experimental-agent-team-web-profile`（[`packages/experimental/agent-team-web-profile/src/index.ts`](../packages/experimental/agent-team-web-profile/src/index.ts)）
- `@aeven/experimental-browser-overlay`（[`packages/experimental/browser-overlay/src/index.ts`](../packages/experimental/browser-overlay/src/index.ts)）
- `@aeven/experimental-webworker-packer`（[`packages/experimental/webworker-packer/src/index.ts`](../packages/experimental/webworker-packer/src/index.ts)）
- `@aeven/experimental-webworker-runtime`（[`packages/experimental/webworker-runtime/src/index.ts`](../packages/experimental/webworker-runtime/src/index.ts)）
- `@aeven/home-paths`（[`packages/util/home-paths/src/index.ts`](../packages/util/home-paths/src/index.ts)）
- `@aeven/hook-protocol`（[`packages/hooks/hook-protocol/src/index.ts`](../packages/hooks/hook-protocol/src/index.ts)）
- `@aeven/http-proxy`（[`packages/util/http-proxy/src/index.ts`](../packages/util/http-proxy/src/index.ts)）
- `@aeven/launch-environment`（[`packages/util/launch-environment/src/index.ts`](../packages/util/launch-environment/src/index.ts)）
- `@aeven/llm-mock-server`（[`packages/test-support/llm-mock-server/src/index.ts`](../packages/test-support/llm-mock-server/src/index.ts)）
- `@aeven/loader-smoke`（[`packages/test-support/loader-smoke/src/index.ts`](../packages/test-support/loader-smoke/src/index.ts)）
- `@aeven/native-command`（[`packages/util/native-command/src/index.ts`](../packages/util/native-command/src/index.ts)）
- `@aeven/output-retention`（[`packages/util/output-retention/src/index.ts`](../packages/util/output-retention/src/index.ts)）
- `@aeven/sandbox-windows-acl`（[`packages/sandbox/sandbox-windows-acl/src/index.ts`](../packages/sandbox/sandbox-windows-acl/src/index.ts)）
- `@aeven/scope`（[`packages/core/scope/src/index.ts`](../packages/core/scope/src/index.ts)）
- `@aeven/sdk-client`（[`packages/sdk/client/src/index.ts`](../packages/sdk/client/src/index.ts)）
- `@aeven/sdk-minimal`（[`packages/bundle/sdk-minimal/src/index.ts`](../packages/bundle/sdk-minimal/src/index.ts)）
- `@aeven/sdk-protocol`（[`packages/sdk/protocol/src/index.ts`](../packages/sdk/protocol/src/index.ts)）
- `@aeven/session-snapshot`（[`packages/test-support/session-snapshot/src/index.ts`](../packages/test-support/session-snapshot/src/index.ts)）
- `@aeven/session-telemetry`（[`packages/session/session-telemetry/src/index.ts`](../packages/session/session-telemetry/src/index.ts)）
- `@aeven/session-title-llm`（[`packages/session/session-title-llm/src/index.ts`](../packages/session/session-title-llm/src/index.ts)）
- `@aeven/subagent-in-process-driver`（[`packages/subagent/subagent-in-process-driver/src/index.ts`](../packages/subagent/subagent-in-process-driver/src/index.ts)）
- `@aeven/timeout`（[`packages/util/timeout/src/index.ts`](../packages/util/timeout/src/index.ts)）
- `@aeven/typert-generator`（[`packages/typert/generator/src/index.ts`](../packages/typert/generator/src/index.ts)）
- `@aeven/typert-protocol`（[`packages/typert/protocol/src/index.ts`](../packages/typert/protocol/src/index.ts)）
- `@aeven/typert-registry`（[`packages/typert/registry/src/index.ts`](../packages/typert/registry/src/index.ts)）
- `@aeven/util-crypto`（[`packages/util/crypto/src/index.ts`](../packages/util/crypto/src/index.ts)）
- `@aeven/util-time`（[`packages/util/time/src/index.ts`](../packages/util/time/src/index.ts)）
- `@aeven/util-values`（[`packages/util/values/src/index.ts`](../packages/util/values/src/index.ts)）
- `@aeven/util-workspace-path`（[`packages/util/workspace-path/src/index.ts`](../packages/util/workspace-path/src/index.ts)）
- `@aeven/win32-process`（[`packages/subprocess/win32-process/src/index.ts`](../packages/subprocess/win32-process/src/index.ts)）
