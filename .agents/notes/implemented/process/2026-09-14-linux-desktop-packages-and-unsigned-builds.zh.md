# Agent Note: Linux desktop packages and unsigned builds

Status: implemented

[English](2026-09-14-linux-desktop-packages-and-unsigned-builds.md) | 中文

## Problem

桌面发布打包支持三个构建目标，并且对每个目标都要求完整的签名身份。有两项彼此独立的需求无法满足。

没有 Apple Developer ID 或 Windows EV Token 的贡献者根本无法产出可运行的产物。每个 macOS 包都要求证书限定名、Team ID 和一套完整的公证凭据；每个 Windows 包都要求 SignTool、EV Token 及其 PIN。两条路径都没有受支持的方式来构建开发者可以启动的东西，因此评审已打包应用就意味着必须持有发布凭据。

Linux 没有发布目标。[打包并更新 Electron 桌面应用](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)为初始发布记录了这一决策，固定构建目标列表、自动更新目录映射、上传计划以及 electron-builder 配置都固化了它。Linux 也无法沿用其他平台的签名方案，因为 electron-builder 打包 AppImage 与 deb 产物并不需要代码签名身份，而更新频道是一项 Electron updater 功能，在 Linux 上没有消费方。

有两个缺陷各自独立地使任何打包命令都无法完成。Landlock 打包步骤读取 `native/system`，而该目录在本代码树中已不存在；工作区已经迁移到 `native/landlock-run`。Desktop Host 覆盖层没有禁用 `workspace-files` 配置项，而它的文件 URL 是 webserver 上的一条 HTTP 路由，而 Desktop 组合禁用了该 webserver。

## Decision

受支持的构建目标集合为 `mac-arm64`、`mac-x64`、`win-arm64`、`win-x64`、`linux-arm64` 与 `linux-x64`；[Windows arm64 桌面构建目标](2026-09-14-windows-arm64-desktop-target.zh.md)记录了 Windows arm64 的新增，[Desktop 恢复 Intel Mac 构建目标](2026-10-15-desktop-restores-intel-mac-target.zh.md)记录了 `mac-x64` 的回归。每个目标都保留固定的平台与架构选择器，运行时准备、seed 准备与 electron-builder 必须就它们达成一致。

Linux 打包不进行代码签名，并且直接分发而非通过更新频道。架构匹配的 Linux 主机可以构建它，任何 Docker 主机都可以通过容器命令构建它，发布自动化则在 Ubuntu runner 上构建两个 Linux 目标。`upload:*` 命令拒绝两个 Linux 目标，且 `DesktopUploadTargetName` 在类型层面将它们排除在上传计划之外。

macOS 与 Windows 可通过 `--unsigned` 标志以及对应的 `package:*:unsigned` 脚本进行未签名构建。它会跳过 seed 签名、应用与安装器签名、macOS 公证、DMG 产物钩子，以及上传所要求的完成记录。已签名打包保持不变，并且仍是唯一可以发布的路径。

Landlock 打包步骤读取 `native/landlock-run`，且 Desktop Host 覆盖层禁用了 `workspace-files`。

## Linux targets

electron-builder 为 `--linux` 产出 AppImage 与 deb，两种架构都映射到它已有的 `--arm64` 与 `--x64` 选择器上。Linux 配置将可执行文件命名为 `aeven`，声明 `Aeven <hello@aeven.io>` 为 deb 维护者，并使用自身的 synopsis 与 description 写入启动器 `Comment` 与 deb 描述，而不是使用面向维护者的包清单 `description`。

`resources/linux/icons` 为 16 至 512 px 的每个图标主题尺寸各存放一个 PNG，每个都由 `resources/icon-macos.svg` 渲染而来，而不是从单个位图缩放。`package.json` 中的 `desktopName` 配合 `linux.syncDesktopName`，让安装的 `.desktop` 文件取得 Electron 作为窗口 `app_id` 与 `WM_CLASS` 报告的名称，因此 dock 或任务栏能把运行中的窗口与带有图标的条目关联起来。两个目标都使用静态 AppImage runtime（`toolsets.appimage`）；当发行版不再提供 electron-builder 26 默认 runtime 所加载的系统 `libfuse2` 时，它仍能启动。

deb 声明它所需的 Electron 运行时库（包含用于麦克风听写的 ALSA），并为 Debian 13 与 Ubuntu 24.04 因 64 位 time_t 而改名的每个库给出 `t64` 或旧名的可选依赖，使该包在更旧的发行版上同样可以安装。

deb 之所以存在，是因为 Chromium 的 setuid 沙箱辅助程序正是让限制非特权用户命名空间的发行版能够启动 AppImage 的东西。处于该状态的发行版可以改为安装 deb。

`desktopTargetBuildPaths` 与自动更新目标映射都接受这两个 Linux 名称，因此 Linux 目标与其他目标完全一样，在自己的 `.desktop-build/targets/<target>/` 目录下拥有已准备的运行时、包集合、seed、pnpm 状态与产物。自动更新目标映射之所以识别 Linux，是为了让构建路径解析接受它；没有任何 Linux 产物拥有更新频道。

`resolveDesktopPackageTarget` 要求架构相同的 Linux 主机。架构与主机不一致的目标会被拒绝，并给出指明 Docker 命令的消息，因为 seed 与内置 Node.js 运行时都是架构相关的。

## The Linux container build

`package-linux-container.ts` 在不削弱该要求的前提下消除了架构匹配主机的限制。它为目标架构构建 `linux-builder.Dockerfile`，将 git 会提交的文件连同 `.git` 以 tar 流的形式送入容器，在那里以一次全新的 `pnpm install --frozen-lockfile` 之后运行相同的 `package:<target>` 脚本，并将顶层产物复制回主机的目标产物目录。

镜像只携带工具：用于 deb 打包的 Ruby 与 `fpm` gem，并设置 `USE_SYSTEM_FPM=true`，以及根清单声明的 pnpm 版本。仓库本身在运行时才进入容器，因此镜像不包含任何仓库内容，源码变更时也无需重建。electron-builder 内置的 fpm 仅支持 x64，这正是 deb 打包在两种架构上都安装系统 fpm 的原因。

`DESKTOP_PACKAGING_ENV_NAMES` 列出容器刻意转发的三项输入：`AVN_DESKTOP_APP_ID`、`AVN_DESKTOP_AUTO_UPDATE_ENV` 与 `DOWNLOAD_TEST_ORIGIN`。容器接收的内容与主机打包路径接收的内容之间唯一区别是来源，因为两者都通过[共享打包环境加载器](2026-09-14-desktop-packaging-reads-the-repository-env-file.zh.md)从仓库根目录的 `.env` 填充这些名称。store 位于 `avn-desktop-linux-pnpm-store` 卷中，因此重复构建会复用已下载的包，而不会共享主机的 store。`--platform linux/arm64` 与 `linux/amd64` 选择容器架构，架构与 Docker 主机不一致的目标在模拟下运行。

`trap` 会在容器退出前复制 electron-builder 已经完成的产物，因此同一轮运行中后续目标失败时已完成的产物仍可保留。`COPYFILE_DISABLE` 环境变量与 `--no-xattrs` 可防止 macOS 主机的 tar 添加 Linux 会拒绝的 AppleDouble 条目与扩展属性头。

## Unsigned builds

唯一输入是 `AVN_DESKTOP_UNSIGNED=1`。`parseDesktopPackageInvocation` 接受 `--unsigned`，打包脚本会从目标环境中删除任何继承来的值并设置自己的值，而 `createElectronBuilderConfig` 只读取它一次，据此推导各项签名决策。

对于 macOS，配置将 `forceCodeSigning`、`hardenedRuntime` 以及 DMG 的 `sign` 标志设为 false，并将 `identity` 设为 `-`。在那里临时签名并非可选：Apple Silicon 拒绝启动完全不带签名的代码，而 hardened runtime 会拒绝 seed 中未签名的原生插件。after-sign 与产物钩子提前返回，因此不会解析发布身份或公证凭据；`notarize` 选项与签名发布一样保持 false。对于 Windows，配置清除 `forceCodeSigning` 且不安装 token 签名器，因此签名 CMD 从不运行。

seed 准备在同一个变量下跳过它的 Mach-O 签名流程。未签名构建不写入完成记录，这正是让 `upload:*` 拒绝它、而不是发布一个没有任何身份背书的产物的原因。

未签名产物用于本地验证。Gatekeeper 会阻止下载得到的 macOS 副本，直到测试者移除其隔离属性，而 Windows SmartScreen 会在未签名安装器运行前发出警告。

发布 workflow 在已签名目标之外额外带有一个始终未签名的 `mac-arm64` job。它只发布该构建的 DMG，绝不发布其更新元数据（那会替换已签名构建的元数据），因此在公证尚未完成时也有 DMG 可供下载。两个变体写入同一个目标目录，因此未签名构建的 `-unsigned` 产物名是把两者区分开的东西。

## Alternatives considered

**要求凭据，并改为记录自签名证书。** 自签名身份仍然需要钥匙串条目、Team ID 以及在评审机器上的信任决策，而且它无法解释为什么 macOS 应用需要临时签名才能启动。`--unsigned` 标志陈述的是真实能力，即打包完全不需要任何身份。

**仅在主机上构建 Linux。** 要求具备 Desktop 工具链且架构匹配的 Linux 主机会把开发桌面应用的 macOS 与 Windows 工作站排除在外，贡献者将不得不手工复现 Ruby、fpm、Node.js 与 pnpm。容器路径改为复用同一个镜像与同一份转发列表。

**在 macOS 上用 electron-builder 交叉打包 Linux。** electron-builder 无法产出 Linux seed。seed 准备会运行目标 Node.js 与内置 pnpm，以便按平台与 CPU 过滤的可选依赖正确解析，而这在没有 Linux 运行时的 macOS 主机上无法为 Linux 目标做到。

**将 Linux 加入更新频道。** electron-updater 在本应用中没有任何 Linux 消费方，而把 AppImage 或 deb 发布到更新频道会宣传一条任何已安装的 Linux 产物都无法读取的更新路径。Linux 包改为直接分发。

**把 `--unsigned` 扩展为完整的发布模式。** 产出上传所接受的未签名产物，会让没有发布身份的构建到达用户。不写入完成记录，使签名要求附着于发布而非打包。

## Consequences

开发者现在无需持有发布凭据就可以在任何平台上构建并启动已打包的应用，此前需要发布身份的打包路径也可以本地评审了。

Linux 获得了发布目标，这意味着[打包笔记](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)中的平台表、两份 Desktop README，以及代码与测试中的目标列表必须同步变更。现在新增一个目标会同时触及构建路径映射、自动更新映射、目标表、上传目标类型以及包脚本清单。发布自动化在 runner 上构建 Linux，而不是通过容器，并为此在 runner 上安装 Ruby、fpm、fakeroot 与 CMake，因此容器命令仍是缺少 Linux 打包工具链的主机的本地路径。

未签名模式是开发路径，而非发布路径。它被刻意排除在 `upload:*` 之外，也从不携带更新元数据，未签名的 macOS 产物对任何接收者都会被 Gatekeeper 隔离。发布 workflow 的未签名 macOS DMG 是唯一被发布的未签名产物：在公证尚未完成时作为可直接下载的过渡方案，由已签名构建的 DMG 取代，而不作为更新来宣传。

Docker 路径会构建一个仓库 tar 流外加一个 store 卷；首次构建需要付出镜像与一次完整依赖安装的代价，跨架构构建还要在此基础上付出模拟的代价。

两个缺陷在同一次变更中被修复，因为二者都需要一条可用的打包命令才能验证：陈旧的 Landlock 打包目录，以及 Desktop Host 覆盖层中仍启用的 `workspace-files` 路由。

## Testing

`apps/desktop/tests/package-target.spec.ts` 覆盖 Linux 选择器、架构匹配主机要求、Docker 命令拒绝消息以及 `--unsigned` 解析。`apps/desktop/tests/linux-package-config.spec.ts` 覆盖 Linux 打包配置：AppImage 与 deb 目标、图标主题集合、桌面名称关联、静态 AppImage runtime、deb 依赖以及维护者与启动器文案。`apps/desktop/tests/desktop-build-paths.spec.ts` 与 `apps/desktop/tests/desktop-auto-update-environment.spec.ts` 覆盖 Linux 目标解析，并通过针对受支持集合之外平台的断言保留对不支持目标的拒绝。`apps/desktop/tests/macos-signature.spec.ts` 覆盖未签名 macOS 配置，包括临时签名身份与不再生效的产物钩子，以及不带 EV token 签名器的未签名 Windows 配置。`apps/desktop/tests/desktop-upload-plan.spec.ts` 覆盖针对收窄后上传目标类型的上传计划。
