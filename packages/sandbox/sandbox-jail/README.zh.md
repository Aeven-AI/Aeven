---
description: "面向运营服务多个账户的 Linux Host 的运维者的按账户进程监狱：受限命令能看到什么、在什么限制下运行，以及它需要的主机设置。"
kind: "package-reference"
---

# @aeven/sandbox-jail

[English](README.md) | 中文

## 概述

`avn-sandbox-jail` 为运行多个账户命令的 Linux Host（例如托管版 Aeven Web）提供 `ctx.sandbox` 后端。每条受限命令都在 bubblewrap 下运行，使用全新的 user、mount、PID、IPC、UTS、cgroup 和 network 命名空间。它只能看到配置的只读系统路径、调用账户自己的文件夹，以及私有的 `/tmp` 和 `/dev/shm`，并且没有自己的网络；配置 `egress` 后，命令通过一个为每个账户设限的代理访问列出的主机。Landlock launcher 再次限制同一视图，命令加入其账户的 cgroup，由它限制 CPU、内存和进程数。工作区根目录位于账户根目录之外或跨越两个账户时，以 `SANDBOX_UNAVAILABLE` 失败关闭，因此命令绝不会在账户监狱之外运行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当一个 Host 为彼此不能访问对方文件或 Host 自身数据的人运行命令时，用本提供方替代 [`avn-sandbox-local`](../sandbox-local/README.zh.md)。[托管 bundle](../../bundle/hosted-app/README.zh.md) 在 `AVN_HOSTED_SANDBOX=1` 时挂载它，同时启用 [`avn-working-directory`](../../session/working-directory/README.zh.md) 的托管账户文件夹，并在 [`avn-sandbox-policy`](../sandbox-policy/README.zh.md) 上设置 `workspace-write` 上限。

### 何时选择

多账户 Linux Host 选择它。个人自己的电脑选择 `avn-sandbox-local`：它的 profile 让整个磁盘可读、网络开放，适合单一所有者，对多人不安全。

### 最小配置

```yaml
- id: sandbox-jail
  name: '@aeven/sandbox-jail'
  config:
    accountsRoot: /srv/aeven/sandbox/accounts
    cgroup:
      root: /sys/fs/cgroup/system.slice/aeven-hosted.service
      total: { memoryMax: 32G, pidsMax: '4096', cpuMax: 1200000 100000, cpuWeight: '100' }
      account: { memoryMax: 2G, pidsMax: '256', cpuMax: 200000 100000, cpuWeight: '100' }
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `accountsRoot` | 必填 | 其直接子目录即账户文件夹；每个工作区根目录都必须位于其中之一 |
| `bwrap` | `/usr/bin/bwrap` | bubblewrap 的主机路径 |
| `launcher` | npm launcher | Landlock launcher 的主机路径 |
| `readOnlyPaths` | `/usr` 与最小的 `/etc` 集合 | 以相同路径只读挂载的主机路径；不存在的路径会被跳过 |
| `symlinks` | `/bin`、`/sbin`、`/lib`、`/lib64` 指向 `/usr` | 在监狱根目录中创建的符号链接 |
| `env` | `PATH`、`LANG`、`TMPDIR`、单线程 BLAS、无界面 matplotlib | 受限命令的完整环境；`HOME` 为账户文件夹 |
| `tmpSizeMb` | `512` | `/tmp` 与 `/dev/shm` 各自的大小上限 |
| `cgroup` | 无 | 委派的 cgroup 目录，以及总限制与单账户限制；任一限制中可选的 `ioMax` 限制磁盘 I/O，可选的 `memoryHigh` 在 `memoryMax` 终止一个组之前先让它变慢 |
| `quotaCommand` | 无 | 限制账户文件夹磁盘用量的 argv，末尾追加该文件夹，在命令自身的启动步骤中运行，直到 `quotaRecord` 列出该账户；失败则拒绝该条命令 |
| `quotaRecord` | 无 | 配额辅助程序记录已受限账户的文件；省略时每条命令都运行配额步骤 |
| `unlimitedAccounts` | `[]` | 其 cgroup 使用合计 `total` 限制、出站代理只对其应用合计上限的账户文件夹名，例如运营者自己的账户；监狱与磁盘配额仍然适用 |
| `modelNote` | 无 | 描述命令可用内容的系统提示词文本 |
| `seccompFilter` | 无 | bubblewrap 安装的 BPF 系统调用过滤器的主机路径；文件不存在则启动失败 |
| `sessionAttachments` | `false` | 以只读方式在存储路径上挂载对话的用户消息与工具结果引用的附件 |
| `commandUser` | 无 | 以独立沙箱用户运行被隔离命令与 zygote 的 `exec`、`group` 与 `accountsPath` |
| `egress` | 无 | 被隔离命令的网络访问：代理的 `node`、`script`、`relay`、`socketDir`，中继的 `port`，`allow` 主机列表与 `ports`，其 Git 请求携带账户凭据的 `gitHosts`，单账户与总体的连接数和字节数上限、超时，以及代理的 cgroup `limits`；需要 `cgroup` |
| `pythonZygote` | 无 | 运行被隔离 `python3` 命令的预加载 Python 解释器的 `python`、`script`、`preload`、`socketDir` 与 cgroup `limits`；需要 `cgroup` 和 `seccompFilter` |

生成的 [配置目录](../../../docs/config-catalog.zh.md#aevensandbox-jail) 是每个可接受字段及其 JSDoc 的完整来源。

### 主机设置

每一步每台机器执行一次，除特别说明外以 root 身份执行。

1. 安装 bubblewrap：`apt-get install bubblewrap musl-tools`。
2. Ubuntu 限制非特权 user 命名空间。只为 bubblewrap 放开，写入 `/etc/apparmor.d/bwrap`，再用 `apparmor_parser -r /etc/apparmor.d/bwrap` 加载：

   ```text
   abi <abi/4.0>,
   include <tunables/global>

   profile bwrap /usr/bin/bwrap flags=(unconfined) {
     userns,

     include if exists <local/bwrap>
   }
   ```

3. 以 Host 的用户身份，在部署的 checkout 中构建 Landlock launcher：`pnpm --dir native/landlock-run run build:native`。
4. 在带有 `Delegate=yes` 和 `DelegateSubgroup=host` 的 systemd unit 中运行 Host。systemd 在 `<unit>/host` 中启动 Host，本提供方在其旁边创建 `<unit>/jail/acct-<account>`。以专用用户（例如 `aeven-hosted`）运行它，该用户除配额辅助程序外没有任何 sudo 权限（[`host/systemd-user.conf`](host/systemd-user.conf)、[`host/sudoers`](host/sudoers)），因此被攻破的 Host 进程不是 root。在 unit 中把 `AVN_HOME` 设为 Host 此前使用的 Aeven 主目录，并归该用户所有，因为它默认是 `~/.aeven`，否则更换用户会移走所有会话、附件和账户文件夹。
5. 把 `accountsRoot` 放在带项目配额的独立 ext4 文件系统上，例如用 `mkfs.ext4 -O quota,project` 创建、以 `loop,prjquota,nosuid,nodev` 挂载的 loop 镜像，使命令无法占满 Host 的磁盘。以 `quotaCommand` 通过 `sudo -n` 调用的 root 所有的辅助程序为每个账户文件夹分配项目 id（`chattr -R +P -p <id>`）和限额（`setquota -P`）；监狱中的进程无法更改项目 id。
6. 用 [`host/seccomp-filter.c`](host/seccomp-filter.c) 生成系统调用过滤器（`apt-get install libseccomp-dev`，然后 `cc -O2 -o seccomp-filter seccomp-filter.c -lseccomp`），并在 `seccompFilter` 中填写其输出路径。更新源码后重新运行并重启 Host；正在运行的命令保留其启动时的过滤器。
7. 把命令可用的只读程序和库安装到 `readOnlyPaths` 列出的路径下，例如 `/opt/aeven-sandbox` 下的 Python 虚拟环境和 Node `node_modules` 目录。用 `python3 -m compileall` 预编译 Python 字节码，因为监狱无法写入 `.pyc` 文件，否则 pandas 的导入会慢五倍。
8. 如需动画和视频，以 root 身份运行 [`host/install-motion.sh`](host/install-motion.sh)。它安装无头 Chromium（`playwright-core`）、GSAP 和开放许可字体（SIL Open Font License 下的 Google Sans Flex 等 Google Fonts 字体族，以及覆盖所有文字、CJK 和彩色 emoji 的 Noto），并把 `render-motion` 放入镜像的 `bin`。`render-motion page.html film.mp4` 通过 HyperFrames 合成自身运行时的播放器逐帧推进它，否则逐帧推进页面的 GSAP 时间线或其 `window.seek(seconds)`，再用 ffmpeg 的 libx264 编码这些帧；页面为 `-` 时从标准输入读取，`--stills` 与 `--json` 以一行 JSON 返回均匀分布的帧与影片信息，供 [`avn-motion-sandbox`](../../motion/motion-sandbox/README.zh.md) 读取。更新 `render-motion` 后需重新运行该脚本；它用已安装的副本响应 CDN 上的 GSAP 请求，其他请求一律失败。在 `readOnlyPaths` 中列出 `/var/cache/fontconfig`，并在 `env` 中设置 `PLAYWRIGHT_BROWSERS_PATH`。
9. 如需快速的 Python，以 root 身份运行 [`host/install-python-zygote.sh`](host/install-python-zygote.sh)，在 `env` 的 `PATH` 中把 `/opt/aeven-sandbox/shim` 放在最前，并设置 `pythonZygote`。该脚本把静态的 `python3` 与 `python` shim 构建到 `<image>/shim`，并在其旁安装 `script` 所指的 `python-zygote.py`；更新这两个文件后需重新运行它。提供者在所有监狱之外、`<root>/zygote` 中启动一个解释器，它只导入一次 `preload`；shim 通过每个监狱挂载在 `/run/aeven/zygote` 的套接字把每次 `python3` 调用交给它。每次调用时它会 fork，通过套接字对端的 pidfd 识别调用者，移入调用者的账户组，加入调用者的命名空间，丢弃所有 capability，为调用者的可写挂载安装启动器的 Landlock 规则并加载监狱的系统调用过滤器，再以调用者的描述符、目录、环境与 umask 运行程序。这样 `import pandas, matplotlib.pyplot` 约需 30 毫秒而不是 0.9 秒。zygote 无法精确重现的调用，例如交互会话、不常见的参数、被改动的 `PYTHON*`、区域设置、线程数或 Matplotlib 变量，或未提及任何预加载模块的 `-c` 代码，改由镜像的解释器运行；zygote 停止期间的所有调用也是如此。超出单个账户 8 个、或总计 256 个等待请求的连接同样如此，因此泛洪套接字的账户只会拖慢它自己的调用。zygote 结束后一秒重启；一分钟内结束五次后，下一次重启等待五分钟。
10. 如需以不同于 Host 的用户运行命令，以 root 身份运行 [`host/install-sandbox-user.sh`](host/install-sandbox-user.sh) `<accountsRoot>`，在 Host 的 unit 中要求两个账户挂载（[`host/systemd-dropin.conf`](host/systemd-dropin.conf)），设置 `commandUser`，然后重启 Host。该脚本创建 `aeven-sandbox` 并把 Host 的用户加入其组。它把 [`host/sandbox-exec.c`](host/sandbox-exec.c) 构建为 `/usr/local/libexec/aeven-sandbox-exec`，只有 Host 的组可以执行它，且它只持有 `cap_setuid` 与 `cap_setgid`。它还为两个用户在每个账户文件夹及任一方之后在其中创建的内容上设置 ACL，把账户根目录再挂载一次到 `/srv/aeven-accounts`（沙箱用户可以穿过但不能列出），并创建 zygote 的套接字目录 `/var/lib/aeven-zygote`。此后每次启动都在 bubblewrap 之前切换到沙箱用户。bubblewrap 从第二个挂载点挂载账户的文件夹，附件则从 Host 打开的描述符复制进来。逃出监狱的命令会发现 Host 的数据目录是关闭的。切换每条命令约耗时 1.6 毫秒。
11. 如需让命令访问网络，以 root 身份运行 [`host/install-egress.sh`](host/install-egress.sh) 并设置 `egress`；更新中继或代理后重新运行它，然后重启 Host。该脚本构建静态中继并把代理安装到 `<image>/shim`，为沙箱用户创建套接字目录 `/var/lib/aeven-egress`，把 pip 加入镜像，并安装 [`host/aeven_user_site.py`](host/aeven_user_site.py)：它让 `pip install` 写入调用者的 `~/.local`，并把该文件夹放在导入路径中镜像软件包之后。`allow` 中只列出每个账户都可以读写其全部内容的主机；`PIP_ONLY_BINARY`、`npm_config_ignore_scripts` 等安装策略放在 `env` 中。

### 失败与恢复

launcher 无法强制执行 Landlock、bubblewrap 无法创建监狱的命名空间（缺少 AppArmor profile）或 cgroup 目录未被委派时，启动会明确失败。工作区根目录不在某个账户文件夹内的调用抛出 `SANDBOX_UNAVAILABLE`。命令在其文件夹、`/tmp` 或 `/dev/shm` 之外写入时，以 `Read-only file system` 或 `Permission denied` 失败，bash 工具将其报告为沙箱拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、启动探测、账户检查、每次调用的包装 |
| [`src/profile.ts`](src/profile.ts) | 单次调用的 bwrap 挂载与 Landlock 授权 |
| [`src/cgroup.ts`](src/cgroup.ts) | 委派目录下的总 cgroup 与按账户 cgroup |
| [`src/zygote.ts`](src/zygote.ts) | Python zygote 进程，在自己的组中启动 |
| [`src/egress.ts`](src/egress.ts) | 出站代理进程、它的连接令牌与提问，以及中继的 argv 与环境变量 |
| [`src/git-credentials.ts`](src/git-credentials.ts) | `ctx.sandboxGitCredentials`：代理所发送 Git 凭据的来源 |
| [`src/supervised.ts`](src/supervised.ts) | 两个辅助进程共用的带冷却的重启 |
| — | 不发布运行时不变量伴随包；提供方不持有可被第二次观察推翻的事件序列或可变关系。 |

### 一次调用

`confine()` 规范化工作区根目录，取其在 `accountsRoot` 下的第一个路径分量作为账户，并构建 `bwrap … -- /run/aeven/landlock-run … -- <argv>`。配置了 cgroup 时，先由一个 `/bin/sh` 步骤把自身移入账户的组，再 `exec` bubblewrap，因此监狱及其启动的一切都计入该组。移入失败时以 125 退出并输出一行 `sandbox-jail:`，消费方将其归类为 runner 失败。

### 主机文件

[`host/`](host/) 存放设置步骤安装的内容：AppArmor profile、用于委派和 Host 用户的 systemd drop-in、带 sudoers 规则的配额辅助程序、系统调用过滤器源码、动画安装脚本与 `render-motion`，Python zygote（`python-zygote.py`，其中记录了协议）、它的 shim 源码和 shim 安装脚本，以及沙箱用户的安装脚本和切换到该用户的辅助程序。配额辅助程序从 root 所有的 `/etc/aeven-sandbox/accounts-root` 读取账户根目录，因此调用者无法选择它限制的目录树。

### 两道屏障

bubblewrap 构建的根目录只包含列出的路径，因此其他账户的文件夹和 Host 的文件在监狱中不存在。在其内部，Landlock 授予该根目录下的读权限，写权限只授予账户文件夹、`/tmp`、`/dev/shm` 和 `/dev/null`。通过 mount 命名空间逃逸到达的路径不在授权层级之内，仍被拒绝。`--disable-userns` 阻止命令再创建 user 命名空间，network 命名空间只有一个回环接口。

### 出站访问

监狱保留其空的 network 命名空间。配置 `egress` 后，每条命令都在 `aeven-egress-relay` 之后启动：它在监狱内监听配置的回环端口，脱离为独立进程，然后执行命令；命令环境中的代理变量指向该端口。中继把每个连接复制到代理的 Unix 套接字（只读挂载于 `/run/aeven/egress`），并先发送一行账户、对话及其令牌；令牌是这两者在提供方生命周期内持有的密钥下的 HMAC。命令可以读到自己的令牌，得到的只是自己账户的访问权。

代理只为 `allow` 中的主机、`ports` 中的端口提供 `CONNECT`。它自行解析名称，拒绝回环、私有、链路本地及其他内部地址，并连接它检查过的地址，因此任何名称都到不了 Host 自己的服务。它限制每个账户的打开连接数、每秒字节数和每个 UTC 日的字节数，以及所有账户合计的连接数和每秒字节数。超出连接上限的请求最多等待 `connectTimeoutMs` 以获得空出的名额，因此一次大型安装只会拖慢其账户的其他命令，而不会让它们失败；拒绝是一条写明原因的 HTTP 响应。它在 `<root>/jail/egress` 中按自己的限制运行，设置了 `commandUser` 时以沙箱用户身份运行。中继在命令运行期间占用约 0.3 MB，并随监狱结束。

对 `gitHosts` 中的每个主机，监狱内的 `git` 把 `https://<host>/` URL 改写到代理的 Git 路由，该路由在同样的地址检查和字节上限下通过 TLS 转发 Git 的 smart HTTP 请求。代理向提供方询问账户的凭据，提供方查询注册在 `ctx.sandboxGitCredentials` 上的来源；[`avn-host-account-integrations`](../../host/account-integrations/README.zh.md) 注册账户已连接的 GitHub 账户。凭据从提供方到代理、再到 Git 主机，绝不进入监狱；没有凭据的账户只能访问公开仓库。转发推送之前，代理读取其引用更新。只创建或移动分支的推送会被转发。创建、移动或删除任何其他引用（例如标签）或删除分支的推送会等待：提供方在发出推送命令的对话中请求批准，除非用户允许，否则以 `403` 应答。自带凭据的 URL 不会被改写，走普通隧道。

### cgroup

`<root>/jail` 为全部受限命令设置总上限，因此 `<root>/host` 中的 Host 保有其 CPU 份额和内存。每个 `acct-<account>` 组为一个账户设置上限和权重。组在账户第一条命令时创建，在销毁时若为空则删除。账户组设置 `memory.oom.group`，因此耗尽账户内存的命令会与该账户的其他进程一同结束，而不是留下半条管道继续运行。任一限制中的 `ioMax` 会为容纳 `accountsRoot` 的整块磁盘写入 `io.max`（分区解析为其所在磁盘）并启用 `io` 控制器；与内存控制器一同启用时，缓冲写入计入弄脏页面的账户。`accountsRoot` 不在块设备上时启动失败。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [进程沙箱子系统](../../../docs/subsystems/sandbox.zh.md) — 模式、按调用策略与分类方言。
- [托管沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-11-06-hosted-sandbox-jail.zh.md) — 为什么监狱是 `ctx.sandbox` 后端，以及它是如何测量的。
- [本地沙箱提供方](../sandbox-local/README.zh.md) — 在托管 Host 上被本包替代的单一所有者后端。

-----

<a id="model-experience"></a>
## 模型体验

通过 [`avn-bash-sandbox`](../../shell/bash-sandbox/README.zh.md) 和 [`avn-tool-bash`](../../shell/tool-bash/README.zh.md) 间接影响，它们渲染本提供方的拒绝事实。命令把账户文件夹视为工作目录和主目录，并看到预装的程序。没有 `egress` 时它们没有网络，`pip install` 或下载失败是命令自身的输出；有 `egress` 时，访问 `allow` 之外的主机或超出上限的请求会失败，代理给出的原因出现在调用程序的输出中。部署方通过 `modelNote` 告诉模型哪些主机和安装可用。

#### KV Cache 影响

不会直接使 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限 Linux，共享内核** — 监狱与 Host 共享内核，因此从内部发起的内核提权会到达整台机器。把 Host 放在除其服务内容外不保存其他东西的机器上，或把执行移到单独的机器。
- **zygote 运行共享 zygote 的启动状态** — 从同一 zygote fork 出的每次运行都有相同的字符串哈希种子，其 `os.getppid()` 为 0，启动时导入的模块保留当时读取的环境，因此改动导入期变量的调用改由解释器运行。
- **没有 zygote 时每条命令都启动自己的解释器** — Python 命令每次调用都要支付导入开销（pandas 与 Matplotlib 约 0.9 秒）。
- **命令从 Host 进程派生** — fork 一个大的 Host 每条命令要花几毫秒；从小型执行器进程派生尚未实现。
- **托管的 `AVN_*` 变量不会到达命令** — 监狱用 `env` 设置完整环境。
- **系统调用过滤器是拒绝列表** — 它拒绝挂载、命名空间、跟踪、密钥环、BPF、模块与句柄类调用，隐藏 `io_uring` 与 `clone3`，并且只允许 Unix、IPv4、IPv6 与路由 netlink 套接字；其余调用仍被允许，命名空间、丢弃的 capability、`no_new_privs` 和 Landlock 仍是主要屏障。
- **内核属于 Host** — 从监狱发起的内核提权会触及所有账户以及机器上的其他一切。让 Host 运行在不存放其他内容的机器上，或把执行移到单独的机器或 gVisor 这样的用户态内核中。
- **允许的主机可双向传输数据** — 代理转发 TLS 而不读取内容，因此命令可以把它能读到的任何内容发送到接受上传的允许主机，并且可以通过 Git 路由把分支推送到账户凭据可写的任何仓库。
- **推送批准需要一个打开的回合** — 批准记录在对话的当前回合中，因此存活时间超过其回合的后台命令发出的受限推送会被拒绝。被拒绝的推送以不带原因的 HTTP 403 到达 `git`。
- **Git 路由只提供 fetch 和 push** — Git LFS、主机的 REST API 和压缩的推送请求不会携带账户凭据转发。
- **出站计数器保存在代理中** — 每日字节计数在代理或 Host 重启后重新开始，令牌在提供方生命周期内一直有效。
- **安装的 Python 软件包不会替换镜像中的软件包** — 账户的 `~/.local` 在导入路径上排在镜像软件包之后，pip 无法升级预装的软件包，安装的软件包运行时没有字节码文件。
- **按用户计的内核限制是共享的** — 内核把 inotify 实例（默认 128 个）等按用户计的资源算在沙箱用户名下、跨所有监狱累计，因此一个账户就能耗尽所有账户的份额。在服务许多账户的 Host 上调高 `fs.inotify.max_user_instances` 与 `fs.inotify.max_user_watches`。
- **一个沙箱用户服务所有账户** — 启用 `commandUser` 后，逃出监狱的命令无法访问 Host 的数据，但仍持有沙箱用户对其能找到名称的账户文件夹的访问权；在监狱内，命名空间把各账户隔开。
- **未授予组权限创建的文件对 Host 不可读** — 在账户文件夹的 ACL 下，命令以 `0600` 模式创建的文件不给 Host 的用户任何访问权，因此 Host 无法分享或预览它。
- **附件被复制进每个监狱** — 启用 `commandUser` 后，每条命令都以副本形式在其监狱根目录中收到对话的附件，耗费的时间与内存与其大小成正比。
- **额外可写根目录留在账户内** — 命令可以影响的根目录（例如链接 git 工作树的共享目录）若位于账户文件夹之外，会被排除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决方向与开放问题。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：预 fork 的解释器

在托管机器上测量，预加载 pandas 和 matplotlib、按命令 fork 并应用 Landlock 的进程运行一条 pandas 命令只需 12 毫秒，而非 381 毫秒，每条并发命令约 5 MB，而非 42–50 MB。它需要监狱内按命令的解释器入口，尚未决定。

</details>
