# Agent Note：Pages 和 Keynote 转换无需询问即可运行

Status: implemented

[English](2026-11-16-pre-approved-conversion.md) | 中文

## 问题

在桌面端制作的每份简历或演示文稿都会在生成 Pages 或 Keynote 文件时停在一个沙箱批准上，从手机驱动的对话会一直等到有人回答。转换必须在工作区沙箱之外运行：即使在 `(allow default)` 且字体文件夹可写的情况下，macOS 也会拒绝 `sandbox-exec` 下的进程发送 Apple Events；在桌面端配置下运行简历导出器证实了这一点（`sending Apple Events to Pages was refused`）。另外，托管的 Aeven Web 在获得预设的技能后列出了 `computer-use` 技能，尽管它没有组合任何计算机操作工具。

## 决策

`avn-tool-bash` 新增 `escalationSkillScripts`：当整个命令恰好是 `[cd <dir> && ] node <script> <arg> <arg> <final>`，每个记号为普通或双引号字符串且不含 `$`、反引号或反斜杠，脚本（经 `realpath`）解析为来源是 `custom` 或 `bundled` 的技能资源目录中配置的文件，且最后一个参数在允许范围内时，所请求的权限提升无需询问即可运行。`approveEscalation` 的模式检查照常执行，只是由系统代为回答问题。`avn-web-app` 列出了带 `pages` 的简历导出器和带 `key` 的演示文稿导出器，两个技能都要求模型原样运行导出器打印的命令。其他任何权限提升仍像以前一样询问。

`avn-skill-filesystem` 新增 `excludeSkills`，即它从不列出或加载的技能名称；`avn-hosted-app` 排除了 `computer-use`。

## 考虑过的替代方案

**放宽桌面端沙箱。** 为每个受限命令允许 Apple Events 或字体文件夹，会让任何命令都能操控任何应用。

**按批准请求中的原因文字匹配。** 原因中是模型给出的理由而不是命令，模型可以把它重复用于任何权限提升。

## 影响

名为 `cv` 或 `slides` 的项目或用户技能（命令可以把它写进工作区）永远不符合条件，因为它的来源不是 `custom` 或 `bundled`。模型对命令的任何改动，例如加上 `sleep` 或改变参数个数，都会再次询问。预先批准的运行不记录批准事件；工具调用在日志中保留其 `sandbox_permissions` 和理由。

## 验证

用真实的技能文件夹检查匹配器：它接受了简历和演示文稿的转换命令（带或不带 `cd … &&`），并拒绝了串联命令、`$()` 和反引号、多出的参数、Node 选项、环境变量前缀、换行、仿冒的脚本路径、相对路径以及同名的项目技能。`tool-bash` 和 `skill-filesystem` 的 `tsc` 通过；`verify-cordis-config` 通过。
