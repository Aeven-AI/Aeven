# Agent Note：启动失败时提供更新，访问控制插件保持必需

Status: implemented

[English](2026-11-25-failed-start-offers-update-and-access-control-stays-required.md) | 中文

## Problem

桌面端 shell 只在宿主报告就绪之后才安排发行流检查，而更新界面是宿主提供的页面。因此宿主无法启动的构建从不检查新版本，也无从提供新版本：2026-11-25，拒绝已存储连接器的已安装 0.3.66 构建只能靠手动下载修复。

`bootTolerant()` 会停用任何失败的条目，调用方在 `essential` 中列出的 id 除外。桌面端的列表只列出了提供 shell 所不可缺少的条目。有些条目是限制插件树而不是为它增加功能，缺少它们时插件树放行得更多：`access-policy` 只负责拒绝绕过文件系统沙箱的工具，而 API 控制器以 `?.mayAccess(...) ?? true` 读取 `identityUsers`，因此缺少身份服务时会放行每个请求。

## Decision

启动失败窗口创建自己的 `DesktopUpdateCoordinator` 并运行 `updateAfterFailedStart()`：检查一次，把状态显示在窗口的状态行上，并用一个原生对话框询问一次是否重新启动到已下载的版本。在 macOS 上，该流程让 Squirrel 暂存应用包；该版本的 profile 由它的首次启动安装。协调器的 `beforeRestart` 移除窗口的“关闭即退出”监听器，使安装器自己的关闭动作不会先让进程退出。

`app-boot` 导出 `ACCESS_CONTROL_ENTRIES`（`access-policy`、`identity-user`、`identity-user-aeven`），`bootTolerant()` 在 `essential` 之外对所有调用方都把它们视为致命。列表的规则：缺少某条目会让插件树做得更多时，它属于列表；缺少它只是去掉一项能力时，它不属于。沙箱、沙箱策略和审批条目不在列表中，因为 shell 和文件工具等待沙箱服务，而缺少审批服务会把 `ask` 变成拒绝。一个 bundle 测试断言列表中的每个 id 都是 base 或 web-app bundle 的一行。

## Alternatives considered

**在宿主启动之前开始周期性检查。** 更新界面仍然是宿主的页面，而且在启动安装 profile 期间安装器不得退出 shell；失败窗口是这两点都不适用的唯一状态。

**停用缺席策略所守护的工具。** 每个策略都需要一张它守护对象的映射，缺少映射的新守护会被静默跳过；拒绝启动是一条规则，而上面的更新提供覆盖了卡住的构建。

**在 `cordis.yml` 中标记必需条目。** 除 `config` 和 `disabled` 之外的 Loader 条目元数据保持字面量，因此在那里加标记需要修改 vendored 代码中的 Loader。

## Consequences

无法启动的构建无需手动下载即可到达下一个版本，前提是它启用了更新器（已打包、不是 Microsoft Store 安装、在 macOS 上已签名）。访问控制条目的失败会像容错启动之前那样使桌面应用停止。缺席会放宽访问的新插件必须加入 `ACCESS_CONTROL_ENTRIES`；没有任何机制自动检测这一点。
