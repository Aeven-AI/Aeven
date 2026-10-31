# Agent Note: 原生目录选择器在调用方指定的文件夹处打开

Status: implemented

[English](2026-10-30-directory-picker-start-folder.md) | 中文

## 问题

`ctx.directoryPicker` 的原生能力是 `pick(signal)`：一次选择器请求不携带起始目录。macOS 与 Windows 对此的回答是各自对话框上次使用的文件夹，于是 Web GUI 的 **Link workspace** 操作把第二个 Workspace 的选择器打开在第一个 Workspace 的文件夹处，操作者看到的是上一次的选择，而不是正在关联的那个 Workspace。浏览后端出于同样的原因从宿主主目录开始：seam 中没有任何东西能说明该从哪里开始。

## 决策

起始目录由 seam 承载，由知道它的调用方提供。

- `DirectoryPickerPickOptions.directory` 加入原生 `pick(signal, options?)`。省略时由平台按原有方式决定。 - 选取用的 Remote（`workspace-controller` 的 `directoryPicker/pick`）把目录作为第一个参数，并由 `uiWorkspace.pickDirectory(directory?)` 镜像。 - 当该行本身是文件夹 Workspace 时，Workspace 浏览器传入该行自己的 `path`；Workspace 尚无目录时不传。 - 各后端按平台原生方式映射：macOS 上是一条 `default location (POSIX file …)` 的 AppleScript，Zenity 用 `--filename`，KDialog 用目录参数，Win32 worker 用 `SHCreateItemFromParsingName` + `IFileDialog::SetFolder`。 - 已不存在的目录保留平台默认值，而不是让选取失败：文件夹只是一个提示，陈旧的记录不该让操作者失去选择器。

## 曾考虑的替代方案

- **在客户端记住上次的选择并在那里重新打开**：对每个从未关联过的 Workspace 都会重现该问题，而且这份记忆按浏览器保存，而不是按设备保存。 - **只在浏览界面里应用预选**：应用内浏览器可以从任意位置开始，但报告问题的操作者用的是原生选择器，默认文件夹仍会是上一个 Workspace 的。 - **从当前会话的 workspace 开始**：对某一行是对的，对正在关联的那一行是错的，而且它掩盖了错误，而不是修正错误。

## 后果

`pick()` 现在接受一个选项对象，因此后续的打开提示可以扩展同一个对象，无需再次改动签名。浏览流程仍从宿主主目录开始；把同样的起始文件夹交给应用内浏览器，是 `ui-directory-picker-browse` 里的另一项工作。
