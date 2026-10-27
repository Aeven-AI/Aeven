# Agent Note: 桌面配置目录切换期间的 Windows 锁

Status: implemented

[English](2026-10-27-desktop-windows-profile-swap-locks.md) | 中文

## 问题

在 Windows 上，未签名的桌面构建停在启动画面，并由 `DesktopProjectManager.activate` 抛出 `EBUSY: resource busy or locked, rename '…\.aeven\desktop\staging\<id>\profile' -> '…\.aeven\profiles\desktop'`。[配置目录激活](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)只重命名一次目录，而只要有进程持有会阻止重命名的句柄，Windows 就拒绝重命名该目录。

错误码说明了句柄的种类。在 Windows 11 与 Node.js 26 上，当目录内的某个文件以不共享删除的方式打开（扫描程序的打开方式）时，或某个进程以其子目录为工作目录时，重命名该目录失败并返回 `EPERM`；当某个进程以被重命名的目录本身为工作目录时，失败并返回 `EBUSY`。暂存健康检查用的 Host 以暂存配置目录为工作目录运行，它启动的每个进程都继承这一目录；在 Windows 上停止 Host 不会停止它的子孙进程。

切换的错误路径还有两个缺陷。当切换在活动配置目录移入 `rollback/profile` 之前失败时，清理会删除 `profiles/desktop`，而它此时仍是活动配置目录。因同一把锁而失败的清理会抛出自己的错误，取代导致切换停止的那个错误。

## 决策

- 切换、其恢复以及预备配置目录采用中的每一次目录重命名都经过 `renameRetryingWindowsLocks`。在 Windows 上，它对 `EBUSY`、`EPERM` 和 `EACCES` 进行重试，延迟从 50 ms 开始、逐次翻倍、上限 1 s，60 s 后停止；在其他平台上直接抛出第一个错误。`removeOwnedDirectory` 向 `rmSync` 传入 `maxRetries: 10`。由于重试需要等待，`recover()` 和预备配置目录的采用是异步的。
- `DesktopHostProcess` 接收 Host 的工作目录。暂存健康检查用的 Host 从 `~/.aeven/desktop/work`（`DesktopPaths.work`）运行，位于所有配置目录之外。提供服务的 Host 仍以其配置目录为工作目录；没有目录的会话在执行 shell 命令、解析相对路径以及确定沙箱后备根目录时使用它。Desktop Host 把自己的配置目录传给 `loadLayeredEnv`，因此两种情况下项目 `.env` 层都是该配置目录的。
- `activate` 只撤销已经发生的移动：把已激活的配置目录重命名回暂存目录，并把 `rollback/profile` 重命名回 `profiles/desktop`。撤销失败时会记录日志，保留 `pending.json` 供下次启动的 `recover()` 使用，并抛出切换本身的错误。无法删除的残留暂存目录或存储事务目录会被记录并保留。

## 考虑过的替代方案

**只重试重命名，其他不变。** 重试能应对在截止时间内释放句柄的持有者。健康检查 Host 的某个子孙进程若持续运行，会在其整个生命周期内占用暂存配置目录，而报告中的 `EBUSY` 正对应这种持有者，因此仅靠重试会在 60 s 后以同样方式失败。

**让提供服务的 Host 也在配置目录之外运行。** 这会在更新路径上（提供服务的 Host 的配置目录被移入 `rollback/profile`）消除同一种持有者，但会把没有目录的会话的后备目录从已安装的配置目录改为一个空目录。所有者决定保持这些会话不变。因此，提供服务的 Host 遗留的进程仍可能阻止更新；此时切换失败，但不会触动活动配置目录。

**用 `--dir` 在配置目录之外运行 pnpm。** 无论 pnpm 从哪个目录启动，pnpm 11.7.0 都以项目目录作为项目生命周期脚本的工作目录，而且 `runPnpm` 会在切换之前等待 pnpm 退出，因此这一改动消除不了任何持有者。

**删除已激活的配置目录，而不是把它重命名回去。** 删除可能因某个被占用的文件而中途停止，留下一个不完整的配置目录，而 `recover()` 会保留它，因为恢复只在 `profiles/desktop` 不存在时才还原 `rollback/profile`。重命名要么完成，要么让两个完整的目录都保持原位。

## 后果

- Windows 上的首次启动或更新能够挺过在 60 s 内解除的锁，健康检查 Host 的子孙进程也不再占用暂存配置目录。持续更久的持有者仍会使启动失败，现在是在 60 s 之后。
- 在移动之前或之后失败的切换会让活动配置目录保持原位或将其还原，启动画面报告的是导致切换停止的那个错误。
- 在暂存配置目录内持续运行的安装脚本进程，或提供服务的 Host 在活动配置目录内遗留的进程，仍可能阻止切换。
- 报告中那次失败的持有者没有在报告者的机器上确认；`EBUSY` 错误码与上述复现使健康检查 Host 的工作目录成为最可能的持有者。
- 无法删除的暂存目录会留在 `~/.aeven/desktop/staging` 下，直到之后的某次清理将其删除。
- `apps/desktop/tests/host-process.spec.ts` 固定了 Host 的工作目录，并在 Windows 上于已停止 Host 启动的进程仍在运行时重命名其配置目录。`apps/desktop/tests/project-manager.spec.ts` 固定了在第一次移动之前失败的切换会保留活动配置目录。重试在测试套件之外针对模拟的文件锁进行过验证；它以及整个改动都尚未在已安装的 Windows 构建中运行。
