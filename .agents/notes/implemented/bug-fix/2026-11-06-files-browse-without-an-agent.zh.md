# Agent Note: 文件浏览无需启动会话的 Agent

Status: implemented

[English](2026-11-06-files-browse-without-an-agent.md) | 中文

## Problem

账户同步在每台设备上把空闲的对话保存为副本，并在回合开始时重新认领。文件浏览器的 `workspaceFiles` Remote 接收 `Agent` 参数，因此每次列目录、预览和搜索都会先恢复会话的 Agent。恢复副本会被拒绝（`SessionPersistenceReadOnlyError`），于是在桌面端和托管 Host 上，文件浏览器对每个空闲的同步对话都显示“replicated from another device; fork it to continue”。

## Decision

`list`、`read` 和 `search` 改为接收会话 id。本机有活动 Agent 的会话仍通过 `sessionWorkspaceRoot` 解析根目录。其他会话通过 `sessionQuery` 观察；当前调用者不拥有该会话时按不存在拒绝；根目录由 `WorkingDirectoryService.observed(header, projection)` 解析。该方法与 `local(session)` 共用同一放置逻辑：记录的 `workingDirectory` 投影、本设备的工作区绑定，以及在没有文件夹的 Host 上由其管理的账户文件夹。线上格式不变，因为 `agent` 查找本来就传递会话 id。

## Alternatives considered

**打开文件浏览器时认领会话：** 浏览会转移会话的运行设备，并且在另一台设备运行回合时失败。

**在 Remote 中重复技能目录的冷路径解析：** 那份副本不包含托管账户文件夹，托管副本会列出错误的根目录；在所属服务中保留一个逻辑，可使活动与观察两条路径的结果一致。

## Consequences

浏览器读取副本时不写入副本，也不启动工作。技能目录仍保留自己的放置规则冷路径副本，可另行改用 `observed`。`sidebar_files` 模型工具仍在活动 Agent 中运行，保持不变。
