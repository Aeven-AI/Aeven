# Agent Note: Desktop 更新的布局与健康检查速度

Status: implemented

[English](2026-11-06-desktop-update-layout-and-health-check-speed.md) | 中文

## 问题

把已安装的 Windows arm64 Desktop 更新到 0.3.35-alpha 时，从应用启动到 Host 开始服务约需 2 分 17 秒。根据 `~/.aeven` 下的文件时间戳，耗时分布如下：

| 阶段 | 耗时 |
| --- | --- |
| seed 哈希、分片解包（1,567 个新文件，64 MB）与存储合并 | 约 26 秒 |
| Windows [预计算 profile 布局](2026-10-29-windows-precomputed-profile-layout.zh.md) | 60 秒 |
| staged 健康检查 Host 的启动与停止 | 约 36 秒 |
| 服务 Host 启动 | 15 秒 |

一个包含 22,914 个文件的布局会复用解包时留在原处的 20,131 个存储对象（574 MB）。`installSeedProfileLayout` 以固定的 64 个为一批，在硬链接每个复用对象之前才读取它并做 SHA-512 校验。用内置 Node.js 针对已安装的 seed 与存储计时，这种顺序耗时 56.2 秒，而单独对全部对象计算哈希只需 5.0 秒，单独链接全部文件只需 16.1 秒。

staged 健康检查 Host 带着 `NODE_COMPILE_CACHE` 运行。Node.js 按模块路径为缓存代码建键，而每个 staging profile 的路径都是新的，因此该 Host 会编译全部模块，并在退出时写入约 2,076 个之后任何启动都不会读取的条目（16 MB）。在空主目录上，缓存为冷的 Host 停止需要 7.3-8.4 秒，不带缓存的 Host 只需 2.1-2.7 秒，启动耗时相同。已安装的主目录里有 6,310 个 Node.js 24 缓存条目，相当于三次运行的量。

`verifySeedIntegrity` 每次读取一个完整的 seed 文件并一次性计算哈希，逐个文件进行；对一个 40 MB 分片计算哈希会让 Electron 主线程停顿最长 1.2 秒。

## 决策

- `installSeedProfileLayout` 先校验每个复用的存储对象，再链接全部文件，因此校验失败时不会链接任何文件。这两步以及目录创建都经过一个 64 路的调用池，一个调用结束就开始下一个条目；失败之后不再开始新条目，所有已开始的调用都结束后才抛出第一个失败。
- shell 启动 staged 健康检查 Host 时不设置 `NODE_COMPILE_CACHE`。服务 Host 保留该缓存。
- `verifySeedIntegrity` 同时以 1 MiB 分块把四个文件流式送入各自的 SHA-256 哈希。

## 考虑过的替代方案

**按路径与大小信任复用的存储对象。** Windows profile 不运行 pnpm 安装，布局的摘要校验是它唯一的内容校验；去掉它会让损坏的存储对象进入 profile。

**通过从已激活 profile 启动服务 Host 来验证更新。** 这样可以省去 staged 启动，但撤销失败的激活需要把 profile 重命名回去，而在 Windows 上，失败 Host 的子进程可能占用该目录（[切换锁](2026-10-27-desktop-windows-profile-swap-locks.zh.md)）。

**在 Host 启动后再删除上一个回滚 profile。** `activate` 仍会同步删除它：一个 23,000 个文件的目录树约需 3-4 秒，期间没有 Host 提供服务。推迟删除需要一次与包事务锁协调的 staging 清理。

## 影响

针对已安装的 0.3.35-alpha seed 与存储，更新布局耗时从 56.2 秒降到 12.5-13.9 秒，首次安装布局从 16.1 秒降到 8.7 秒，seed 验证从 3.7 秒降到 2.3-3.1 秒，且每次占用主线程最多约 30 毫秒。一次更新在停止健康检查 Host 上约少花 6 秒，也不再向编译缓存添加任何内容。服务 Host 在拥有大量会话的主目录上的启动耗时不变。

`apps/desktop/tests/seed-profile.spec.ts` 证明损坏的复用对象会在任何链接之前让布局失败。上述耗时来自用内置 Node.js 针对已安装应用的 seed 与存储运行所发布函数的脚本；尚未有已安装构建带着这一改动完成完整更新。
