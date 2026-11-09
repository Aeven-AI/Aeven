# Agent Note：计算机操作遵循驱动自身的指引

Status: implemented

[English](2026-11-09-computer-use-follows-the-driver.md) | 中文

## 问题

计算机操作在 macOS、Windows 和 Linux 上都通过 Cua Driver 运行，但模型一次只执行一个动作。MCP 客户端丢弃了驱动连接时发送的使用说明，因此模型从未学到驱动的窄范围读取、`run_steps` 批处理、差异重读和检查点验证；人设反而让它在每个动作前后都查看屏幕。驱动全部 60 个工具（约 5.5 万 token 的 schema）都可调用，包括 `kill_app`、`set_config` 和轨迹回放。驱动默认上报使用遥测。发布的 macOS 应用以 `--direct` 运行驱动，而该模式拒绝绘制代理光标。没有任何机制阻止前台操作在用户打字时抢占屏幕。

## 决定

MCP 客户端保留每个服务器 `initialize` 结果中的 `instructions`，并通过 `mcp/servers` 报告；代理启动或压缩后，`tool_search` 把它们附加到第一次加载该服务器工具的 `select:` 结果中，使其作为工具结果进入会话日志。aeven 预设中的 `computer-use` 技能承载操作循环、平台说明、需先确认的步骤，以及聊天应用、电子表格、文档和媒体播放器的说明；人设只保留一行指向它。

提供者默认只放行一组驱动工具；除非开启 `telemetry`，否则设置 `DO_NOT_TRACK=1`；早于 `minimumVersion` 的驱动不会启动并给出更新指引；把 `windowChangeTimeoutMs` 和 `keyGapMs` 传给驱动运行时；并在 Linux 和 Windows 上由 `computer_use_setup` 报告 `cua-driver doctor --json` 中未通过的探测项。桌面运行时固定使用 Cua Driver 0.45.2。

在 macOS 上，`embedded` 驱动现在以 `serve --embedded` 守护进程运行：提供者把它作为自己的子进程在私有套接字上启动，MCP 子进程通过 `mcp --socket` 连接。这推翻了[嵌入式驱动笔记](2026-10-16-desktop-ships-an-embedded-cua-driver.zh.md)中被否决的备选方案：守护进程会绘制代理光标，而权限检查仍归属于 Aeven。Windows 和 Linux 保留 `--direct`，光标在那里已能绘制。

用户在 `holdForegroundWhileActiveMs` 内使用过鼠标或键盘时，前台驱动调用会等待，最长 `foregroundWaitMs`，只有用户一直在操作时才拒绝。后台按键会重置 macOS 的空闲计时器，因此任何驱动调用期间或之前的输入都算作驱动自身的输入。未使用的 `computer-use-linux` 适配器已移除；Linux 上的计算机操作只使用 Cua 提供者。

## 考虑过的替代方案

**带停止按钮的活动栏和按应用的批准提示。** 轮次自带的停止按钮已能取消驱动调用，用户也要求不增加界面；驱动自己的光标会显示模型的操作位置。

**为 Electron 应用提供调试端口路径。** 在 Postman 上，通过辅助功能的后台 `type_text` 被拒绝，而调试端口的 `Input.insertText` 能在不改变前台应用的情况下输入。它需要重启用户的应用，并依赖 `agent-browser`（约 121 MB）或自有客户端，因此等到真实任务失败时再做；技能让 Electron 文本走 `set_value`，并检查应用是否有反应。

**用 `agent-desktop` 替换 Cua Driver。** 在三个平台上实测，Cua 借助批处理和差异重读，每个任务少用 5 到 15 倍的 token，并且是唯一能在 Windows 上向后台窗口输入的驱动；`agent-desktop` 没有后台像素输入。

## 影响

服务器的第一次 `select:` 会按其说明长度计费一次，压缩后再计费一次。驱动新版本可能改变工具名称；放行列表中不存在的名称会被忽略，新工具需要加入放行列表。在 GNOME Wayland 上，第一次前台操作会弹出门户对话框，用户只需应答一次；无人应答时会在 12 秒后以 `foreground_timeout` 结束。Windows Office COM 配方仍未在真实主机上验证。
