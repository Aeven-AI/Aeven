# Agent Note: 桌面发布的一次运行可指定多个目标

Status: implemented

[English](2026-10-16-desktop-release-selects-several-targets.md) | 中文

## 问题

该 workflow 的并发组（`release-desktop-${{ github.ref }}`）只保留一个待运行的 run，因此在已有 run 于该组中排队时到达的 dispatch 会把它替换掉。于是需要两个安装包的一次运行必须 dispatch 两次，而第二次 dispatch 会在 runner 接手之前取消第一次，两个目标只能相隔整整一次构建地先后构建。要在同一次运行里构建它们，唯一办法是选择 `all`，代价是连带构建所有其他目标与两个不签名的 macOS 变体。

## 决定

- **手动输入是逗号分隔的 `targets` 字符串。** `workflow_dispatch` 没有多选输入类型（[社区讨论](https://github.com/orgs/community/discussions/34298)），因此由操作者输入要构建的集合：`mac-arm64,mac-x64`、单个目标，或 `all` 表示全部目标；`all` 也是默认值，即标签推送所构建的内容。
- **`plan` 拆分并校验该集合。** 该步骤按逗号拆分字符串，去掉两侧空白与空项，对目标列表中没有的名称报错，对空集合报错。matrix 保持目标列表的顺序，并把重复的 id 折叠为一行，因此一个目标无论被列出多少次都只构建一次。
- **发布门槛比较数量。** `publish` 仍然需要全部目标，因此 `plan` 比较 matrix 的行数与目标列表的长度，而不是把一个输入与 `all` 比较。

目标列表、`plan`/`build` 的拆分与发布 job 来自[目标选择 Agent Note](2026-10-14-desktop-release-target-selection.zh.md)，本决定取代其中的单目标输入。

## 考虑过的替代方案

**两次单目标 dispatch。** 这是本决定所取代的行为，也是本次改动的原因：并发组只保留一个待运行的 run，因此第二次 dispatch 会取消第一个待运行的 run，两个目标要相隔整整一次构建分别构建。

**为只需要两个目标的请求选择 `all`。** 产物正确，但所有其他目标与两个不签名的 macOS 变体同样占用 runner，并出现在同一次运行的产物里。

**每个目标一个布尔输入，各自控制自己的 matrix 行。** 复选框比手输列表更好读，但 matrix 是动态构建的，用输入控制行会把选择逻辑搬进八份重复的行条件，`plan` 也无法再拒绝空集合，发布检查还得统计被启用的行数。

## 影响

- 在同一次运行中列出的目标会在各自的 runner 上并行构建，其安装包作为同一次运行的产物一起交付。
- 写错的目标名称会在 `plan` 阶段失败，错误信息会列出可接受的名称。
- 两次独立的 dispatch 之间仍然串行：该输入消除了拆分构建的理由，但没有改变排队规则。
- 该输入是自由文本，因此操作者要从输入描述、workflow 头部注释与 `apps/desktop/README.md` 了解可接受的名称。
