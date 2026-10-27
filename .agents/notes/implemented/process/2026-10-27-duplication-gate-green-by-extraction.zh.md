# Agent Note: 重复检测门通过抽取而非例外转绿

Status: implemented

[English](2026-10-27-duplication-gate-green-by-extraction.md) | 中文

## Problem

`pnpm run duplication` 在 `main` 上报告了 25 处克隆，因此任何改动都无法通过 `check:all`，`0.3.18-alpha` 发布时这道门已经是红的。这些克隆并不是同一个问题：其中十处是同一个辅助函数体写了两遍——复制过一次却因为两份各自落在不同包里而始终没有合并——其余的则是设计上刻意保持并行的表面，例如第二个平台的 provider 和第二个界面的字典。

## Decision

十对克隆现在共享同一个归属；[质量门槛笔记](2026-06-11-quality-gates.zh.md) 定下了这道叶子的存在，本记录定下它红色清单由什么构成。每次抽取都把不同之处变成一个参数，调用方只留下自己的数据：

- `@aeven/tools` 的 `jsonStringOutput()` 声明「以文本渲染的 `string`」输出，terminal-controller 与 workspace-files 两个工具各自写过一遍。
- `@aeven/util-values` 的 `embeddedJsonObject()` 从第一个 `{` 读到最后一个 `}` 再解析这段内容，正是 tool-capability 学习器与记忆相关性过滤器共同接受的模型输出形状。
- `@aeven/memory` 的 `mergeRankedHits()` 合并按分数排序的命中列表，记忆工具与 memos 召回路径各实现过一次。
- memos 运行时里的 `memosHome()` 命名账号的记忆主目录，插件入口与召回的排查脚本原本各自用同样的三次 join 拼出来。
- 媒体工具里的 `listedChoices()` 把能力接缝的清单过滤成设置界面所列的 provider，OpenRouter provider 里的 `catalogEntries()` 拉取并拆开目录载荷；两者的图像与视频路径现在只在调用的方法上不同。
- `@aeven/client-ui-primitives` 的 `videoPlayerLabels(t)` 读取片段播放器的十句界面文案，相机对话框与 Imagine 视频视图原本各自写全。
- 记忆设置里的 `Commit` 接收草稿并自行判断保存按钮是否可用，`EditCommit` 再加上编辑态判断，调用点不再重复这条规则；ui-workspace 的 `SessionOverflowToggle` 则是分组行与状态桶行共用的「展开隐藏会话」按钮。

其余十五处保持并行，并以窄范围的 `jscpd:ignore-start` / `jscpd:ignore-end` 标记写明所镜像的归属：账号界面的两步验证文案对 `auth.aeven` 的镜像、ui-settings-models 的模型能力图标对 subscription-auth 模型列表的镜像、Windows computer-use provider 的命令执行器、接缝外观与批量工具对 macOS provider 的镜像，以及 pwsh 工具与沙箱对其 bash 孪生包的镜像。pwsh 工具本就在参数表面和执行路径上带有标记，所以新增标记延续既有读法：孪生包拥有自己那份形状，标记指明它镜像的是哪个包。

### Verification

- `pnpm run duplication` 在 1995 个文件中报告 0 处克隆，此前为 25 处。
- `pnpm run typecheck` 对 Host 与 Client 两个程序均以 0 退出。

## Alternatives considered

**把 25 处全部标为刻意镜像。** 其中十处是完全相同的逻辑，没有平台或界面上的理由去差异，标注它们等于把同一条规则留成两份，下次改动要找两遍。

**把 Windows provider 的外观抽成共享包。** 命令执行器、接缝外观与批量工具合计约 130 行，差别只在平台字面量、工具名和文案。共享它们需要一个两个 provider 都引入的包，这会颠倒当前「一个平台就是一个带自己安装行的 provider 包」的打包方式；那一步该和第三个平台一起来，而不是和一次门禁清理一起来。

**让这道门红到下一个版本。** `check:all` 把关每一处改动，所以重复检测这一叶子变红会挡住无关的工作，也会在真出现新克隆的那天把它藏起来。

## Consequences

现在报告出的克隆意味着真的出现了新克隆，而不是既有清单上又多一行。被标注的镜像仍然作为例外可读：每个标记都点出它的孪生包，于是一边的改动会被看见为「另一边也该看」的改动。
