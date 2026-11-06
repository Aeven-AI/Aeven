---
description: "面向运营服务多个账户的 Linux Host 的运维者的按账户进程监狱：受限命令能看到什么、在什么限制下运行，以及它需要的主机设置。"
kind: "package-reference"
---

# @aeven/sandbox-jail

[English](README.md) | 中文

## 概述

`avn-sandbox-jail` 为运行多个账户命令的 Linux Host（例如托管版 Aeven Web）提供 `ctx.sandbox` 后端。每条受限命令都在 bubblewrap 下运行，使用全新的 user、mount、PID、IPC、UTS、cgroup 和 network 命名空间。它只能看到配置的只读系统路径、调用账户自己的文件夹，以及私有的 `/tmp` 和 `/dev/shm`，并且没有网络。Landlock launcher 再次限制同一视图，命令加入其账户的 cgroup，由它限制 CPU、内存和进程数。工作区根目录位于账户根目录之外或跨越两个账户时，以 `SANDBOX_UNAVAILABLE` 失败关闭，因此命令绝不会在账户监狱之外运行。

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
| `cgroup` | 无 | 委派的 cgroup 目录，以及总限制与单账户限制 |
| `quotaCommand` | 无 | 每个账户第一条命令前运行一次的 argv，末尾追加账户文件夹，用于限制其磁盘用量；失败则拒绝该账户的命令 |
| `modelNote` | 无 | 描述命令可用内容的系统提示词文本 |

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
4. 在带有 `Delegate=yes` 和 `DelegateSubgroup=host` 的 systemd unit 中运行 Host。systemd 在 `<unit>/host` 中启动 Host，本提供方在其旁边创建 `<unit>/jail/acct-<account>`。
5. 把 `accountsRoot` 放在带项目配额的独立 ext4 文件系统上，例如用 `mkfs.ext4 -O quota,project` 创建、以 `loop,prjquota,nosuid,nodev` 挂载的 loop 镜像，使命令无法占满 Host 的磁盘。以 `quotaCommand` 通过 `sudo -n` 调用的 root 所有的辅助程序为每个账户文件夹分配项目 id（`chattr -R +P -p <id>`）和限额（`setquota -P`）；监狱中的进程无法更改项目 id。
6. 把命令可用的只读程序和库安装到 `readOnlyPaths` 列出的路径下，例如 `/opt/aeven-sandbox` 下的 Python 虚拟环境和 Node `node_modules` 目录。用 `python3 -m compileall` 预编译 Python 字节码，因为监狱无法写入 `.pyc` 文件，否则 pandas 的导入会慢五倍。

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
| — | 不发布运行时不变量伴随包；提供方不持有可被第二次观察推翻的事件序列或可变关系。 |

### 一次调用

`confine()` 规范化工作区根目录，取其在 `accountsRoot` 下的第一个路径分量作为账户，并构建 `bwrap … -- /run/aeven/landlock-run … -- <argv>`。配置了 cgroup 时，先由一个 `/bin/sh` 步骤把自身移入账户的组，再 `exec` bubblewrap，因此监狱及其启动的一切都计入该组。移入失败时以 125 退出并输出一行 `sandbox-jail:`，消费方将其归类为 runner 失败。

### 两道屏障

bubblewrap 构建的根目录只包含列出的路径，因此其他账户的文件夹和 Host 的文件在监狱中不存在。在其内部，Landlock 授予该根目录下的读权限，写权限只授予账户文件夹、`/tmp`、`/dev/shm` 和 `/dev/null`。通过 mount 命名空间逃逸到达的路径不在授权层级之内，仍被拒绝。`--disable-userns` 阻止命令再创建 user 命名空间，network 命名空间只有一个未配置的回环接口。

### cgroup

`<root>/jail` 为全部受限命令设置总上限，因此 `<root>/host` 中的 Host 保有其 CPU 份额和内存。每个 `acct-<account>` 组为一个账户设置上限和权重。组在账户第一条命令时创建，在销毁时若为空则删除。

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

通过 [`avn-bash-sandbox`](../../shell/bash-sandbox/README.zh.md) 和 [`avn-tool-bash`](../../shell/tool-bash/README.zh.md) 间接影响，它们渲染本提供方的拒绝事实。命令把账户文件夹视为工作目录和主目录，没有网络，只有预装的程序；`pip install` 或下载失败是命令自身的输出。

#### KV Cache 影响

不会直接使 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限 Linux，共享内核** — 监狱与 Host 共享内核，因此从内部发起的内核提权会到达整台机器。把 Host 放在除其服务内容外不保存其他东西的机器上，或把执行移到单独的机器。
- **每条命令都启动自己的解释器** — Python 命令每次调用都要支付导入开销（pandas 约 0.4 秒）；预加载并按命令 fork 的解释器尚未实现。
- **命令从 Host 进程派生** — fork 一个大的 Host 每条命令要花几毫秒；从小型执行器进程派生尚未实现。
- **托管的 `AVN_*` 变量不会到达命令** — 监狱用 `env` 设置完整环境。
- **没有系统调用过滤器** — 监狱依赖命名空间、丢弃的 capability、`no_new_privs` 和 Landlock；seccomp 过滤器尚未实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决方向与开放问题。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：预 fork 的解释器

在托管机器上测量，预加载 pandas 和 matplotlib、按命令 fork 并应用 Landlock 的进程运行一条 pandas 命令只需 12 毫秒，而非 381 毫秒，每条并发命令约 5 MB，而非 42–50 MB。它需要监狱内按命令的解释器入口，尚未决定。

</details>
