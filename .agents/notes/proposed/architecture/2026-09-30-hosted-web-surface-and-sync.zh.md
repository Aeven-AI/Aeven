# Agent Note: 从远端 Host 提供 Web 表面，并与本地 home 同步

Status: proposed

[English](2026-09-30-hosted-web-surface-and-sync.md) | 中文

## 问题

`avn --profile web` 是 Aeven 唯一随产品交付的长期监听表面：随产品交付的 profile 是 base + web-app、base + headless、base + sdk-app、base + acp-app，以及独立的 sdk-minimal（`packages/boot/app-boot/src/profile.ts:136-158`），SDK 与 ACP 表面只走 stdio，桌面外壳则「opens no listening port」（`apps/desktop/README.md:3`）。该表面只绑定回环地址，并且刻意拒绝其他一切：`--host 0.0.0.0` 会以「intentionally not supported yet for safety: it would expose remote code execution to the network」退出（`packages/bundle/web-app/src/startup.ts:74-76`），webserver 的 host 类型是封闭联合 `'127.0.0.1' | '0.0.0.0'`（`packages/host/webserver/src/index.ts:64`），子系统页面也直接写明了姿态：「The carrier itself owns no TLS, authentication, or Origin policy, so a non-loopback bind exposes the server unless the composition supplies those controls」（`docs/subsystems/web-server.md:47`）。

然而 Web bundle 本身正是按「已登录的公开页面」组合的。它挂载 `@aeven/identity-user` 与 `@aeven/identity-user-aeven`（`packages/bundle/web-app/cordis.patch.yml:116-145`），把提供方登录默认设为 `oauthFlow: redirect`，并配置了 `webUrl` 与 `mediaUrl`；一旦挂载了 authority，进程级的启动 token 就被绕过、而不是被扩展：`requestRejection` 对不可信的 Host 回 403，随后要么解析 identity authority、要么校验启动 token，而 `authorizeIndex` 对任何人提供 index，`authenticatedUrl` 返回干净的 URL（`packages/client/connection/src/rpc-host.ts:138-144`、`:224-240`）。调用方自己的 bearer 会按请求重新发布，因此模型路由向已登录账号计费（`rpc-host.ts:171-190`）。

因此本注记要回答的诉求是：在用户不在场的地方运行那个页面，让某个 Aeven 账号的工作可同时从浏览器与桌面外壳抵达，并让用户本地已有的历史到达远端一侧。今天这件事没有任何受支持的路径，而已经存在的部分都是为「一台机器上的一位操作者」设计的。把同一个会话共享给多个人是另一个问题，另有注记：[多参与者会话](2026-09-30-multi-participant-sessions.zh.md)。

## 当前 Web 表面已经提供的部分

| 关注点 | 现状 | 位置 |
|---|---|---|
| 浏览器客户端 | 已提供的 SPA，Typert Remote 走 `/api/remote.mux`，带退避重连与 ping 心跳 | `packages/api/gateway/src/stream-protocol.ts:5`、`packages/api/gateway/src/client/stream-client.ts:304-310` |
| 登录 | Aeven access bearer 与 refresh cookie 用 API 自身的签名密钥在本地校验 | `packages/identity/user-aeven/src/index.ts:217,229` |
| 可达性 | `IdentityUsers.mayAccess(owner, caller)` 对会话、工作区、jobs、终端、设备、Cordis 插件与转发事件设栅 | `packages/identity/user/src/index.ts:121`、`packages/api/gateway/src/index.ts:483-486` |
| 会话存储 | 后端中立的服务，四条固定不变量：仅追加、`seq` 连续、JSON 无损、`append` 只在批次持久化后才 resolve | `packages/session/session-persistence/src/index.ts:122-305`、`packages/session/session-persistence/README.md:72-75` |
| 执行世界 | 一个被设计为可整体搬移 fs 与 subprocess 的 seam，适配器已写好，但没有任何组合挂载它们 | `packages/e2b/README.md`、`docs/architecture.md:115` |
| 浏览器请求信任 | Host/Origin 栅栏接受回环地址加已声明的 `trustedHosts`，拒绝跨站抓取，并遵循 `X-Forwarded-Proto` | `packages/client/connection/src/api-request-trust.ts:91-117`、`packages/host/webserver/src/origin.ts:45-55` |

## 缺失的部分

- **受支持的绑定方式。** 回环地址是唯一的服务姿态；打印出的 URL 被拼成 `http://127.0.0.1:<port>`，用于展示、用于 `AVN_WEB_URL`、也用于表面提示词（`packages/bundle/web-app/src/index.ts:173-177`）。
- **TLS，以及任何跨源方案。** 服务栈里没有 `createSecureServer` 或 `node:https`，除第三方同意页之外没有任何 CORS，因此托管部署必须在反向代理处终结 TLS，并把页面与 Host 同源提供。
- **适配公开源的 cookie。** 浏览器会话 cookie 是 host-only、`HttpOnly`、`SameSite=Strict`、绑定 authority，并刻意省略 `Secure`，因为随产品交付的服务器是回环 HTTP（`packages/client/connection/src/browser-auth.ts:106-122`）；该交换由[浏览器 token 认证](../../implemented/architecture/2026-08-24-browser-token-authentication.zh.md)拥有，本注记只提出它所需的部署选项。
- **按账号划分的密钥。** 两个 Aeven 签名密钥对整个进程从 `process.env` 读取，一个 Host 存储的提供方 key 服务于每个已登录账号；[按账号隔离](../../implemented/architecture/2026-09-30-per-account-isolation-on-a-shared-host.zh.md)把存储的提供方 API key 列在刻意保持共享的状态之中。
- **可以搬移的状态。** 会话日志、领域 KV 文档、设置、凭据、记忆、学到的能力、Chrome profile 与 host lease 全部位于 `$AVN_HOME` 之下；spill 默认落在按进程的临时目录（`packages/spill/spill-local/src/store.ts:37`），jobs 是进程内存（`packages/jobs/README.md:12`），随产品交付的 base 行里全文索引是 `:memory:`（`packages/bundle/base/cordis.patch.yml:126-130`）。
- **名副其实的执行边界。** 沙箱 seam 只约束写入，而且自己写明了这一点：所有模式下读取都原样通过（`packages/fs/fs-sandbox/src/index.ts:8`），词汇覆盖的是文件效果，而「network and process visibility outside this vocabulary」（`packages/sandbox/sandbox/src/index.ts:26-29`），`workspace-write` 会授予服务器的 `/tmp` 与 `os.tmpdir()`（`packages/sandbox/sandbox/src/roots.ts:52-55`），每次模型 shell 调用都被交予共享的 `AVN_HOME`（`packages/shell/shell-env/src/index.ts:101,154`），一个 E2B 沙箱是按 harness 进程而不是按会话创建的（`packages/e2b/e2b/src/index.ts:106`），并且端口 9333 上的一个 Chrome profile 被每个会话共享（`packages/web/browser-chromium/src/index.ts:97`、`packages/bundle/web-app/cordis.patch.yml:248-253`）。仓库自己就指出了这个缺口：「A container-class backend would provide a hard multi-tenant boundary for both code and shell execution」（`packages/code-runtime/code-runtime/README.md:142`）。
- **审批应答方。** 在未组合任何应答方时，审批会落到 `unavailable`（`packages/interaction/user-approval/src/index.ts:55,274-282`）；生产中唯一的应答方是浏览器客户端与 ACP 桥（`packages/client/ui-approval/src/client/index.ts:1`、`packages/acp/acp/src/index.ts:155`），因此无头 Host 无法运行任何需要提问的工具。
- **搬移历史的途径。** 导出只存在于客户端侧、把日志打包成 ZIP，而没有任何导入路径（`packages/client/ui-conversation/src/client/input/export-session.ts:9-40`）；后端 README 固定了「One live writer per session」（`packages/session/session-persistence-jsonl/README.md:149`），而该 provider 中并不存在咨询锁——追加只是朴素的 `open(path, 'a')`（`src/index.ts:801-804`），只有物化过程通过 `link()` 与 `EEXIST` 做到防碰撞（`src/index.ts:686-705`）。
- **面向云端的后端。** `PersistenceRevision` 是文件系统 stat 身份，`dev:ino:size:mtimeNs:ctimeNs`（`packages/session/session-persistence-jsonl/src/index.ts:142-159`），并且 `locate()` 返回的绝对路径会被 `AVN_SESSION_JSONL`、会话日志下载与 raw artifact 读取当作 transcript 路径，因此数据库 provider 要重新实现 JSONL provider 的持久化故事，而不是提供一条连接串。
- **任何部署管线。** 仓库不运行 GitHub Actions（`docs/development.md:123`），`.gitlab-ci.yml` 以 `python-v*` tag 为门，且只发布 Python wheel，唯一的容器文件构建的是桌面打包主机（`apps/desktop/linux-builder.Dockerfile`）。

## 提案

分六个阶段，每一阶段都可独立使用。阶段 1 就是「从浏览器抵达我的 Aeven」的全部；后续阶段的存在，是为了让第一阶段不必假装自己是一个产品。

**阶段 1 —— 在 TLS 之后、以回环地址之外的方式提供该表面。** 放宽服务姿态：在 `packages/host/webserver` 中加入代理信任模式（或把公开 hostname 纳入 host 联合），用 overlay 行在 `trustedHosts` 中声明公开 authority，在 `packages/client/connection/src/browser-auth.ts` 中加入 `Secure` cookie 选项，把 `packages/bundle/web-app/src/index.ts` 中硬编码的回环 URL 换成可配置的公开 URL，并用一份明确的部署声明取代 `--host 0.0.0.0` 的拒绝。用书面形式接受其后果：浏览器会话抵达的是一个拥有操作者文件系统与网络的 agent。

**阶段 2 —— 回答两个前置问题。** 由谁应答审批（浏览器客户端，还是一条从不提问的策略），以及 argv 是由本地 `ctx.sandbox` 包装、还是由执行世界自己的 provider 包装。两个都是廉价决策，却是后续每一阶段的前提；把它们留在隐含状态，得到的正是一个什么都跑不起来的 Host。

**阶段 3 —— 按账号划分凭据。** 用按账号的来源取代进程级环境密钥，使一个 Host 存储的 key 不再服务每个已登录账号，并给撤销一个强于「access token 有效期内本地 JWT 校验」的机制。

**阶段 4 —— 先搬移可移植的部分，再搬移历史。** 先同步设置、学到的能力与记忆，让每台机器各自保有历史；再加入会话导入，使现有的导出成为往返路径，之后才考虑复制服务。用 `ctx.sessionPersistence` 做托管后端可以放在这一阶段，但它必须自造 revision token 并合成崩溃收尾事件，而不只是存字节。

**阶段 5 —— 每个账号一个 Host，配一条真正的边界。** 为每个账号供给一个 home 与一个执行世界：在 `packages/util/home-paths` 中按账号解析 home，在 E2B 家族中按会话设定沙箱生命周期，为远端文件读取提供 `processPathFromHostPath`，分离临时目录、按租户分离浏览器 profile，并设定配额。这一阶段才是多租户产品；阶段 1 不是。

**阶段 6 —— 部署管线。** 运行镜像、托管 manifest，以及成文的服务姿态，这些今天都不存在。

## 验收标准

- 阶段 1：不在操作者机器上的浏览器用 Aeven 账号经 HTTPS 登录并完成一个轮次，且设置 UI 持久化到 Host，而不是降级为内存（`packages/client/ui-settings/src/client/index.ts:72`）。
- 阶段 1：Host 拒绝 Host 或 Origin 既非回环、也未声明的请求，无论是否已认证。
- 阶段 2：需要审批的轮次要么抵达应答方，要么被一条成文策略拒绝；Bash 调用在部署所声明的世界中执行。
- 阶段 3：登录同一个 Host 的两个账号呈现各自不同的模型凭据，删除其中一个账号的凭据可在不重启 Host 的情况下停止其轮次。
- 阶段 4：在一个 host 上导出的会话可在另一个 host 上导入并以连续的 `seq` 恢复；对活动会话的第二个写入者被拒绝，而不是交错写入。
- 阶段 5：同一 Host 上的两个账号无法读取彼此 home、临时文件、浏览器 profile 或既有会话，且每个账号的命令在各自的执行世界中运行。
- 阶段 6：一条命令完成构建，一份文档描述如何把 Host 作为服务运行。

## 风险

- **第一阶段就是远程代码执行表面。** 只绑回环是安全属性，不是疏忽；在没有按租户隔离的情况下暴露它，意味着一个凭据等于整台机器。该阶段之所以存在，是因为另一条路——等到完整租户化——什么都不会交付；缓解措施是一份书面单操作者声明，加上阶段 2 的两个决策。
- **把只读约束误当作隔离。** 所有模式都允许读取，而 `AVN_HOME` 又被交给模型 shell，因此「只读」部署仍然暴露该 Host 上每个其他账号的状态。只看模式名的人会以为相反。
- **同步会引入两个写入者。** 在没有咨询锁、且 revision 只是 stat 元组的情况下，同一 home 上的本地与远端 Host 会交错追加；失败是产品视作 transcript 的日志中的静默数据丢失。
- **低估数据库后端。** seam 欢迎第三方 provider，但 provider 需要自造 revision token、崩溃收尾事件与 transcript 路径，这是一次重新实现，而不是一次集成。
- **为此设计好的 seam 都没有接上。** E2B、`DeviceHost` 与 `storage-sqlite` 都随产品交付却没有组合挂载它们，因此它们在计划里看起来总比在分支里便宜。
- **本次改动放弃了什么：** 只绑回环仍是单机诚实的默认值，任何托管模式都必须显式开启，并附上一份说明其用户是谁的部署。

## 曾考虑的替代方案

**先做按账号的云端 Host。** 先做租户化产品、再做单操作者版本，理由是阶段 1 是会被丢弃的。否决，因为阶段 1 不会被丢弃：它产出每个托管形态都需要的 TLS、信任、cookie 与可配置 URL 工作，它在数天内而不是数月内得到验证，并且它排除了「多租户设计本身错误」这一风险，而这一切发生在任何东西运行之前。

**用中继或隧道代替放宽绑定。** 让 Host 只绑回环、经反向隧道抵达，这样无需改动服务栈，并继承机器自身的授权。否决它作为随产品交付的答案，而非否决该技术：它把运行与保护隧道的责任留给操作者，没有给 Host 一个配置好的公开 authority，而且仍然会撞上桌面外壳依赖的那些事实——attach lease 是本地文件、通告 URL 是回环（`packages/util/home-paths/src/host-lease.ts`），因此没有客户端能被告诉中继在哪里。值得把它记录为单操作者的过渡路径。

**用日志复制作为同步机制。** 在 host 之间流式传输会话事件，因为日志是仅追加且按 `seq` 排序的。当前否决：压缩与回退会产生替换表面的（surface-replacing）事件，单活动写入者规则背后没有可用的跨进程强制手段，而失败模式就是损坏 transcript。会话交接以很低的代价交付了大部分价值；复制日后可以取代本注记。

**跨源的 Web 客户端。** 从一个源提供 SPA、从另一个源提供 Host API，好让一个托管 Host 服务多个前端。否决，因为升级请求不携带头部、只靠 cookie 认证，而 bundle 也写明了约束：AVN 必须与 API 同站提供。加入 CORS 与基于 token 的升级路径，是比托管本身更大的改动。

**把现有的本地沙箱当作租户边界。** 复用 `sandbox-local` 做按账号约束，因为它已经约束 subprocess 的 argv。基于代码否决：该 seam 按约定就是同世界的，读取不受限制，两个临时根目录都是共享的，而在 macOS 上 profile 是 `(allow default)` 加 `deny file-write*`，且不经探测直接选用（`packages/sandbox/sandbox-local/src/profiles.ts:52`、`src/index.ts:151-157`）。它约束的是配合的 agent 的写入；它并不隔离租户。

**现在就上数据库会话后端。** 尽早替换 JSONL provider，好让托管 Host 把会话存进 Postgres 或对象存储。否决它作为第一步：随产品交付的 `storage-sqlite` 后端未被挂载也未被试用，JSONL provider 的 revision 与崩溃恢复行为必须先被复现，而且阶段 1 根本不需要改后端。
