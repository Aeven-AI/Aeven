# Agent Note: 桌面发布目标按次选择

Status: implemented

[English](2026-10-14-desktop-release-target-selection.md) | 中文

## 问题

`.github/workflows/release-desktop.yml` 把发布目标放在同一个 job matrix 里，因此每次手动运行都会在 macOS、Windows、Linux runner 上同时构建全部六个目标。只需要一个安装包的一次运行要为其馀五个付出代价，或者中途被取消；而当签名构建卡在公证环节时，也没有办法单独构建始终不签名的 macOS DMG。

## 决定

- **目标列表是 `plan` job 中的一份 JSON 数组。** 每个条目带有 `id`、`target`、`runner` 与 `script`；不签名的 macOS 变体额外带 `variant: unsigned`。该 job 选出本次运行要求的目标，通过 `fromJSON` 交给 `build` job 的 `matrix`，并为缺少该键的条目补上 `variant: ""`，让每一行的键完全相同。输出采用动态 matrix 要求的 `{"include": [...]}` 对象形式：裸数组会在任何 job 被调度之前就以 `A sequence was not expected` 让整次运行失败。`v<version>` 标签推送与 `all` 选择都会选中全部条目。
- **手动运行指定一个或多个目标。** `workflow_dispatch` 接受逗号分隔的 `targets` 字符串输入，默认为 `all`，也就是标签推送所构建的内容。签名与不签名的 macOS 构建是两个独立名称，因此同时列出两者即可构建两个 DMG；它取代的单目标选择输入为何落选，见[多目标 Agent Note](2026-10-16-desktop-release-selects-several-targets.zh.md)。
- **`plan` 拒绝部分构建的发布。** 发布 job 把全部目标的安装包与更新元数据作为同一个版本发布，因此命名目标少于全部又设置了 `publish` 的运行会在 `plan` 阶段失败，此时还没有 runner 开始打包。
- **无法识别的目标在 `plan` 阶段失败**，而不是作为空 matrix 交给 GitHub，否则它只会报告该 job 被跳过；没有命名任何目标的集合同样如此。

## 考虑过的替代方案

**用一个 `targets` 输入过滤现有的 `include:` 列表。** 这是对该文件改动最小的做法，但静态的 `include:` 列表无法收窄：每个条目仍会生成自己的 job，因此过滤必须把列表搬进 matrix 表达式本身，这也正是 `plan` job 所做的事。已上线的 `targets` 输入出于同样的原因把选择表示为逗号分隔的字符串——`workflow_dispatch` 没有多选输入类型——而不是过滤静态列表（[Agent Note](2026-10-16-desktop-release-selects-several-targets.zh.md)）。

**每个目标一个 workflow 文件。** 每个目标都会在 Actions 侧栏拥有自己的 Run 按钮，代价是签名、打包、收集这些步骤要么复制六份，要么写成六个包在 `workflow_call` 构建 workflow 外的薄壳——而且无论哪种方式，标签发布都要再对它们做一次扇出。

**每个目标一个 job，各自用自己的输入开关。** 不需要共享的选择逻辑，但每个 job 都在固定的 `runs-on` 后重复同一份步骤列表，标签发布仍然需要扇出。

## 影响

- 每次手动运行会为每个命名的目标占用一个 runner；标签发布与以前一样构建并发布全部八个目标。
- `build` 会在 matrix 解析前等待 `plan`（在 `ubuntu-latest` 上是数秒），而 `plan` 失败会在任何 runner 安装依赖之前终止本次运行。
- 目标列表是 `plan` 步骤内的 JSON 字面量，而不是可见的 matrix 结构，因此读者要从 workflow 头部注释、`targets` 输入的描述与 `apps/desktop/README.md` 了解该输入接受哪些名称。
