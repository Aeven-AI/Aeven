# Agent Note: 拉取请求门禁在 GitHub 上运行

Status: implemented

[English](2026-10-31-pull-request-gates-run-on-github.md) | 中文

## 问题

`main` ruleset 要求 pull request，并拒绝直接推送、删除与强推，但不要求任何状态检查，因此一个带失败的 typecheck、仓库级 lint 报错、过期录制快照或无法构建的包的 pull request 都能合并。`scripts/run-gates.ts` 已为其中每一项定义了 lane，但没有任何机制在 pull request 上执行它：门禁矩阵只在贡献者主动运行时才跑，而钩子有意止步于暂存 lint、暂存空白检查、vendor manifest 守卫和推送时的 typecheck。

## 决定

- **`.github/workflows/ci.yml` 运行三条 lane**：每个进入 `main` 的 pull request、每个 merge queue 条目，以及手动触发，各以 Node 24 运行一个作业：`static` 与 `types-lint` 在 `ubuntu-latest`，`build-verify` 在 `macos-latest`。
- **`build-verify` 只构建一次工作区**，然后运行所有读取构建产物的门禁：`publint`、NodeNext 消费方类型、已构建包的 invariant，以及无密钥的录制会话回放。回放读取的是本平台的沙箱与进程树行为，因此该作业跑在 macOS 上。
- **`main` ruleset 要求这三个作业名**——`static`、`types-lint`、`build-verify`——与既有的 pull request、删除、非快进规则并列。
- **覆盖率留在本地。** `pnpm run test:coverage` 仍是本仓库的门禁覆盖率运行，不进入每次推送的路径：在插桩下逐文件 100% 是矩阵中最慢的 lane，而一个因 runner 容量而非改动本身失败的 lane 只会让贡献者学会忽略该检查。
- **其余 lane 同样留在本地**：`check:ci:consumers`（Node 22.19/24/26 兼容性、浏览器 web 快照、doc typecheck）、各 Windows lane、`pnpm run test:e2e`（需要 `DEEPSEEK_API_KEY`，来自 fork 的 pull request 永远拿不到），以及所有文档门禁，它们按政策仅供参考。
- **重复代码检查与快照回放只报告，不阻塞。** `main` 上仍开着六处克隆，分布在各个包的 `sync.ts` 模块里；此外若干 headless 夹具早于工作目录提示段落，两者都需要一个共享 helper 或一次带密钥的 `test:snapshot:record` 才能成为合并门禁，而 `ci-primary` 仍会因它们失败。
- **文档门禁在同一个进程里运行。** `pnpm run doc-gates` 在 `static` lane 内用一个 Node 进程执行工作区约束与 Markdown 换行检查，而不是各起一个 `pnpm run` 子进程。
- **不使用 `paths:` 过滤器。** 被过滤器跳过的必需检查永远不会上报，而未上报的必需检查会阻塞合并。

## 考虑过的替代方案

**把 `check:ci:primary` 作为单个必需作业。** 它已经包含其中大部分门禁，但一个检查名掩盖了失败的究竟是哪条 lane，并把整个矩阵串行成一条作业，耗时为各门禁之和。

**要求覆盖率门禁。** 它是文档规定的门禁运行，能在合并前发现未覆盖的行；否决的原因是插桩运行是最重的门禁，而缓慢的必需检查正是贡献者最先学会不信任的东西。

**改为在 `main` 上每晚跑一次矩阵。** 成本低得多，但报告在回归已经合并之后才到，而这正是本决定要消除的状态。被排除的 lane 日后仍可加一个夜间任务。

**用 `scripts/check-changed.ts` 把每个 pull request 收窄到它的 diff 范围。** 必需检查必须对每个 pull request 上报，而收窄的运行会对它过滤掉的门禁报告通过。

## 后果

- 一个 `build-verify` 作业为发布面与快照回放只构建一次工作区；分成两个作业就会构建两次，让每个 pull request 多付出一次完整编译。
- 合并现在要等三个检查，因此一个不稳定的检查会阻塞队列。`concurrency` 取消被取代的推送运行，并豁免 merge queue 批次，使 pull request 的推送无法取消它。
- 覆盖率、Node 兼容性矩阵、浏览器快照和 Windows lane 仍是需要人工运行的证据：在贡献者或诊断用的 agent 运行 `check:all` 之前，`main` 可能带着未覆盖的行。
- 这三个作业名是 ruleset 的标识符。重命名一个作业会让每个打开的 pull request 都等在一个永不上报的 context 上。
- 该工作流自身的 pull request 就是它的第一份证据：在 ruleset 要求这三个检查之前，它们先在这个改动上运行。
