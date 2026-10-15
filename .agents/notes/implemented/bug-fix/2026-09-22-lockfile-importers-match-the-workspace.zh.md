# Agent Note: Lockfile importers must name exactly the workspace packages

Status: implemented

[English](2026-09-22-lockfile-importers-match-the-workspace.md) | 中文

## Problem

已合并的 `main` 上带着一个指向 `packages/experimental/browser-devtools` 的 `pnpm-lock.yaml` importer，而该目录只存在于某次共享检出中的未跟踪占位目录里。`bc12e4bc42`（PR #58）提交了那里一次不完整 `pnpm install` 产出的锁文件，`363e6d83d7`（PR #61）又用一个不含该目录的检出执行 `pnpm install --lockfile-only`，把那两行删掉（[issue #59](https://github.com/Aeven-AI/Aeven/issues/59)）。

两条实测到的安装行为决定了门禁必须接管什么：

- 没有对应工作区目录的锁文件 importer 能通过 `pnpm install --frozen-lockfile`。在一个合成工作区中，无论锁文件里是否已经解析出依赖，该命令都以 0 退出，打印 `Already up to date`，并重写 `pnpm-lock.yaml` 去掉那条外来条目。`.gitlab-ci.yml` 正是用 `--frozen-lockfile` 安装，因此 CI 只在它自己的检出里悄悄删掉这条条目，什么也不报告；已提交的文件只有仓库门禁能报告。
- 没有 importer 的工作区包在同一条命令下会失败：只要该包声明了 specifier，就报 `ERR_PNPM_OUTDATED_LOCKFILE`（实测新增一个依赖，退出码 1）；若一个 specifier 都不声明，则被悄悄补上一条空 importer。

没有任何门禁读取 importer 键集合。[`verify-vendored-links`](../../../../scripts/verify-vendored-links.ts) 会读 `pnpm-lock.yaml`，但只核对 vendor 名称的解析结果；[`check-workspace-constraints`](../../../../scripts/check-workspace-constraints.ts) 与 [`verify-package-dependencies`](../../../../scripts/verify-package-dependencies.ts) 读的是清单、源码和目录层级。在带着那条外来条目的提交上，`pnpm run verify-package-dependencies` 报的是 PASS。

## Decision

由 [`verify-package-dependencies`](../../../../scripts/verify-package-dependencies.ts) 负责这项一致性，因为它本就拥有 `pnpm-lock.yaml`：它正是重新生成该文件的门禁，检查与其修复因此同处一室。它的检查项 `lockfile workspace importers` 在 `pnpm run verify-package-dependencies` 内运行，而后者是 `pnpm run hygiene`、`pnpm run check:all` 以及两个静态 CI 聚合的门禁叶子。

- 工作区目录取自 `pnpm-workspace.yaml` 的 `packages` 成员 glob，也就是仓库自己的事实来源，绝不取自门禁内的清单。一个目录只有在某个 glob 命中它**并且**其中存在 `package.json` 时才算工作区包，这正是 pnpm 自己的成员规则；因此被 glob 命中但没有清单的目录既不是包，也不该有 importer。取反 glob（`'!packages/experimental/*'`）会排除它命中的内容，`.` 虽不被任何 glob 命名，同样是成员。
- 两个方向都算违规。每行都点名出问题的目录和违反的方向：没有对应工作区包的 importer（`pnpm-lock.yaml names this directory as a workspace importer, but no workspace package exists here`），或没有 importer 的工作区包（`workspace package has no pnpm-lock.yaml importer`）。每行同时给出修复方式。
- 读取端在以下情形抛错而不是放过：工作区文件未声明任何成员、成员 glob 没有命中任何清单、锁文件未声明任何 importer。否则任一侧的空集合会与一切相符。
- `--fix` 通过它本就执行的刷新同时修复两个方向；`pnpm install --lockfile-only` 会删掉外来 importer，也会补上缺失的 importer。
- 锁文件检查无论依赖策略报了什么都会执行，因此一次运行就能点出所有失败的门禁。通过时该门禁打印检查项名称以及它与之达成一致的包数量。

[`verify-package-dependencies.spec.ts`](../../../../scripts/verify-package-dependencies.spec.ts) 在自己的 `lockfile workspace importers` 块中覆盖该检查：从成员 glob 加仓库根派生目录集合、glob 取反、被 glob 命中却无清单的目录、两个方向各自的拒绝用例（逐字断言出问题的路径）、两个方向同时出现、匹配的锁文件被接受、仓库自身已提交的锁文件被接受，以及三种响亮失败。其 fixture 写入 `mkdtemp` 目录，因此不涉及编译树的 probe 窗口。

## Alternatives considered

**另起一个门禁脚本，配自己的 `package.json` 脚本条目与 `run-gates` 叶子。** 否决：这样工作区定义与锁文件会被两个脚本读取，而重新生成 `pnpm-lock.yaml` 的门禁正是其 `--fix` 能修复该缺陷的那一个。检查项所需的名称在属主门禁内即可给出，无需为此给仓库添第三个安装事实的归属地。

**放进负责工作区成员集合的 `constraints` 门禁（`scripts/check-workspace-constraints.ts`）。** 否决：该门禁被记录为与包管理器无关——它的不变式只陈述于清单和 `packages/<group>/<pkg>` 层级之上——而且它不读锁文件。把 `pnpm-lock.yaml` 读取端放进去，等于用一项已被记录的性质换取位置上的邻近。

**沿用两个邻近脚本都带有的硬编码成员 glob。** 否决：写死在门禁里的清单会与 `pnpm-workspace.yaml` 悄悄漂移，而这正是本检查存在的意义。

**只拒绝没有对应工作区包的 importer。** 否决：没有 importer 的工作区包会让新克隆上的 `pnpm install --frozen-lockfile` 失败，也就是说同一个锁文件在另一方向上已经弄坏 CI 安装，而门禁仍为绿。

**让 `pnpm install --frozen-lockfile` 本身充当检查。** 否决：它根本不拒绝那条外来 importer；它需要已填充的 store 或网络；而且它会重写那个本应被它断言的文件。

**只在 spec 中断言仓库自己的锁文件。** 否决：这样检查会经由 test 车道报告，既不点出出问题的目录，也没有读者可以重跑的门禁名称。

## Consequences

- 新增或删除工作区包如今带有会响亮失败的锁文件义务：执行 `pnpm install`，或执行 `pnpm run verify-package-dependencies -- --fix`，让 importer 集合随之更新。即便某个包目录不声明任何依赖、安装过程本会悄悄补上它，缺少 importer 也照样被拒绝，因为已提交的锁文件是仓库事实，而不是安装产物。
- 在当前树上，该检查读取 300 个工作区包目录与 300 个 importer 并通过；spec 针对仓库根断言同一份一致性，因此日后的偏离会以一个带路径信息的具名用例失败。
- 该门禁多读两个文件。这份代价每次运行只付一次，而且检查是在依赖策略之后追加报告，而非取代它。
- 该检查只能看到成员 glob 覆盖到的目录。提交在任何 `pnpm-workspace.yaml` glob 之外的包对它依旧不可见，对 `constraints` 门禁自己那套硬编码遍历同样不可见；把成员区域声明进 `pnpm-workspace.yaml`，才是让两道门禁都覆盖到它的做法。
