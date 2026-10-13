# Aeven 桌面端

[English](README.md) | 中文

桌面应用是共享 avn Web UI 的 Electron 壳。Web 与 Electron 通过内核控制的启动互斥及已认证 HTTP 端点，在每个 Aeven 主目录复用一个 GUI Host。没有现有 Host 时，Electron 使用内置的上游 Node.js 启动 Host；退出 Electron 只分离桌面壳，Host 继续为浏览器客户端与运行中的任务提供服务。显式关闭 Host 或进程死亡会释放所有权。桌面启动的 Host 默认使用回环端口 3080。

被接入的 Host 拥有其后端包依赖图。Desktop 包更新要求该 Host 在验证与激活之前停止；接入运行中的 Host 不会替换其包。第一个启动器决定提供服务的 profile 与能力。两个客户端使用同一份 Session 和工作区状态。

## 关键技术决策

| 决策 | 原因 | 直接结果 |
|---|---|---|
| 发布身份 | 桌面壳 API、Web 客户端、后端与插件依赖图作为一个组合完成验证；独立版本会产生未经验证的组合，并让更新可用性含糊不清。 | Electron 与 `@aeven/cli` 始终使用同一精确版本。即使桌面壳代码不变，升级 avn 也必须发布新 Desktop 版本。 |
| 运行时 | Electron 的 Node.js 带有 Electron 补丁、fuse、ABI 与生命周期约束，而系统运行时和包管理器状态不可控。 | avn 通过内置的上游 Node.js 运行，所有包操作都使用内置 pnpm。Electron 的 Node.js、系统 Node.js、系统 pnpm 与用户的包管理器配置都不进入执行路径。 |
| 包来源 | 必须能在发布到 npm 之前从同一次源码构建打包精确的 avn，并支持离线安装；插件则需要保留为用户选择的普通 npm 包。 | 已签名应用携带本地打包的第一方 avn 包与离线 seed 存储。桌面插件仍是从固定 Desktop 注册表解析的普通 npm 依赖。 |
| Seed 传输 | Apple 公证会检查归档内的代码；把 pnpm 存储的每个文件分别放入应用，还会让应用签名记录数万个缓存条目，而单个压缩归档会放大小幅包变更。 | macOS 打包先签署每个 Mach-O CAS 对象、重写其 pnpm 哈希并再次证明离线安装，再把存储文件分配到 16 个确定性的未压缩 tar 分片。外层安装包负责压缩，差分更新可以复用未变化的分片。 |
| 状态归属 | 共享可执行依赖图会让 CLI（命令行界面）与 Desktop 相互改变 avn、Cordis、插件或原生模块版本，而两个桌面进程还可能争用同一个 profile。 | Electron 在访问任何 profile 前获取进程生命周期单实例锁，并独占 `$AVN_HOME/profiles/desktop` 及其包管理器状态。CLI 与 Desktop 共享 `$AVN_HOME` 下受支持的产品数据，但绝不共享可执行包、插件激活、锁文件或 `node_modules`。 |
| 通信 | 监听 Web 服务会引入端口归属、认证、CORS 与暴露风险；Electron 与上游 Node.js 之间也需要明确的跨进程协议。 | `avn-app://` 承载 Web 资源和 Fetch 流量，并把订阅请求转发到操作系统分配端口的 `127.0.0.1` HTTP 监听器；分帧字节管道以背压传输有界请求与响应分块，Node IPC 只承载子进程生命周期控制。 |
| 激活 | 依赖解析、生命周期脚本、原生模块与插件启动都可能失败，目录替换期间进程也可能中断。 | 发布与插件变更先安装到 staging，并启动完整后端执行健康检查；只有成功后才替换活跃 profile，中断替换由事务日志和一个 rollback profile 恢复。 |
| 更新 | 桌面壳与 avn 独立更新会重新产生版本分裂，而桌面壳未变化的数据块不应强制完整传输。 | Electron 壳、匹配的 avn seed、Node.js 与 pnpm 组成一个已签名更新单元。平台更新产物可以复用未变化的数据块，但运行时版本选择绝不脱离 Desktop 发布。 |

[Electron 打包与更新 Agent Note](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md) 记录了这些决策背后的理由、替代方案、安全约束和发布验证要求。

## 安装归属

Electron 拥有保留 profile `$AVN_HOME/profiles/desktop`。其 manifest（元数据清单）通过 `avn.profile.bundles` 列出内置与已安装插件 bundle，`node_modules` 则同时包含精确版本的 `@aeven/cli`、与之匹配的私有 `@aeven/desktop-host` 和所有桌面插件。把 Electron 专用进程入口与 overlay 放入私有应用包，可以避免 Desktop 实现成为公共 CLI 包的一部分。CLI 不能启动或修改该 profile。Electron 始终调用自身内置的 Node.js 与 pnpm，并把存储固定在 `$AVN_HOME/desktop/pnpm/store`；它绝不使用系统 pnpm 或调用方的 npm/pnpm 配置。

avn 主渲染进程只获得桌面协议标记。独立插件窗口获得结构化的列出、安装、移除、更新和更新检查操作；两个渲染进程都拿不到文件系统、原始 Electron IPC、shell 或任意 pnpm 参数。

链接点击与右键菜单同样分工。窗口自己不打开任何浏览器：内容请求打开的地址会被上报给页面（`external-links.ts`），由页面在侧边栏浏览器、agent 所驱动的 Host Chromium，或系统浏览器中打开；从未订阅的页面仍走操作系统交接。右键菜单在本进程中绘制，但由页面描述（`app-menu.ts`、`context-menu.ts`），因为页面才知道自己的链接与文件名意味着什么：shell 校验这些行，弹出原生菜单，并把读者所选的行回传给页面。侧边栏地址栏与 agent 导航接受 HTTP(S) 和 `file:` URL；本地页面仍使用 guest 的沙箱、上下文隔离，并禁用 Node integration。

Electron 根据应用 locale 选择类型化的英文或中文桌面壳文案，并以英文作为 fallback。菜单、原生对话框与插件管理渲染进程使用同一 locale 数据；仓库的 Client UI i18n gate 会检查这些桌面源文件。

### Seed 安装

安装包内的 seed 是安装工具包，不是可以直接运行的 `node_modules` 目录。生成的 pnpm workspace 与仓库策略一致：明确允许必要的原生依赖构建，并拒绝 onnxruntime-node 的 CUDA provider 下载。它的 `overrides` 移除 Host 从不加载的依赖边，即 Web 前端 `dist` 与插件客户端 bundle 已经包含的浏览器库；Transformers.js 与附件读取器共用同一个 `sharp` 版本。打包过程会生成锁文件，在禁用生命周期脚本的情况下在线物化生产依赖图，从存储中裁剪运行时从不加载的第三方文件，删除 `node_modules` 以及所有临时 pnpm cache、配置和 state 目录，然后只使用最终存储完成一次完整离线安装，并验证私有 Desktop Host 的入口与 overlay 均存在。macOS 构建随后暂存 pnpm 内容寻址存储中的每个 Mach-O 对象，最多并发签署四个独立副本，并且只在所有签名成功后才更新受影响的 SHA-512 索引记录。再一次离线安装会在分片前证明重写后的存储；准备过程随后解包最终归档，并验证每个内嵌签名。签名 seed 保留发布身份、本地第一方 tarball 及其描述文件、项目元数据、锁文件、完整性清单，以及在用户机器上重复该安装所需的 pnpm 存储内容。

| Seed 内容 | 可写目标或用途 |
|---|---|
| `integrity.json` 与 `desktop-packages.json` | 在修改包状态前验证清单记录的每个 seed 文件、本地 tarball 哈希以及绑定的 avn 与 Desktop Host 版本。 |
| `store-archives.json` 与 `store-archives/*.tar` | 验证确定性的未压缩分片，把它们解包到唯一的 Desktop staging 目录，替换匹配的不可变存储文件，并以事务方式把 pnpm 的版本化 SQLite 包索引合并进 `$AVN_HOME/desktop/pnpm/store`，且不移除已经为 Desktop 插件下载的包。 |
| 项目元数据与 `desktop-packages/` | 复制到唯一的 `$AVN_HOME/desktop/staging/<transaction-id>/profile` 项目。 |
| 锁文件与本地包映射 | 驱动内置 pnpm 完成安装，且不会从 npm 解析已打包的核心包名。 |

启动过程把 seed 安装或校准为一个串行事务：

1. 恢复中断的激活事务日志，验证完整 seed 清单与本地包集，并要求 seed 版本等于 Electron 应用版本。
2. 如果活跃 profile 已包含该发布及匹配的 avn 与 Desktop Host 版本，则验证其中的本地包集并直接复用，不重新安装。
3. 否则验证每个归档条目，把全部存储分片解包到 Desktop 拥有的临时 staging 目录，将包文件与 SQLite 包索引记录合并进私有存储，再创建 staging profile，并通过内置 Node.js 与 pnpm 执行 `pnpm install --offline --frozen-lockfile --trust-lockfile`。Seed 记录替换匹配的索引键，插件专属记录继续保留。
4. Electron 升级时，从旧活跃 profile 读取每个插件的名称和精确版本，再通过现有 Desktop pnpm 状态以 `--offline` 把这些版本加入 staging。首次安装不执行插件恢复。
5. 停止活跃后端，启动并停止完整的 staging 后端执行健康检查，再在激活前重新启动活跃后端。这种串行方式避免两个桌面后端共享 `$AVN_HOME`；安装错误或插件不兼容会删除 staging，并保持活跃 profile 不变。
6. 在每次目录移动前先持久化下一个激活阶段，把活跃 profile 移到 `$AVN_HOME/desktop/rollback/profile`，再把 staging 移到 `$AVN_HOME/profiles/desktop`。恢复过程同时检查日志与真实的 profile、rollback 和 staging 目录，因此在写入后、移动前的任一间隙中断后仍会恢复或保留一个完整 profile。

GUI 插件修改会在把注册表包安装到共享 Desktop pnpm 存储后，使用相同的 staging、健康检查、激活与 rollback 路径。

进程生命周期 Electron 锁是桌面端的主要 owner。事务锁用于纵深防御：准备本地状态时记录 Electron，在 pnpm worker 仍可能写入时记录该 worker，worker 退出后再把 owner 交还 Electron。后续进程不会把仍然存活的孤儿 worker 误判为陈旧事务。

## 开发

`dev:desktop` 会构建当前 Host、客户端 bundle、Web 前端和 Electron 壳，把已构建的 CLI 包、私有 Desktop Host 包及其 workspace 依赖投影为一次性桌面 npm 项目，然后直接启动 Electron；这条路径不下载安装包内的 Node.js，也不从 npm 解析 avn：

```sh
pnpm run dev:desktop
```

开发时使用读者自己的 Aeven home，因此开发应用显示与 CLI 和 Web 相同的会话和工作区；若已有 `avn web` Host 服务该 home，外壳会接管它，而不会在其上启动第二个 Host。Host 在开始启动时即占用该 home 的租约，因此在其启动期间打开的外壳会最多等待 30 秒，直到被租约记录的 Host 公布其 URL 并响应；若外壳改为启动自己的 Host，会打印原因。一次性 npm 项目位于 `apps/desktop/.desktop-build/development/project`，Electron 浏览器数据则位于 `apps/desktop/.desktop-build/development/electron-user-data`。显式 `AVN_HOME` 可选择另一个 Aeven home。Renderer DevTools 默认自动打开，Main、Renderer 和 avn Host 调试端口依次为 9229、9222 和 9230。`AVN_DESKTOP_MAIN_INSPECT_PORT`、`AVN_DESKTOP_RENDERER_DEBUG_PORT` 与 `AVN_DESKTOP_HOST_INSPECT_PORT` 可以替换这些端口，`AVN_DESKTOP_OPEN_DEVTOOLS=0` 则保持 Renderer 调试窗口关闭。

显式构建完成后，`start:desktop` 会重新生成一次性项目，并跳过构建直接启动已有产物：

```sh
pnpm run start:desktop
```

Workspace 开发使用调用命令的 Node.js 运行当前 CLI 与私有 Desktop Host 包，并禁用桌面包修改；只有该模式明确链接的一次性 profile 可以从自身目录外解析 bundle。需要验证内置 Node.js、内置 pnpm、发布 seed、插件安装、staging 和 rollback 时，应运行未打包应用。

## 打包

正常打包只需执行一条完整命令。该命令会先准备发布资源，再生成宿主平台的安装包与更新元数据。所有目标都要求通过 `AVN_DESKTOP_APP_ID` 提供反向域名形式的应用 ID。macOS 目标还要求通过 `AVN_DESKTOP_MACOS_SIGNING_IDENTITY` 提供 electron-builder 证书限定名，通过 `AVN_DESKTOP_MACOS_TEAM_ID` 提供对应的 10 字符 Apple Team ID，并提供一套完整的 notarytool 凭据方案。App Store Connect API Key 方式使用以下变量：

```sh
export AVN_DESKTOP_APP_ID='<reverse-DNS application ID>'
export AVN_DESKTOP_MACOS_SIGNING_IDENTITY='<certificate name without the Developer ID Application prefix>'
export AVN_DESKTOP_MACOS_TEAM_ID='<10-character Apple Team ID>'
export APPLE_API_KEY='<absolute path to the .p8 file>'
export APPLE_API_KEY_ID='<App Store Connect API Key ID>'
export APPLE_API_ISSUER='<App Store Connect issuer UUID>'
```

无需提前执行 `prepare:desktop`：

```sh
pnpm run package:desktop
```

发布自动化使用固定目标命令，确保运行时准备、seed 安装与 electron-builder 接收相同的平台和架构：

```sh
pnpm run package:desktop:mac:arm64
pnpm run package:desktop:win:arm64
pnpm run package:desktop:win:x64
```

macOS arm64 命令要求 Apple Silicon；Intel Mac 不是 Desktop 构建目标，因为 MemOS embedding 所需的 onnxruntime-node 不发布 Intel macOS 二进制文件。每个 Windows 命令都要求 Windows 宿主上的 Node.js 进程与目标架构一致：`win:arm64` 使用 arm64 Node.js，`win:x64` 使用 x64 Node.js。Windows on ARM 也可以构建 `win:x64`，在模拟下运行 x64 Node.js 运行时与 Whisper worker；除 ARM64 工具外还需要 Visual Studio 的 x64 构建工具（`MSVC … x64/x86 build tools`）。Linux arm64 与 x64 命令要求架构相同的 Linux 宿主。

每个目标都在 `apps/desktop/.desktop-build/targets/<target>/` 下持有自己的打包输入、已准备运行时、包集合、seed、pnpm 准备状态、未打包应用、更新元数据和最终产物。Node.js 归档缓存继续由 `.desktop-build/downloads` 共享，因为每个归档文件名都包含版本、平台和架构，并且在解包前经过验证。目标构建绝不读取其他目标的可变准备状态。

### 图标

`resources/` 存放应用图标，`installer/assets/` 存放 NSIS 侧边栏图片；每个位图都按自身边长从同目录的 SVG 渲染。macOS 的应用与挂载后的 DMG 卷使用 `icon-macos.icns`，Windows 的可执行文件、安装程序与卸载程序使用 `icon-windows.ico`，Linux 使用 `icon-macos.png`。`installer-sidebar.bmp` 填充 Windows 安装程序与卸载程序的欢迎页和完成页。`tray-windows.ico`（16–64 px）与 macOS 菜单栏模板图 `trayTemplate.png`（16 px，附 `@2x`）在应用显示托盘图标之前不会被打包。

### Linux 软件包

Linux 目标会生成未经代码签名的 AppImage 与 `.deb`。可以在架构匹配的 Linux 宿主上构建，也可以在任意 Docker 宿主上使用 `:docker` 命令构建：

```sh
pnpm run package:desktop:linux:arm64:docker
pnpm run package:desktop:linux:x64:docker
```

Docker 命令会为目标架构构建 `linux-builder.Dockerfile`，把 git 会提交的文件连同 `.git` 以流的形式送入容器，在容器中全新安装依赖后运行 Linux 打包命令，再把顶层产物复制到 `apps/desktop/.desktop-build/targets/<target>/artifacts`。它会转发 `AVN_DESKTOP_APP_ID`、`AVN_DESKTOP_AUTO_UPDATE_ENV` 与 `DOWNLOAD_TEST_ORIGIN`，并把 pnpm store 保存在 `avn-desktop-linux-pnpm-store` 卷中。目标架构与 Docker 宿主不同时会在模拟下运行。`.deb` 会安装 Chromium 沙箱辅助程序；Ubuntu 24.04 等限制非特权用户命名空间的发行版在缺少它时可能拒绝启动 AppImage。`upload:*` 不接受 Linux 目标。

### 上传更新

`AVN_DESKTOP_AUTO_UPDATE_ENV` 同时选择打包时写入的更新 URL 与后续 COS 上传目标，可取 `test` 或 `production`；未设置时使用 `test`。测试打包必须通过 `DOWNLOAD_TEST_ORIGIN` 提供 HTTPS origin，生产 origin 仍为 `https://download.deepseek.com`。上传还必须通过 `DOWNLOAD_TEST_COS_BUCKET` 或 `DOWNLOAD_PROD_COS_BUCKET` 提供所选环境的 COS bucket。shell 未设置 `AVN_DESKTOP_APP_ID`、`AVN_DESKTOP_AUTO_UPDATE_ENV` 与 `DOWNLOAD_TEST_ORIGIN` 时，每个 `package:desktop:*` 命令都会从仓库根目录的 `.env` 读取它们，且不会导入 `.env` 中的其他条目。目标路径为 `_/harness/desktop/stable/<target>/`，其中 `target` 为 `mac-arm64`、`win-arm64` 或 `win-x64`。

更新目标与上传凭据都与所选环境对应：

| 环境 | 公开 origin | COS bucket | COS 凭据 |
|---|---|---|---|
| `test` 或未设置 | `DOWNLOAD_TEST_ORIGIN` | `DOWNLOAD_TEST_COS_BUCKET` | `DOWNLOAD_TEST_COS_SECRET_ID`、`DOWNLOAD_TEST_COS_SECRET_KEY` |
| `production` | `https://download.deepseek.com` | `DOWNLOAD_PROD_COS_BUCKET` | `DOWNLOAD_PROD_COS_SECRET_ID`、`DOWNLOAD_PROD_COS_SECRET_KEY` |

同一目标必须在同一环境下完成打包与上传。例如，默认测试环境使用：

```sh
export DOWNLOAD_TEST_ORIGIN='https://desktop-updates.example.com'
pnpm run package:desktop:mac:arm64

export DOWNLOAD_TEST_COS_BUCKET='<test COS bucket>'
export DOWNLOAD_TEST_COS_SECRET_ID='<test COS SecretId>'
export DOWNLOAD_TEST_COS_SECRET_KEY='<test COS SecretKey>'
pnpm run upload:mac:arm64
```

生产发布需在打包前设置 `AVN_DESKTOP_AUTO_UPDATE_ENV=production`，再在执行 `upload:mac:arm64`、`upload:win:arm64` 或 `upload:win:x64` 前提供 `DOWNLOAD_PROD_COS_BUCKET` 与生产凭据对。打包不要求 COS bucket 或凭据。它会明确禁止 electron-builder 发布，从其子进程中删除全部四个 COS 凭据字段，并且只有在 electron-builder 以及全部签名或公证钩子成功后才写入目标完成记录。上传会先要求该记录与所选环境、目标、公开 URL 和当前 avn 版本一致，再要求根 avn 版本、Desktop 版本、频道元数据版本、产物名称、大小与 SHA-512 全部一致，之后才读取所选 COS 凭据对。它只上传该目标不可变且带版本的产物，最后以 `no-cache` 上传根据版本得出的频道元数据，并且不会删除历史对象。稳定版本使用 `latest-mac.yml` 或 `latest.yml`；`alpha` 等预发布版本则使用 `alpha-mac.yml` 或 `alpha.yml`，与 electron-builder 生成的文件名一致。

macOS 配置使用必填发布环境，不会接受钥匙串中最先发现的证书。空值、格式错误的 Team ID、包含 electron-builder 不支持的 `Developer ID Application:` 前缀的签名身份，以及不完整的公证凭据都会被拒绝。macOS 打包要求已配置的身份及其私钥可用。Seed 准备会把该身份、安全时间戳与 hardened runtime 应用到每个内嵌 Mach-O 文件；应用签名完成后，深度严格检查会拒绝其他叶证书 Authority 或 Team ID，验证通过才生成发布产物。Electron-builder 会在封装前公证应用并钉票，然后签署 DMG。DMG 的 artifact-completion 钩子随后会公证它并钉票，再要求其身份、票据与 Gatekeeper 验证全部通过；只有钩子成功，electron-builder 才能发布该文件。私钥可以来自登录钥匙串或 electron-builder 的标准 `CSC_LINK` 输入；环境中的 `CSC_NAME` 与证书发现顺序都不能选择发布所有者。公证凭据也可以使用 electron-builder 支持的完整 Apple ID 或钥匙串 profile 方式。手动执行 `pnpm --dir apps/desktop run verify:mac-signature -- <path-to-app>` 重复应用检查时，也必须提供两个 macOS 身份变量。

### Windows EV 签名

Windows 发布打包要求 `AVN_DESKTOP_WINDOWS_CER_FILE` 标识公开的 GlobalSign EV 叶证书，要求 `AVN_DESKTOP_WINDOWS_SIGNTOOL` 标识与 SafeNet 兼容的 SignTool 可执行文件，要求 `AVN_DESKTOP_WINDOWS_KEY_CONTAINER` 标识匹配的私钥容器，并要求 `AVN_DESKTOP_WINDOWS_TOKEN_PIN` 包含 SafeNet Token Password。证书文件保留在源码仓库之外，匹配的私钥仍位于 USB Token。运行固定 Windows 目标前设置这四个输入：

```powershell
$env:AVN_DESKTOP_WINDOWS_CER_FILE = 'C:\path\to\server.cer'
$env:AVN_DESKTOP_WINDOWS_SIGNTOOL = 'C:\path\to\the\validated\signtool.exe'
$env:AVN_DESKTOP_WINDOWS_KEY_CONTAINER = '<SafeNet private-key container name>'
$env:AVN_DESKTOP_WINDOWS_TOKEN_PIN = '<SafeNet Token Password>'
pnpm run package:desktop:win:x64
```

打包前插入并解锁 Token。electron-builder 钩子把每个产物交给采用 CRLF 的 `scripts/windows-sign.cmd`；该 CMD 只调用一次已配置的 SignTool，并指定 `/f`、SafeNet `/kc "[{{PIN}}]=容器"`、`/csp "eToken Base Cryptographic Provider"`、SHA-256 文件摘要和 DigiCert SHA-256 RFC 3161 时间戳。钩子不会改用 electron-builder 内置的 SignTool，也不会重试失败的签名请求。未使用 `--unsigned` 时，若 SignTool、证书、容器、PIN、Token 或签名不可用，Windows 打包会失败，不会生成未签名产物。

PIN 不能包含 `]`、引号或换行，因为这些字符用于分隔 SafeNet `/kc` 值或对应的 CMD 参数。CMD 会禁用延迟展开，因此包含 `!` 的 PIN 可以原样到达 SafeNet。打包流程不会把任何 `AVN_DESKTOP_WINDOWS_*` 字段传给构建与 seed 准备子进程；它只向 electron-builder 提供四个配置输入，在其他字段已经清理的环境中只向签名 CMD 提供经过校验的签名字段，在 SignTool 启动前清除这些字段，并遮盖 SignTool 诊断。SafeNet 仍要求 PIN 出现在 SignTool 进程命令行中。只能在连接了物理 Token 的受控 self-hosted Windows runner 上把它注入为临时 secret；绝不能提交该值、把它写进 `.env`，或持久保存为 Windows 用户或系统环境变量。

使用对应的 `:dir` 命令可以生成可直接运行的应用目录，而不是安装包，例如：

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:mac:arm64:dir
```

没有 Apple Developer ID 或 Windows 代码签名证书时，使用对应的 `:unsigned` 命令构建产物：

```sh
pnpm run package:desktop:mac:arm64:unsigned
pnpm run package:desktop:win:arm64:unsigned
pnpm run package:desktop:win:x64:unsigned
```

未签名构建会跳过 seed 签名、应用与安装包签名、macOS 公证、DMG 公证钩子与目标完成记录，因此 `upload:*` 会拒绝它。在 macOS 上，由于 Apple Silicon 不会启动没有签名的代码，electron-builder 会以不启用 hardened runtime 的方式对应用进行 ad-hoc 签名；测试者移除下载副本的隔离属性之前，Gatekeeper 会拦截它。Windows SmartScreen 会在未签名安装包运行前发出警告。每个目标仍要求在其对应的宿主平台上构建，并要求 `AVN_DESKTOP_APP_ID` 与所选更新 origin。

未签名产物带有 `-unsigned` 后缀，例如 `aeven-<version>-win-arm64-unsigned.exe`，因此在共享的产物目录中不会被误认为发布安装包。

每条打包命令都会先检查 desktop 与 avn 版本一致，为目标生成 electron-builder 配置（应用 ID、签名与公证设置、Windows 证书、SignTool 与令牌字段、更新 origin），并运行 `tar`、`npm`、Go 与 CMake，在任何构建步骤开始前报告全部问题。仅准备的运行会跳过签名设置。加上 `--check` 可在检查后停止：

```sh
pnpm run package:desktop:win:arm64:unsigned --check
```

需要检查或诊断为宿主目标准备的资源而不调用 electron-builder 时，可以让同一流水线在准备完成后停止：

```sh
pnpm run prepare:desktop
```

这条诊断命令是另一种停止位置，并非两条命令构建流程的前半段。之后执行 `package:desktop*` 时仍会重新完成正式构建与准备，避免使用陈旧的 avn 包、运行时文件或 seed 内容。

每条打包命令都会先执行仓库的正式构建，打包 avn 与 vendored 包族，在本地打包私有 Desktop Host 包，并打包 Landlock 入口，然后再准备发布资源。`prepare:packages` 选择分别以 `@aeven/cli` 和 `@aeven/desktop-host` 为根的第一方生产依赖闭包之并集，验证私有 Host tarball 同时包含 `lib/index.js` 与 `config/desktop.cordis.patch.yml`，把选中的 tarball 复制到 seed 输入，并记录其大小与 SHA-512 完整性。Host 包不会发布到 npm；它的 `files` manifest 只包含该运行入口与 overlay。公共包 tarball 仍是由各包发布 manifest 控制的正式 `pnpm pack` 输出，因此 Desktop 不增加第二套过滤规则，会保留 `lib/types` 等已发布声明，也不会独立删除或增加 source map。注册表包则在 seed 分片之前移除所有 Desktop 代码路径都不会加载的文件：source map、TypeScript 声明与源码、Windows 调试符号、发布历史 Markdown、其他平台与架构的预编译二进制，以及 `scripts/seed-store-prune.ts` 中按版本固定的逐包条目（未使用的 Tesseract 内核、未使用的 Tesseract 语言模型、pdf.js 浏览器构建，以及非 Windows 目标上 node-pty 的 ConPTY 载荷）。裁剪会重写每条受影响的 SHA-512 索引记录，并删除不再被任何记录引用的内容，因此离线安装验证、macOS 签名和 `integrity.json` 都覆盖裁剪后的存储；按版本固定的规则若未移除任何文件，构建会失败，直到有人对照升级后的包重新审查该规则。复用 seed 中注册表包的插件安装会得到裁剪后的文件集合。avn 发布版本更新会同步更新两个私有 Desktop manifest、仓库根与可发布 workspace；打包还会要求根 avn 包、Desktop Host 包与 Electron 包使用同一版本。构建 Desktop 应用前不要求 avn 或私有 Host 已发布到 npm。`prepare:runtime` 从 Node.js 官方发行服务下载 Node.js 24.17.0，在解压前验证其 SHA-256 条目，并在兼容的构建宿主上执行准备完成的目标二进制文件以验证其报告版本。它复制桌面包声明的 pnpm 版本，并把两个运行时版本记录进发布 seed。`prepare:seed` 运行该目标 Node.js 与内置 pnpm，因此按平台和 CPU 过滤的可选依赖会使 pnpm 存储与 seed 成为目标专用内容。它生成本地核心包映射、禁用全局 virtual 存储、从 npm 物化外部生产依赖并禁用生命周期脚本、删除 `node_modules` 以及所有临时 pnpm cache、配置和 state，证明完整依赖图可以离线安装并包含私有 Host 的入口与 overlay，在适用时执行 macOS 重写，再通过一次离线安装证明重写后的存储，删除临时 pnpm 项目注册，然后把松散存储替换为 16 个确定性的未压缩 tar 分片。它会解包这些最终分片，并在生成清单前验证每个内嵌 macOS 签名。后续 GUI 插件操作保留本地核心包映射，同时从固定的 Desktop npm 注册表解析插件包及其外部依赖。`electron-builder` 把各目标的平台产物写到 `apps/desktop/.desktop-build/targets/<target>/artifacts`；后续版本会保留不同名称的不可变安装包与 blockmap，但会替换该目标的未打包应用、诊断文件、完成记录与频道元数据。

未打包产物包含四块相互独立的体积：只保留客户端 `en` 与 `zh` 语言对应 Chromium 语言包的 Electron、离线 seed 存储分片与本地 avn tarball、上游 Node.js 与 pnpm 运行时，以及很小的桌面壳应用。分片不压缩，使外层 DMG、ZIP 或 NSIS 压缩器与差分更新器可以处理稳定的数据区间。文件系统占用不等于安装包下载大小，因此必须分别测量。打包应用首次启动时还会先把 seed 存储解包到 `$AVN_HOME/desktop/pnpm/store`，再安装可写 profile，因此发布验证必须同时测量应用与 Aeven home 的磁盘占用。

## 更新

打包应用会在主窗口打开十秒后检查目标专用的发布流；本地化的 **检查更新…** 菜单项会手动触发同一检查。发现可用版本时，应用打开一个原生确认弹窗。用户确认后，应用等待正在进行的检查完成，下载并验证已签名的 Desktop 发布、停止 avn 子进程，并把安装与重启交给 electron-updater。下次启动会先校准版本绑定的 seed，再重新打开产品窗口。

Electron-builder 始终为 `AVN_DESKTOP_AUTO_UPDATE_ENV` 选择的部署生成 generic-provider 频道元数据。NSIS 差分包与 macOS ZIP 目标让 electron-updater 可以复用未变化的数据块；供手动安装的 DMG 经过公证，但不生成 blockmap，因为它不是 macOS updater 的载荷。Seed 与桌面壳仍属于同一个签名 Desktop 发布。macOS 签名与公证凭据使用 electron-builder 的标准环境变量；Windows EV 签名使用上文所述的公开证书、已验证 SignTool、SafeNet 容器和 runner PIN。必填 Desktop 发布环境选择构建所验证的应用身份与平台签名身份。

## 底层开发覆盖项

`AVN_DESKTOP_NODE_BINARY`、`AVN_DESKTOP_PNPM_ENTRY`、`AVN_DESKTOP_SEED_DIR` 和 `AVN_DESKTOP_DEV_PROJECT_DIR` 可以为未打包 Electron 进程选择明确的资源。打包应用会忽略这些变量，并从 `process.resourcesPath` 解析签名资源。

## 已知限制

- Desktop 禁用 Web 的「在本地应用中打开…」操作，因为其 Host 插件依赖 HTTP 路由，而 Desktop 不提供 `webServer`。
- 发布签名、公证、更新托管和跨上一版本的已安装产物验证需要生产发布环境。
- 依赖包含 lifecycle script 的桌面插件，只有其包名进入桌面项目经过评审的 `allowBuilds` 策略后才能安装。
- 桌面壳与 CLI avn 共享 `$AVN_HOME` 下的会话、设置、凭据、工作区和存储，但可执行包、插件激活、锁文件与包管理器状态彼此隔离。
