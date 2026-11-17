# Agent Note: 桌面启动负载、空闲同步状态流量与退出时 Host 中止

Status: implemented

[English](2026-11-17-desktop-startup-payload-and-quit-crash.md) | 中文

## 问题

0.3.57-alpha 桌面应用的 DevTools 指标显示了三个缺陷。对于有 1,289 个会话的 home，启动时的 `session/list` 响应为 4.3 MB，其中 2.5 MB 是两个投影值：`fileIntake`（上传限制与可接受的扩展名列表）和 `imageLimits`，它们在每一行中完全相同地重复；聊天要等这个响应返回才会绘制。应用空闲时，Host 推送 `sync/status` 的频率高到登录弹窗每两秒重新读取一次状态，而状态本身并未变化。每次退出 Desktop Host，以及从源码运行的 Host，都以 `SIGABRT` 结束并留下 macOS 崩溃报告：MemOS embedding 加载的 onnxruntime-node 绑定在 `exit()` 期间于其环境析构函数中中止（microsoft/onnxruntime#24579）。

## 决策

- **列表行省略与 Session 无关的投影**（`avn-api-session-controller`）：`list()`、`api-session/added` 摘要以及导入会话的摘要会去掉 `imageLimits` 与 `fileIntake`。这两个单元在 `list.ts` 中注册，状态为 null，视图读取 Host 配置，因此每个 Session 都携带相同的值。客户端把列表投影视为部分基线，而打开 Session 的历史快照会携带其完整投影集合，因此没有消费方会丢失值。`turnOutline`、`sessionStats` 与 `todos` 等依赖 Session 的值仍保留在行中，原因见 [DSH 改进说明](../feature/2026-11-17-dsh-improvements.zh.md)。
- **`sync/status` 只在状态变化时触发**（`avn-sync-yjs`）：vault 会报告每一次可能的状态变化，包括在一个 `statusMs` 窗口内排队并被确认的帧。provider 在每次报告时序列化账号状态，仅当它与该账号上次发布的状态不同时才通知监听方。
- **只有 Intel macOS 的 seed 固定 onnxruntime-node 1.23.2**（`apps/desktop`）：`desktopDependencyOverrides(target)` 只为 darwin-x64 profile 替换为 1.23.2，即最新一个提供 darwin/x64 绑定的版本。其他所有目标安装 Transformers.js 固定的版本（1.24.3），它包含退出修复（microsoft/onnxruntime#26445），并提供 darwin-arm64、Linux 与 Windows 二进制文件；其 darwin-arm64 构建要求 macOS 14，即应用现有的最低版本。seed 准备过程传入发布目标，已安装的 Desktop 按自身平台验证其 profile。seed 存储裁剪器为每个版本保留一条规则，每条规则只在安装该版本的目标上生效。

## 考虑过的替代方案

**每个客户端缓存只在启动时读取一次。** 设置、模型目录、插件清单、凭据与子代理读取在启动时各执行两次：插件挂载时一次，首次 `connection/reset` 时一次。第二次读取覆盖了在第一次读取与事件 socket 订阅之间发生的变化，而这六次读取在 loopback 上合计只花几毫秒，也不会推迟首次绘制。若让每个提前读取都等待连接建立，每个插件的首批数据都会排在 socket 握手之后。未采用。

**在 Desktop webserver 上启用 gzip。** webserver 支持 `compression: 'gzip'`，gzip 能把会话列表缩小约二十倍，代价约 2 ms CPU。在 loopback 上它节省的传输本来就只有几毫秒；列表的 200–280 ms 花在构建与序列化响应上。直接服务远程浏览器的部署可以在配置中启用它。未改动。

**升级根 workspace 的 onnxruntime-node。** 仓库锁文件由所有开发机器共享，其中包括构建 Intel 桌面版的 `macos-15-intel` runner，而 pnpm 无法按架构选择版本。根 override 保持 1.23.2，因此从源码运行的 Host 退出时仍会中止。

**在关闭时释放 embedding pipeline。** 中止来自 1.23.2 绑定内部静态对象的析构顺序，而不是打开的会话，因此在 `exit()` 之前释放会话并不能消除它。

## 影响

启动列表去掉了这两个重复值，对实测的 home 约缩小 58%，Host 的序列化工作量也同比减少。从侧边栏打开的 Session 随历史快照而不是随列表获得上传限制；在该快照到达之前，输入框的文件预检不可用，这与列表加载前打开的 Session 原本的情况相同。状态监听方（包括登录弹窗以及在每次状态事件时 attach 的 Host 插件）不再因不改变任何内容的报告而被唤醒。除 Intel macOS 外，所有目标的桌面构建在退出时都不再产生崩溃报告；Intel macOS 构建和从源码运行的 Host 仍会中止，直到 onnxruntime 发布带有该修复的 darwin/x64 绑定。
