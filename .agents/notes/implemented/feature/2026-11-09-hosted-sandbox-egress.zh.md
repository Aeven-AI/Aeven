# Agent Note：托管监狱的网络出站访问

Status: implemented

[English](2026-11-09-hosted-sandbox-egress.md) | 中文

## 问题

托管 Aeven Web 的每条命令都在没有网络的情况下运行，因此会话无法克隆仓库、安装软件包或发布版本（[#555](https://github.com/Aeven-AI/Aeven/issues/555)）。与之相比的托管聊天产品都通过带主机列表的代理为沙箱进程提供网络访问：ChatGPT 通过内部软件包镜像，Claude 通过包含 GitHub 和软件包 registry 的允许列表。这台 Host 还在回环地址上运行 MongoDB、Aeven API 和邮件服务，开放网络不能让命令访问这些服务、无限制地使用机器带宽，或让每条命令多付出一个进程。

## 决策

监狱保留其空的 network 命名空间。`avn-sandbox-jail` 新增 `egress`：提供方在所有监狱之外、在自己的 cgroup `<root>/jail/egress` 中运行一个代理，并让每条命令在一个静态中继之后启动；中继在监狱内监听一个回环端口，把连接复制到代理的 Unix 套接字。中继在每个代理连接开头发送账户和一个 HMAC 令牌，令牌由提供方用其生命周期内持有的密钥派生，因此代理无需信任命令就知道账户。代理只为列出的主机和端口提供 `CONNECT`，并为 `gitHosts` 中的主机转发 Git 的 smart HTTP 请求；它自行解析名称，拒绝内部地址，连接它检查过的地址，并限制每个账户的连接数、每秒字节数和每个 UTC 日的字节数，以及所有账户合计的连接数和每秒字节数。

对 `gitHosts` 中的主机，监狱内的 `git` 通过环境中的 URL 改写指向代理的 Git 路由。代理通过其标准流向提供方询问账户的凭据并发送到上游，因此令牌绝不进入监狱。`avn-sandbox-jail` 发布 `ctx.sandboxGitCredentials`（凭据来源的注册表），`avn-host-account-integrations` 注册账户已连接的 GitHub 账户。代理在转发推送之前读取其引用更新：分支的创建和更新直接通过，其他任何更新（例如标签或分支删除）等待发出推送命令的对话中的 `ctx.approval`。#555 中的发布于是只需要一次批准，即标签。

每个账户获得相同的访问权。免费账户只有几美分的模型额度，它们的会话很少，对每条命令做套餐检查没有收益。

托管补丁在 443 端口允许 `github.com`、`codeload.github.com`、`raw.githubusercontent.com`、`objects.githubusercontent.com`、`registry.npmjs.org`、`pypi.org` 和 `files.pythonhosted.org`，每个账户 32 个连接、8 MiB/s、每天 2 GiB，合计 50 MiB/s。安装只接受预构建的软件包（`PIP_ONLY_BINARY`、`npm_config_ignore_scripts`），因为编译和安装脚本是最耗 CPU 的部分。`host/install-egress.sh` 把 pip 加入镜像，并安装 `aeven_user_site.py`，它让安装写入调用者的 `~/.local`，在导入路径上排在镜像软件包之后。

同一变更为约两千名同时在线的用户做准备：账户的 CPU 上限从四核降到两核，`memoryHigh` 在 1.5 GiB 时让账户变慢，之后 `memoryMax` 在 2 GiB 时终止它，账户组设置 `memory.oom.group`，合计进程上限升至 16384，后台命令可运行 30 分钟。

超出连接上限的请求最多等待 `connectTimeoutMs` 以获得名额，而不是立即被拒绝。在 pink 上，一次发布演练的 `pnpm install` 占满了其账户的全部 32 个连接，同一账户另一条命令中的 `fetch` 立即以 429 失败。

在托管账户中对本仓库执行完整 `pnpm install`，在 1.5 GiB 的 `memoryHigh` 下运行超过十二分钟，因此 `memoryHigh` 与 `memoryMax` 一样设为 2 GiB；`unlimitedAccounts`（取自 `AVN_HOSTED_UNLIMITED_ACCOUNTS`）让运营者自己等指定账户使用监狱整体限制，并只受代理的合计上限约束。

监狱设置 `pnpm_config_verify_deps_before_run=false`：否则依赖缺失时 pnpm 11 会在 `pnpm run` 之前执行完整安装；在本仓库的新克隆中，这会从 `nodejs.org` 和 GitHub release 资源构建原生模块，而代理拒绝这些主机。设置之后，在 pink 上对新克隆执行 `pnpm release:avn` 用时 24 秒、占用 613 MB。

2026-11-10 的一次安全审查改动了四处。用户需批准一个对话对每个仓库的第一次推送，以及每次推送到 `main`、`master` 或默认分支，因为代理无法区分强制推送与快进推送。每个账户有自己的代理套接字，只挂载在其监狱中，上限为其连接上限的两倍，并关闭两秒内无数据的连接，否则一个账户可以向共享套接字打开足够多的连接，耗尽代理的文件上限。`github.com` 移出隧道列表，因此对它的每个请求都走 Git 路由，该路由会丢弃命令自带的凭据，堵住把用户数据推送到攻击者仓库的途径。代理以专用的 `aeven-egress` 用户运行，因此逃出监狱不再能触及持有所有账户令牌的进程。

## 考虑过的替代方案

不用中继的设计由启动步骤通过 Unix 套接字把监听套接字传给代理，每条命令不多一个进程，但 Node.js 无法从套接字的辅助数据中接收描述符，而 Python 或 C 代理意味着手写 HTTP 和 DNS 处理。中继每条命令占用 0.3 MB 和一次 fork。

像 Python zygote 那样通过套接字的对端进程识别调用者，因同样的原因被否决：Node.js 不提供对端凭据。命令自己环境中的令牌只能标识该命令的账户。

通过类型化事件注册 GitHub 令牌来源，与注册表做过比较。注册表的 `register()` 返回一个 disposer，而且只有一个进程会提出的问题不需要事件目录条目。

返回指明被拒引用的 Git `report-status` 而不是 HTTP 403，可以让模型看到原因。这需要实现推送协议的 side-band 应答；托管的模型说明写明了推送遇到 403 的含义。

像 ChatGPT 那样让 pip 和 npm 指向代理内的缓存镜像，可以增加共享下载缓存和请求级规则。它需要为每个 registry 重写索引；到 registry 的不透明隧道用十分之一的代码完成同样的安装。字节上限覆盖了缓存能节省的带宽。

在镜像中设置 `include-system-site-packages` 以使 `pip install --user` 可用被否决：它会把 Host 的 235 个系统 Python 软件包放到每条命令的导入路径上。`sitecustomize.py` 被否决，因为 Ubuntu 在标准库目录中自带一个，会遮蔽 site-packages 中的那个；改用一行 `.pth` 导入该模块。

## 影响

允许的主机会收到命令发送的任何内容，而 Git 路由可以不经提示地把分支推送到账户的 GitHub 连接可写的任何仓库；因此被提示注入的会话可以把它能读到的内容复制到 GitHub 上的仓库。只有标签推送、其他非分支引用和删除会请求批准。在 URL 中放入自己令牌的用户会绕过该路由及其批准。

目前没有机制限制一个账户一天内的 CPU 时间，也没有机制在机器饱和时拒绝新命令；两核上限和相等权重只限制速率。

## 验证

在 Ubuntu 24.04 arm64 虚拟机中，在带有监狱的命名空间和系统调用过滤器的 bubblewrap 下：`git clone` 一个公开仓库用时 0.8 秒，`npm install lodash express` 用时 5 秒，`pip install requests` 安装到 `~/.local` 用时 1.5 秒并复用了镜像的 `idna`；列表之外的主机、明文 HTTP 请求、解析到回环地址的名称、伪造的账户、第 33 个连接、1 MiB/s 的限速以及用尽的每日限额，均按配置被拒绝或限速；不带凭据经 Git 路由的克隆成功，原始的分支推送未经提问即被转发，带有分支删除的原始标签推送在批准问题被回答为否之后以 403 拒绝；命令的退出状态和管道没有变化，没有中继在其监狱结束后存活。类型检查和构建通过。获批的标签推送被转发并到达 GitHub。该虚拟机运行未包含 Landlock launcher、沙箱用户，以及使用真实 GitHub 连接认证的推送。
