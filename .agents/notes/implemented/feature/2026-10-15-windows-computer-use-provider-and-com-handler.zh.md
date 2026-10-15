# Agent Note: Windows 计算机使用通过第一方提供程序与 COM 处理器挂载

Status: implemented

[English](2026-10-15-windows-computer-use-provider-and-com-handler.md) | 中文

## Problem

计算机使用此前只在 macOS 上可达。`packages/bundle/web-app/cordis.patch.yml` 中挂载它的每一行都带着 `disabled: !!js "process.platform !== 'darwin'"`，而驱动那一行的 `command` 默认指向 macOS 的 bundle 路径，因此 Windows 主机加载后虽然能力、适配器与十三条已记录的 Office 配方都在，却没有一条可达。`@aeven/computer-use-windows` 已经用 UI Automation 与 PowerShell 实现了桌面契约，配方书也已经带着 Excel、Word、PowerPoint 的 `mechanism: 'com'` 条目——但没有任何地方实现 COM 处理器，因为 `@aeven/computer-use-executor` 只实现 filesystem 机制，其余机制都由 Consumer 提供。

另一条入口 Cua Driver 确实也提供 Windows 构建，而两个平台的安装方式不同：macOS 把 `CuaDriver.app` 装进 `/Applications`，因为正是 LaunchServices 的归属关系承载了辅助功能与屏幕录制授权；Windows 安装器则把 `cua-driver.exe` 放到 `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` 之下、藏在一条 junction 链后面，并把该目录加入用户 `PATH`。

## Decision

组合为注册表行与驱动行放行 `win32`，并按平台选择驱动路径：设置了 `AVN_CUA_DRIVER` 时用它，否则使用 Windows 的安装布局或 macOS 的 bundle 路径。Windows 的默认值是仅当驱动已安装时才存在的绝对路径，因此驱动未安装时两个平台都会退化为提供程序的安装指引工具，而不是通过 spawn 一个并不存在的 `PATH` 命令把整棵树拖垮。第三行在 `win32` 上以 `register: false` 挂载 `@aeven/computer-use-windows-provider`，与 macOS 提供程序在驱动旁挂载的方式一致。

`@aeven/computer-use-windows-com` 实现 COM 机制。它用 `Marshal::GetActiveObject` 附加到正在运行的应用，而不是启动一个，因为配方书中的 Windows 操作都是针对活动实例编写的——`ActiveDocument`、`Selection`、`Presentations`——同时也因为 PowerPoint 拒绝隐藏运行，而用 `New-Object` 启动就必须先满足这一点。值以 PowerShell 单引号字面量嵌入，这是唯一不做插值的形式。包装层会通过宿主自身的成员把文档保存到调用方给出的 `path`，除非该操作本身就是保存或导出，从而让配方的 `fileExists` 预期能够通过；未知操作、未知应用与缺失参数都会在任何程序运行之前被按名称拒绝，非零退出则原样报告 PowerShell 自己的消息。

`@aeven/computer-use-windows-provider` 把适配器、配方书、执行器、会话与 COM 处理器组装成一行，通过接缝占用独占提供程序位，并以 `platform: 'win32'` 注册 `computer_use_run`。它发布 `ctx.windowsComputerUseProvider` 而不是 `ctx.computerUseProvider`，因为 Cordis 通过扩展 `Context` 来声明服务，而同一个属性无法在同一个程序中承载两种提供程序类型；让一台主机只保留一个提供程序的是接缝的槽位，而不是属性名。

`@aeven/computer-use-windows` 从包根重新导出 `WinCommandResult` 与 `WinCommandRunner`——macOS 适配器包早已这样导出自己的运行器——因为提供程序需要提供一个。

## Consequences

Windows 主机现在加载该能力后有两条驱动途径：驱动自身的 MCP 工具（位于 `mcp__cua-driver-mcp__*`），以及通过 `computer_use_run` 的语义批次。macOS 除驱动路径表达式改为走同一个按平台选择的写法外没有变化。

COM 路径是**已记录、未验证**。配方书把这些配方标记为 `documented`，而这里没有任何测试在 Windows 上驱动过真实的 Excel、Word 或 PowerPoint；处理器的测试针对记录型运行器断言生成的程序与分发行为，包 README 则写明装有 Office 的 Windows 主机仍需确认什么。批量工具自身的覆盖同样只是部分的：macOS 提供程序那一行形态相同，其工具的覆盖方式也一样。

在 Windows 上安装驱动并不等于装好：它的 GUI 工具需要已登录的交互式会话，这正是安装器 `-AutoStart` 计划任务所提供的；而该要求在 macOS 上的对应物就是由 app bundle 持有的 TCC 授权。

## Alternatives considered

### 在 Windows 上挂载 macOS 提供程序，让 Apple Events 路径自行拒绝

已否决。Apple Events 处理器说的是 `osascript`，Windows 上并不存在，因此每个语义任务都会因为一个指向错误平台的原因失败。

### 启动 Office 应用而不是附加到它

已否决。配方书中的操作指向 `ActiveDocument`、`Selection` 与 `Presentations`，它们只存在于正在运行的实例上；而 PowerPoint 拒绝 `Visible = $false`，因此被启动的实例还必须显示出来——这与代理安静地驱动桌面的目标正好相反。

### 让 Windows 的驱动命令通过 `PATH` 解析

已否决。提供程序把不存在的绝对路径视为“未安装”，此时只注册安装指引工具；而 `PATH` 命令不会被预先检查，因此驱动缺失会在 spawn 处失败并拖垮整棵树。

### 把 macOS 提供程序的上下文属性改名为共用名

已否决。这会破坏 `ctx.computerUseProvider` 的每个使用方以及每一处提及它的文档，只为换取接缝并不需要的对称性：注册槽位已经保证一台主机只有一个提供程序。
