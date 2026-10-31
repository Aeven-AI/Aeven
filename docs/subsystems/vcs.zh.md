# 版本控制

[English](vcs.md) | 中文

源码管理作为一个[能力接缝](../../docs/glossary.zh.md#capability-seam)：一个 `ctx.vcs` 服务报告检出目录的分支、变更路径、差异与历史，并执行模型要求的改动——暂存、提交、分支、拉取、推送、合并——调用方无需解析任何引擎的终端输出。该接缝分为三个包：服务定义（[avn-vcs](../../packages/vcs/vcs)，`ctx.vcs` 与提供方注册表）、服务提供方（[avn-vcs-git](../../packages/vcs/vcs-git)，通过 `ctx.subprocess` 调用 git）以及消费者（[avn-tool-vcs](../../packages/vcs/tool-vcs)，`git_*` 工具）。版本控制是**一个可选能力**，不属于 agent-loop 主干。

Source: [`packages/vcs/vcs/src/types.ts`](../../packages/vcs/vcs/src/types.ts)

## 为什么用接缝而不是一个 git 工具

模型需要知道发生了什么改动，并记录改动；它不需要知道是哪个引擎记录的。把操作放在定义里，意味着由其他引擎托管、或能报告拉取请求的仓库可以与 git 并列注册，而不改动任何工具 schema 或提示词。工具消费者拥有所有对模型可见的文字；提供方只负责操作的执行方式。

## 操作

每个报告中的路径都是仓库相对路径并使用 POSIX 分隔符，每个操作都接受检出目录内的任意目录：提供方自行解析仓库并在其根目录执行。因此从子目录调用、以及从会话已迁入的 worktree 调用都能正常工作。

| 操作 | 报告或效果 |
|---|---|
| `detect` | 目录所属的检出根目录，或 null |
| `status` | 分支、上游、领先/落后数量，以及每个变更路径的已暂存与未暂存改动 |
| `diff` | 工作区对索引、索引对 HEAD，或两个版本之间的统一差异 |
| `log` | 近期提交的哈希、作者、日期与标题 |
| `stage` / `unstage` | 指定路径的索引条目 |
| `commit` | 提交索引，可先暂存指定路径 |
| `listBranches` / `switchBranch` / `deleteBranch` | 本地分支与检出分支 |
| `remote` | 拉取或推送 |
| `merge` | 合并到检出分支，或中止合并，并给出冲突路径 |

## 变更按两侧报告

一个路径是一条记录、带两个侧面，因为检出目录实际就是这样：文件可以已暂存为修改，之后又被再次修改。压成一个标签会丢掉提交会漏掉的事实。

```ts type-equiv
/** One changed path, with each side of the checkout reported separately. */
interface VcsChange {
  /** Repository-relative path, POSIX separators. */
  readonly path: string
  /** Staged change in the index, or null when the index matches the revision for this path. */
  readonly staged: VcsChangeKind | null
  /** Unstaged change in the working tree, or null when the file matches the index. */
  readonly worktree: VcsChangeKind | null
}
```

未分类的状态字符会变成 `unknown` 而不是“干净的一侧”，调用方因此不会把不认识的改动读成“没有可提交的内容”。

## 边界与失败

状态最多保留 `statusMaxEntries` 个路径，差异在 `diffMaxBytes` 处截断，两者都通过 `truncated` 说明。每个边界都是经过校验的 `Config` 字段。失败是带稳定代码的 `VcsError`——`VCS_NOT_A_REPOSITORY`、`VCS_DIRTY_WORKTREE`、`VCS_CONFLICT`、`VCS_INVALID_REQUEST`、`VCS_COMMAND_FAILED`、`VCS_UNAVAILABLE`、`VCS_INVALID_PROVIDER`、`VCS_CONFLICT_STATE`——工具因此可以把“切换会带走未提交改动”变成一条指示，而不是一次失败的命令。

## 提供方规则

提供方以原子方式占用一个带品牌标记的 id：注册在修改之前完成校验与冲突检查，其释放函数撤回整个提供方。选择时逐个询问提供方是否拥有该目录，因此只有一个提供方接受的目录不依赖注册顺序。

git 提供方以 `core.hooksPath=/dev/null` 与 `core.fsmonitor=false` 运行只读命令，仓库配置的程序因此无法改变状态或差异报告的内容；记录历史或移动检出目录的命令运行仓库自身的钩子，因为那里的钩子就是用户选择的策略。

## 相关

- [avn-vcs](../../packages/vcs/vcs/README.zh.md) — 定义。
- [avn-vcs-git](../../packages/vcs/vcs-git/README.zh.md) — git 提供方。
- [avn-tool-vcs](../../packages/vcs/tool-vcs/README.zh.md) — 面向模型的工具。
- [源码管理作为能力的 Agent Note](../../.agents/notes/implemented/architecture/2026-10-30-source-control-as-a-capability.zh.md) — 备选方案与延后事项。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvcs--vcsservice"></a>

### `ctx.vcs` — `VcsService`

`ctx.vcs`: the checkout operations over whichever provider handles the directory, plus the registration that supplies them.

```ts cordis-catalog
/**
 * Reserve a provider id and the operations it implements.
 * @param provider - the implementation to publish.
 * @returns the disposer that withdraws it.
 */
registerProvider(provider: VcsProvider): () => void

/**
 * Select the provider that handles a directory and resolve its repository.
 * @param cwd - any directory inside a checkout.
 * @param signal - cancels detection.
 * @returns the provider and the absolute repository root.
 */
repository(cwd: string, signal?: AbortSignal): Promise<{ provider: VcsProvider; repositoryRoot: string }>
```

Source: [`packages/vcs/vcs/src/types.ts`](../../packages/vcs/vcs/src/types.ts)
<!-- END GENERATED cordis-surface -->
