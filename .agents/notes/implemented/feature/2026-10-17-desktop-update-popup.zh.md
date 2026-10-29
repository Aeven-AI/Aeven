# Agent Note: 桌面更新在应用内呈现，且绝不擅自安装

Status: implemented

[English](2026-10-17-desktop-update-popup.md) | 中文

## 问题

两个缺陷落在同一个界面。shell 唯一的更新界面是原生 `dialog.showMessageBox`：没人主动发起的检查以系统弹窗出现，且不携带进度，因此检查、下载与安装看起来完全一样。同时，安装成功后会留下自己的状态——electron-updater 暂存在 `pending/` 下的下载、作为差异下载基线的同一发布（`update.zip`），以及指向已被删除包的 Squirrel `ShipItState.plist`。在刚刚更新到当前版本的机器上，这就是 770 MB 残留，加上一个无人能执行的暂存安装，并会被每次检查重新提供（[issue 137](https://github.com/Aeven-AI/Aeven/issues/137)）。

安装也是隐式的：`autoInstallOnAppQuit` 处于开启状态，退出时会安装读者回答"稍后"的发布——这正是更新被感知为未经通知的重启的原因。

## 决策

应用自己的弹窗是唯一的更新界面，安装由读者回答决定。

- **shell 发布，页面渲染。** preload 恢复了 `AvnDesktopUpdateApi`（`get`、`check`、`install`、`onChange`），并新增 `updatesListen`，由页面声明它显示更新状态。在该订阅存在之前，shell 保留它要发布的状态——以及期间收到的界面请求——因此从不订阅的页面（另一构建的客户端、由别处提供的 Host）不显示任何内容，也不会收到它无法回答的命令。`@aeven/client-ui-update` 把这些状态镜像到 `shell.overlay` 的一个条目上。
- **菜单与下载完成都会打开它。** **检查更新…** 打开弹窗并开始检查；自动检查在下载期间保持静默，并在下载完成后打开弹窗一次。`update-prompt.ts` 仍决定某个状态是否值得显示界面，因此无人发起的失败保持静默。
- **退出时不安装。** 协调器设置 `autoDownload = true`、`autoInstallOnAppQuit = false`。已下载的发布等到 **重启并安装**，该操作停止 avn 子进程并把替换交给 electron-updater；**稍后** 关闭弹窗并把发布留待下次启动。
- **等于或低于当前运行版本的发布不是更新。** `doCheck` 在发布 `available` 之前用 semver 把发布源的版本与 `updater.currentVersion` 比较，因此当前版本的暂存制品绝不会再次被提供。
- **每次启动清理上次安装留下的内容。** `clearUpdateResidue()` 移除暂存下载（只有下载它的会话才能安装它），但比当前运行版本更新的 Windows 安装包除外：它会保留下来，供 electron-updater 在下一次检查的发布源摘要处校验并复用；仅当差异基线与 Squirrel 状态文件所描述的版本正是当前运行的版本时才移除它们；仅当旁边已无暂存包时才移除 `ShipItState.plist`。它在协调器构造之前运行，因此启动后的第一次检查看到的已是干净缓存。

## 考虑过的替代方案

**保留原生弹窗，只增加清理。** 进度缺口仍在：检查、385 MB 下载与安装无法区分，而桌面产品正在使用时出现的系统弹窗，会被感受为来自应用之外的中断。

**保留退出时安装，下载后再询问。** 这正是本条替换的方案："稍后"实际意味着"退出时安装"，读者无法把它与"不要安装"区分开，重启也毫无预告地到来。

**每次启动清空整个更新缓存。** 简单，但每次都删掉差异基线，于是每个发布都完整下载；判断暂存下载的成本很低，且在仍有更新版本暂存时保留基线。

**从 `update-info.json` 读取暂存版本。** 该描述文件只含文件名、哈希与管理权限标志，没有版本；版本在制品名中，而制品名就是更新器自己的模板（`aeven-<version>-<os>-<arch>`）。

## 影响

未作回答就退出会把暂存下载留在磁盘上，直到下次启动清理，并在下次检查时重新下载——Windows 例外：更新的安装包会保留，并在所检查发布源的摘要匹配时被复用。这是绝不擅自安装的代价，且上限是一个发布的大小。

弹窗仅限桌面：浏览器构建没有载体，不注册任何内容。订阅较晚的页面仍会收到 shell 的最新状态与待处理的界面请求，因此菜单在启动最初几秒内即可用。

被中断的替换仍会留下没有包的应用程序目录，直到 ShipIt 自身重试或手动重装；本条不使安装原子化，那仍是 Squirrel.Mac 的行为（[打包与更新](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)）。

## 验证

`apps/desktop/tests/update-coordinator.spec.ts` 覆盖后台下载、无需下载的安装、退出不安装、进度状态、运行版本守卫、未启用进程与失败的检查。`apps/desktop/tests/update-prompt.spec.ts` 覆盖哪些状态会打开界面。`apps/desktop/tests/update-residue.spec.ts` 覆盖清理已完成安装的状态、保留更新版本的基线、不可读的描述文件、制品名解析、`app-update.yml` 中的缓存目录、bundle identifier 以及各平台缓存根。`packages/client/ui-update/tests` 覆盖每个弹窗相位、重启与关闭回答、菜单命令、shell 状态以及释放。打包路径本身未实际验证：看到安装需要已发布的更新版本与已安装的构建。

[Issue 138](https://github.com/Aeven-AI/Aeven/issues/138)——自首帧起可拖动窗口——是另一项独立改动。
